/**
 * Server-side Android exporter for ZenEngine.
 *
 * The editor already knows how to produce a standalone HTML5 game bundle.
 * This module wraps that bundle in a tiny Android WebView application and
 * builds a debug-signed APK on the server, so a game creator never needs
 * Android Studio, a local SDK, or a local build command.
 *
 * The Android wrapper is deliberately outside project/runtime: the runtime
 * remains a browser-compatible game engine and the shipped APK is simply
 * another host for the standalone player.
 */

const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const ANDROID_API = "35";
const BUILD_TOOLS_VERSION = "35.0.0";
const COMMAND_LINE_TOOLS_URL =
  "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip";
const SDK_CACHE_DIR = path.join(process.cwd(), ".cache", "zenengine", "android-sdk");
const GRADLE_WRAPPER_SOURCE_DIR = path.join(__dirname, "android-tools", "gradle-wrapper");
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

let sdkPromise = null;

function safeSlug(value, fallback = "game") {
  const slug = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase();
  return slug || fallback;
}

function androidPackageName(title) {
  const parts = String(title || "game")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.replace(/^[^a-z]+/, ""));
  const name = parts.join(".") || "game";
  return "com.zenengine." + name.slice(0, 48).replace(/\.+$/g, "");
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function javaEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    timeout: options.timeout || 15 * 60 * 1000,
    maxBuffer: 12 * 1024 * 1024,
  });
}

function runWithInput(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(command + " timed out."));
    }, options.timeout || 15 * 60 * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(command + " failed (" + code + "): " + (stderr || stdout).slice(-4000)));
    });
    child.stdin.end(input);
  });
}

function sdkManagerPath(sdkRoot) {
  return path.join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
}

function gradleCommand(cwd) {
  const wrapper = path.join(cwd, "gradlew");
  if (fs.existsSync(wrapper)) return { command: wrapper, args: [] };
  return { command: "gradle", args: [] };
}

function portableGradleAvailable() {
  return fs.existsSync(path.join(GRADLE_WRAPPER_SOURCE_DIR, "gradlew"));
}

function findExistingSdk() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    SDK_CACHE_DIR,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(sdkManagerPath(candidate))) || null;
}

async function ensureAndroidSdk(onProgress) {
  const existing = findExistingSdk();
  if (existing) return existing;

  if (!sdkPromise) {
    sdkPromise = (async () => {
      onProgress("Installing Android SDK (first export only)…");
      const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "zenengine-sdk-"));
      const archive = path.join(tempRoot, "commandlinetools.zip");
      try {
        await fsp.mkdir(SDK_CACHE_DIR, { recursive: true });
        const response = await fetch(COMMAND_LINE_TOOLS_URL);
        if (!response.ok) {
          throw new Error("Android command-line tools download failed (" + response.status + ").");
        }
        await fsp.writeFile(archive, Buffer.from(await response.arrayBuffer()));
        await run("unzip", ["-q", archive, "-d", tempRoot], { timeout: 5 * 60 * 1000 });
        await fsp.mkdir(path.join(SDK_CACHE_DIR, "cmdline-tools"), { recursive: true });
        await fsp.rm(path.join(SDK_CACHE_DIR, "cmdline-tools", "latest"), { recursive: true, force: true });
        // /tmp and the workspace can be different filesystems in Replit,
        // so rename() may fail with EXDEV. Copying also makes a partially
        // completed first-run install easier to cleanly retry.
        await fsp.cp(
          path.join(tempRoot, "cmdline-tools"),
          path.join(SDK_CACHE_DIR, "cmdline-tools", "latest"),
          { recursive: true }
        );
        const sdkmanager = sdkManagerPath(SDK_CACHE_DIR);
        onProgress("Installing Android platform and build tools…");
        await runWithInput(
          sdkmanager,
          [
            "--sdk_root=" + SDK_CACHE_DIR,
            "platform-tools",
            "platforms;android-" + ANDROID_API,
            "build-tools;" + BUILD_TOOLS_VERSION,
          ],
          "y\n".repeat(20),
          { timeout: 15 * 60 * 1000 }
        );
        return SDK_CACHE_DIR;
      } finally {
        await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      }
    })().catch((error) => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error("The game export is larger than 128 MB."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function validateAndExtractBundle(zipPath, destination) {
  const listing = await run("unzip", ["-Z1", zipPath], { timeout: 60 * 1000 });
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error("The uploaded game bundle contains an unsafe path.");
    }
  }
  if (!entries.includes("index.html") || !entries.includes("main.js") || !entries.includes("runtime/index.js")) {
    throw new Error("The uploaded bundle is not a complete ZenEngine game build.");
  }
  await fsp.mkdir(destination, { recursive: true });
  await run("unzip", ["-q", zipPath, "-d", destination], { timeout: 5 * 60 * 1000 });
}

function androidProjectFiles(title, packageName, hasAppIcon) {
  const packagePath = packageName.replace(/\./g, "/");
  const iconAttributes = hasAppIcon
    ? '      android:icon="@drawable/app_icon"\n      android:roundIcon="@drawable/app_icon"\n'
    : "";
  return {
    "settings.gradle": `pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}
rootProject.name = "ZenEngineGame"
include(":app")
`,
    "build.gradle": `plugins {
  id "com.android.application" version "8.7.3" apply false
}
`,
    "gradle.properties": `org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8
android.useAndroidX=false
`,
    "app/build.gradle": `plugins {
  id "com.android.application"
}

android {
  namespace "${packageName}"
  compileSdk ${ANDROID_API}

  defaultConfig {
    applicationId "${packageName}"
    minSdk 23
    targetSdk ${ANDROID_API}
    versionCode 1
    versionName "1.0"
  }
}
`,
    "app/src/main/AndroidManifest.xml": `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
   <application
      android:theme="@style/AppTheme"
      android:label="${xmlEscape(title)}"
${iconAttributes}      android:hardwareAccelerated="true"
      android:usesCleartextTraffic="true"
      android:resizeableActivity="true">
    <activity
        android:name=".MainActivity"
        android:screenOrientation="unspecified"
        android:configChanges="orientation|screenSize|keyboardHidden"
        android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`,
    "app/src/main/res/values/styles.xml": `<resources>
  <style name="AppTheme" parent="@android:style/Theme.Material.Light.NoActionBar">
    <item name="android:fontFamily">sans</item>
    <item name="android:windowFullscreen">true</item>
    <item name="android:colorAccent">#D4AF6A</item>
    <item name="android:windowActionModeOverlay">true</item>
  </style>
</resources>
`,
    ["app/src/main/java/" + packagePath + "/MainActivity.java"]: `package ${packageName};

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
 import android.net.Uri;
 import android.webkit.MimeTypeMap;
 import android.webkit.WebResourceRequest;
 import android.webkit.WebResourceResponse;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
 import java.io.ByteArrayInputStream;
 import java.io.IOException;
 import java.io.InputStream;
 import java.util.Collections;

public final class MainActivity extends Activity {
  private WebView gameView;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    requestWindowFeature(Window.FEATURE_NO_TITLE);
    getWindow().setFlags(
        WindowManager.LayoutParams.FLAG_FULLSCREEN,
        WindowManager.LayoutParams.FLAG_FULLSCREEN);

    gameView = new WebView(this);
    gameView.setBackgroundColor(Color.BLACK);
     gameView.setWebViewClient(new WebViewClient() {
       @Override
       public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
         if ("appassets.local".equals(request.getUrl().getHost())) {
           return openGameAsset(request.getUrl());
         }
         return super.shouldInterceptRequest(view, request);
       }

       @Override
       @SuppressWarnings("deprecation")
       public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
         Uri uri = Uri.parse(url);
         if ("appassets.local".equals(uri.getHost())) {
           return openGameAsset(uri);
         }
         return super.shouldInterceptRequest(view, url);
       }
     });
    WebSettings settings = gameView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(true);
    settings.setAllowContentAccess(true);
    settings.setAllowFileAccessFromFileURLs(true);
    settings.setAllowUniversalAccessFromFileURLs(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    setContentView(gameView);
     // Serve the bundled game through a local HTTPS-style origin. ES modules,
     // fetch(), JSON, and WASM are more reliable on this origin than on
     // file:///android_asset URLs, especially on older Android WebViews.
     gameView.loadUrl("https://appassets.local/game/index.html");
  }

   private WebResourceResponse openGameAsset(Uri uri) {
     String assetPath = uri.getPath();
     if (assetPath == null || !assetPath.startsWith("/game/")) return null;
     assetPath = assetPath.substring(1);
     try {
       InputStream stream = getAssets().open(assetPath);
       String extension = MimeTypeMap.getFileExtensionFromUrl(assetPath);
       String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
       if (mime == null && assetPath.endsWith(".js")) mime = "application/javascript";
       if (mime == null && assetPath.endsWith(".mjs")) mime = "application/javascript";
       if (mime == null && assetPath.endsWith(".wasm")) mime = "application/wasm";
       if (mime == null) mime = "application/octet-stream";
       String encoding = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")
           ? "UTF-8" : null;
       return new WebResourceResponse(mime, encoding, stream);
     } catch (IOException error) {
       byte[] message = ("Missing game asset: " + assetPath).getBytes(java.nio.charset.StandardCharsets.UTF_8);
       return new WebResourceResponse(
           "text/plain",
           "UTF-8",
           404,
           "Not Found",
           Collections.<String, String>emptyMap(),
           new ByteArrayInputStream(message));
     }
   }

  @Override
  public void onBackPressed() {
    if (gameView != null && gameView.canGoBack()) gameView.goBack();
    else super.onBackPressed();
  }
}
`,
  };
}

async function writeAndroidProject(projectRoot, gameRoot, title, packageName) {
  const hasAppIcon = fs.existsSync(path.join(gameRoot, "icons", "favicon.png"));
  const files = androidProjectFiles(title, packageName, hasAppIcon);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(projectRoot, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  }
  await fsp.cp(gameRoot, path.join(projectRoot, "app", "src", "main", "assets", "game"), {
    recursive: true,
  });
  if (hasAppIcon) {
    const iconTarget = path.join(projectRoot, "app", "src", "main", "res", "drawable", "app_icon.png");
    await fsp.mkdir(path.dirname(iconTarget), { recursive: true });
    await fsp.copyFile(path.join(gameRoot, "icons", "favicon.png"), iconTarget);
  }
  if (portableGradleAvailable()) {
    for (const relative of ["gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/gradle-wrapper.properties"]) {
      const source = path.join(GRADLE_WRAPPER_SOURCE_DIR, relative);
      if (!fs.existsSync(source)) continue;
      const target = path.join(projectRoot, relative);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target);
    }
    await fsp.chmod(path.join(projectRoot, "gradlew"), 0o755).catch(() => {});
  }
}

async function buildAndroidApk(bundle, options = {}) {
  const title = String(options.title || "ZenEngine Game").trim().slice(0, 80) || "ZenEngine Game";
  const packageName = androidPackageName(title);
  const onProgress = options.onProgress || (() => {});
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "zenengine-apk-"));
  const zipPath = path.join(root, "game.zip");
  const bundleRoot = path.join(root, "bundle");
  const projectRoot = path.join(root, "android");
  try {
    onProgress("Receiving standalone game bundle…");
    await fsp.writeFile(zipPath, bundle);
    await validateAndExtractBundle(zipPath, bundleRoot);
    const sdkRoot = await ensureAndroidSdk(onProgress);
    onProgress("Creating Android game wrapper…");
    await writeAndroidProject(projectRoot, bundleRoot, title, packageName);
    onProgress("Compiling APK…");
    const env = {
      ...process.env,
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
    };
    const gradle = gradleCommand(projectRoot);
    await run(
      gradle.command,
      [...gradle.args, "--no-daemon", "--console=plain", "assembleDebug"],
      { cwd: projectRoot, env, timeout: 20 * 60 * 1000 }
    );
    const apkPath = path.join(projectRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
    const apk = await fsp.readFile(apkPath);
    return {
      apk,
      filename: safeSlug(title) + "-android.apk",
      packageName,
      size: apk.length,
    };
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function handleAndroidExport(req, res, query) {
  try {
    const bundle = await readRequestBody(req);
    const result = await buildAndroidApk(bundle, {
      title: query.get("name") || "ZenEngine Game",
      onProgress: (message) => console.log("[android-export] " + message),
    });
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": result.apk.length,
      "Content-Disposition": 'attachment; filename="' + result.filename + '"',
      "X-ZenEngine-Package": result.packageName,
      "Cache-Control": "no-store",
    });
    res.end(result.apk);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("[android-export] Failed:", error);
    sendJson(res, status, {
      error: error && error.message ? error.message : "Android export failed.",
      hint:
        status === 500
          ? "The server could not finish the Android build. Check the workflow log for the detailed Gradle or SDK error."
          : undefined,
    });
  }
}

async function handleAndroidStatus(res) {
  const sdk = findExistingSdk();
  let gradle = false;
  try {
    const command = portableGradleAvailable()
      ? { command: path.join(GRADLE_WRAPPER_SOURCE_DIR, "gradlew"), args: [], cwd: GRADLE_WRAPPER_SOURCE_DIR }
      : { command: "gradle", args: [], cwd: __dirname };
    await run(command.command, [...command.args, "--version"], { cwd: command.cwd, timeout: 30 * 1000 });
    gradle = true;
  } catch (_) {}
  sendJson(res, 200, {
    ready: gradle,
    androidSdkCached: Boolean(sdk),
    firstBuildDownloadsSdk: !sdk,
    message: sdk
      ? "Android export is ready."
      : "The first APK export will install the Android SDK automatically.",
  });
}

module.exports = {
  buildAndroidApk,
  handleAndroidExport,
  handleAndroidStatus,
};