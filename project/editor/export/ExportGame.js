/**
 * editor/export/ExportGame.js
 *
 * Builds a real, standalone, ownership-transferred export of the
 * current project — a .zip the user can unzip and open (or host)
 * completely independently of ZenEngine's editor. This is NOT the
 * same file as ProjectIO.js's exportProject(): that one is a re-
 * loadable PROJECT save (keeps editor-only data like the full asset
 * catalogue as base64 JSON, scripts.json, layers.json, etc, so the
 * project can be re-opened for further editing). This one is a
 * PLAYABLE GAME BUILD: no editor code, no Monaco, no project-catalogue
 * JSON, no way to re-import it into the editor — just the runtime
 * files + scene data + converted assets needed to run the game alone.
 *
 * Ownership: the exported game is the ORIGINAL, not a copy running
 * inside anything else. It boots its own PIXI.Application sized to
 * the real browser window (see buildMainJs() below, adapted directly
 * from player/main.js — the same file already used for this exact
 * purpose) and drives its own requestAnimationFrame loop with nothing
 * else attached to that loop. It never shares a JS event loop, a GPU
 * context, or a CPU frame budget with the editor — unlike the editor's
 * own Play-mode popup (editor/viewport/play-popup.js), which is
 * legitimately still "inside" the editor's browser tab/process even
 * though it's a separate window, an exported build opened in its own
 * tab (or hosted and opened fresh) has nothing else competing for its
 * frame time, so it runs at the FPS the device can actually sustain.
 *
 * Asset handling (see TranscodeAssets.js + UsedAssets.js):
 *   - Every sprite/audio asset is re-encoded to a smaller delivery
 *     format (AVIF/WebP for images, Opus/WebM for audio) and written
 *     as its own REAL BINARY FILE under assets/ — never re-embedded as
 *     a base64 string anywhere in the export. This is what keeps the
 *     export's payload size proportional to the actual compressed
 *     asset bytes instead of the ~33% base64 inflation ProjectIO.js's
 *     project-save format deliberately still uses (a project SAVE
 *     needs the dataUrl round-trip fidelity that format buys it — see
 *     that file's own doc comment — a GAME BUILD does not).
 *   - Assets never referenced by any scene, prefab, or script (see
 *     UsedAssets.js) are left out of the export entirely.
 *
 * Runtime files: everything under /runtime (see RUNTIME_FILES below)
 * plus the exact vendor files the runtime actually imports (PIXI,
 * Rapier's .mjs + its one .wasm file — NOT Rapier's .d.ts/.map/.cjs
 * files, which only exist for editor tooling/TypeScript and add ~3MB
 * of dead weight to a build that will never read them) plus Hammer.js
 * (touch gesture support — runtime/scripting/ScriptAPI.js's touch API
 * optionally uses it). No /editor file is ever referenced, so deleting
 * /editor entirely (see player/main.js's own file header, which
 * already states this invariant for the exact same reason) cannot
 * break an exported build.
 *
 * EDITOR-ONLY FILE.
 */

import { findUsedAssetKeys } from "./UsedAssets.js";
import { transcodeImage, transcodeAudio, renderIconPng } from "./TranscodeAssets.js";
import { getAllScripts, getScriptSource } from "../scripting/ScriptStorage.js";
import { ENGINE_VERSION } from "../../runtime/EngineVersion.js";

/**
 * Every /runtime file the exported build needs, relative to
 * project/runtime/. Kept as an explicit list (not "everything found by
 * walking the directory at export time") so a stray editor-debug file
 * accidentally dropped into /runtime can never silently ship in a
 * build, and so this list is easy to audit/extend right alongside
 * wherever a new runtime file gets added. Excludes every *.test.mjs —
 * those are dev-only and never imported by runtime/index.js's own
 * import graph.
 */
const RUNTIME_FILES = [
  "EngineVersion.js",
  "assets/AssetManager.js",
  "assets/AssetRegistry.js",
  "components/AudioListener.js",
  "components/AudioSource.js",
  "components/Camera.js",
  "components/CharacterController.js",
  "components/ChatLog.js",
  "components/Collider2D.js",
  "components/Joystick.js",
  "components/Light.js",
  "components/LightingSettings.js",
  "components/NavAgent2D.js",
  "components/NavWorld2D.js",
  "components/Rigidbody2D.js",
  "components/Script.js",
  "components/ShadowCaster.js",
  "components/ShapeRenderer.js",
  "components/SpeechBubble.js",
  "components/SpriteAnimation.js",
  "components/SpriteRenderer.js",
  "components/TextInput.js",
  "components/TextRenderer.js",
  "components/Tilemap.js",
  "components/Tileset.js",
  "components/Transform.js",
  "core/CameraUtils.js",
  "core/Entity.js",
  "core/GameLoop.js",
  "core/System.js",
  "core/World.js",
  "index.js",
  "pathfinding/AStar.js",
  "pathfinding/NavWorldBaker.js",
  "physics/ColliderGeometry.js",
  "physics/PhysicsWorld.js",
  "physics/RapierLoader.js",
  "prefabs/PrefabPropagation.js",
  "prefabs/PrefabRegistry.js",
  "scene/SceneLoader.js",
  "scene/SceneManager.js",
  "scene/SceneSerializer.js",
  "scripting/CastSyntax.js",
  "scripting/NavAPI.js",
  "scripting/SaveStore.js",
  "scripting/ScriptAPI.js",
  "scripting/components/AnimatorAPI.js",
  "scripting/components/AudioAPI.js",
  "scripting/components/AudioListenerAPI.js",
  "scripting/components/CameraAPI.js",
  "scripting/components/ChatLogAPI.js",
  "scripting/components/ColliderAPI.js",
  "scripting/components/ControllerAPI.js",
  "scripting/components/JoystickAPI.js",
  "scripting/components/LightAPI.js",
  "scripting/components/NavAgentAPI.js",
  "scripting/components/RigidbodyAPI.js",
  "scripting/components/SaveAPI.js",
  "scripting/components/ShapeAPI.js",
  "scripting/components/SpeechBubbleAPI.js",
  "scripting/components/SpriteAPI.js",
  "scripting/components/StateAPI.js",
  "scripting/components/TextAPI.js",
  "scripting/components/TextInputAPI.js",
  "scripting/components/TouchTrackAPI.js",
  "scripting/components/TransformAPI.js",
  "systems/AnimationSystem.js",
  "systems/AudioListenerSystem.js",
  "systems/AudioSystem.js",
  "systems/AutoTileRules.js",
  "systems/CameraRenderSystem.js",
  "systems/ControllerSystem.js",
  "systems/JoystickSystem.js",
  "systems/LightGlowFilter.js",
  "systems/LightTextureShaderSource.js",
  "systems/LightingQuality.js",
  "systems/LightingShaderSource.js",
  "systems/LightingSystem.js",
  "systems/NavWorldSystem.js",
  "systems/PhysicsSystem.js",
  "systems/RenderSystem.js",
  "systems/ScriptSystem.js",
  "systems/SpeechBubbleSystem.js",
  "systems/SpriteLightFilter.js",
  "systems/TextInputSystem.js",
  "systems/TilemapSystem.js",
];

/** Vendor files actually imported by the runtime — see file header. */
const VENDOR_FILES = [
  { src: "vendor/pixi/pixi.min.js", dest: "vendor/pixi/pixi.min.js" },
  { src: "vendor/hammer/hammer.min.js", dest: "vendor/hammer/hammer.min.js" },
  {
    src: "vendor/@dimforge/rapier2d-compat/dist/rapier.mjs",
    dest: "vendor/@dimforge/rapier2d-compat/dist/rapier.mjs",
  },
  {
    src: "vendor/@dimforge/rapier2d-compat/dist/rapier_wasm2d_bg.wasm",
    dest: "vendor/@dimforge/rapier2d-compat/dist/rapier_wasm2d_bg.wasm",
  },
];

/**
 * Fetches one of the editor's OWN static files as raw bytes, so the
 * exact same bundled vendor/runtime source this editor session is
 * running (not a re-download, not a different version) is what gets
 * packed into the export. Works because /project/runtime and
 * /project/vendor are served as plain static files right alongside
 * the editor itself (see server.js) — export never needs network
 * access to anywhere outside this same origin.
 * @param {string} relativePath relative to project/editor/export/ (this file)
 * @returns {Promise<Uint8Array>}
 */
async function fetchLocalFile(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const res = await fetch(url.href);
  if (!res.ok) throw new Error("Failed to read " + relativePath + " (" + res.status + ")");
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * @param {string} name
 * @returns {string} lowercase, filesystem/URL-safe slug
 */
function slugify(name) {
  return (name || "game").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "") || "game";
}

/**
 * Builds the exported game's standalone bootstrap script — the same
 * boot sequence as player/main.js (real-window-sized PIXI app,
 * followMainCamera:true so RenderSystem/computeScreenFit fit the Main
 * Camera's reference resolution into the real screen exactly like the
 * editor's Play popup previews it — see CameraUtils.js), adapted only
 * in how assets are registered: real relative file URLs (assets/...)
 * instead of the editor's in-memory dataUrl catalogue, since an
 * exported build has no AssetRegistry/editor session to read from.
 *
 * @param {{ spriteManifest: Array<{key:string,file:string}>, audioManifest: Array<{key:string,file:string}>, gameFps: number }} opts
 * @returns {string} JS source for main.js
 */
function buildMainJs(opts) {
  const spriteManifest = opts.spriteManifest;
  const audioManifest = opts.audioManifest;
  const gameFps = opts.gameFps;
  return [
    "/**",
    " * main.js — standalone exported ZenEngine game.",
    " * Generated by ZenEngine's Export feature. Imports ONLY from ./runtime —",
    " * this file + index.html is the entire game. No editor code is present",
    " * or required; this build owns its own render loop outright and does",
    " * not share CPU/GPU time with anything else.",
    " */",
    'import { createGame } from "./runtime/index.js";',
    'import { registerTexture, registerAudio } from "./runtime/assets/AssetManager.js";',
    'import { RenderSystem } from "./runtime/systems/RenderSystem.js";',
    'import { CAMERA } from "./runtime/components/Camera.js";',
    'import { TRANSFORM } from "./runtime/components/Transform.js";',
    "",
    "const SPRITE_MANIFEST = " + JSON.stringify(spriteManifest) + ";",
    "const AUDIO_MANIFEST = " + JSON.stringify(audioManifest) + ";",
    "",
    "function loadSpriteAssets() {",
    "  const loads = SPRITE_MANIFEST.map(function (entry) {",
    "    return new Promise(function (resolve) {",
    "      try {",
    "        const texture = PIXI.Texture.from(entry.file);",
    "        if (texture.baseTexture.valid) {",
    "          registerTexture(entry.key, texture);",
    "          resolve();",
    "        } else {",
    '          texture.baseTexture.once("loaded", function () { registerTexture(entry.key, texture); resolve(); });',
    '          texture.baseTexture.once("error", function () { console.error("[game] Failed to load sprite:", entry.file); resolve(); });',
    "        }",
    "      } catch (err) {",
    '        console.error("[game] Failed to load sprite:", entry.file, err);',
    "        resolve();",
    "      }",
    "    });",
    "  });",
    "  return Promise.all(loads);",
    "}",
    "",
    "function loadAudioAssets() {",
    "  for (const entry of AUDIO_MANIFEST) registerAudio(entry.key, entry.file);",
    "}",
    "",
    "async function boot() {",
    '  const mount = document.getElementById("game-canvas");',
    "",
    "  const pixiApp = new PIXI.Application({",
    "    width: mount.clientWidth || window.innerWidth,",
    "    height: mount.clientHeight || window.innerHeight,",
    "    backgroundColor: 0x000000,",
    "    antialias: true,",
    "    autoDensity: true,",
    "    resolution: window.devicePixelRatio || 1,",
    "  });",
    "  mount.appendChild(pixiApp.view);",
    "",
    "  await loadSpriteAssets();",
    "  loadAudioAssets();",
    "",
    '  const game = createGame({ pixiApp, followMainCamera: true, gameId: document.title || "zenengine-game" });',
    "  game.loop.setTargetFps(" + JSON.stringify(gameFps || 0) + ");",
    "",
    "  try {",
    '    await game.loadScene("./scene.json");',
    "  } catch (err) {",
    '    console.error("[game] Failed to load scene.json", err);',
    "  }",
    "",
    "  try { await game.saveReady; } catch (err) { /* start with an empty save */ }",
    "",
    "  const validation = game.validate();",
    '  if (!validation.ok) console.error("[game] Scene validation failed:", validation.errors);',
    "",
    "  const mainCameraEntity = game.world.query(TRANSFORM, CAMERA).find(function (e) { return e.getComponent(CAMERA).isMain; });",
    "  if (mainCameraEntity) {",
    "    RenderSystem.applyBackgroundColor(pixiApp, mainCameraEntity.getComponent(CAMERA).backgroundColor);",
    "  }",
    "",
    '  window.addEventListener("resize", function () {',
    "    pixiApp.renderer.resize(mount.clientWidth, mount.clientHeight);",
    "  });",
    "",
    "  game.loop.start();",
    "  window.__zengineGame = game;",
    "}",
    "",
    "boot();",
    "",
  ].join("\n");
}

/**
 * @param {string} title
 * @param {boolean} pwa whether to add the manifest link + SW registration
 * @param {boolean} hasFavicon whether icons/favicon.png was written into
 *   this export (see buildExport()'s icon-writing step) — controls
 *   whether index.html points at the actual icon file or falls back to
 *   the browser's default (no <link rel="icon"> at all) rather than
 *   referencing a file that was never written.
 * @returns {string}
 */
function buildIndexHtml(title, pwa, hasFavicon) {
  const iconHref = pwa ? "./icons/icon-192.png" : "./icons/favicon.png";
  const pwaHead = pwa
    ? '<link rel="manifest" href="./manifest.webmanifest" />\n<meta name="theme-color" content="#000000" />\n' +
      (hasFavicon ? '<link rel="icon" href="' + iconHref + '" />\n<link rel="apple-touch-icon" href="' + iconHref + '" />\n' : "")
    : hasFavicon
    ? '<link rel="icon" type="image/png" href="' + iconHref + '" />\n'
    : "";
  const pwaBody = pwa
    ? '  <script>\n    if ("serviceWorker" in navigator) {\n      window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js"); });\n    }\n  </script>\n'
    : "";
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />\n' +
    "<title>" + escapeHtml(title) + "</title>\n" +
    pwaHead +
    '<script src="./vendor/pixi/pixi.min.js"></script>\n<script src="./vendor/hammer/hammer.min.js"></script>\n' +
    "<style>\n  html, body { height: 100%; margin: 0; padding: 0; background: #000; overflow: hidden; }\n" +
    "  #game-canvas { width: 100vw; height: 100vh; }\n  #game-canvas canvas { display: block; }\n</style>\n" +
    '</head>\n<body>\n  <div id="game-canvas"></div>\n  <script type="module" src="./main.js"></script>\n' +
    pwaBody +
    "</body>\n</html>\n"
  );
}

function escapeHtml(s) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s || "").replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Builds a minimal offline-cache-everything service worker for the PWA
 * export — precaches every file the game actually ships (the exact
 * manifest ExportGame builds, not a guessed list) and serves from
 * cache-first afterward so the exported game works fully offline once
 * installed, matching the top-level launcher's own sw.js philosophy.
 * @param {string[]} files every file path in the export, root-relative
 * @param {string} cacheName
 * @returns {string}
 */
function buildServiceWorker(files, cacheName) {
  return (
    "const CACHE_NAME = " + JSON.stringify(cacheName) + ";\n" +
    "const FILES = " + JSON.stringify(files) + ";\n\n" +
    'self.addEventListener("install", function (event) {\n' +
    "  event.waitUntil(\n" +
    "    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(FILES); }).then(function () { return self.skipWaiting(); })\n" +
    "  );\n});\n\n" +
    'self.addEventListener("activate", function (event) {\n' +
    "  event.waitUntil(\n" +
    "    caches.keys().then(function (names) {\n" +
    "      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));\n" +
    "    }).then(function () { return self.clients.claim(); })\n" +
    "  );\n});\n\n" +
    'self.addEventListener("fetch", function (event) {\n' +
    '  if (event.request.method !== "GET") return;\n' +
    "  event.respondWith(\n" +
    "    caches.match(event.request).then(function (cached) { return cached || fetch(event.request); })\n" +
    "  );\n});\n"
  );
}

/**
 * @param {string} name
 * @param {string} slug
 * @returns {object} plain manifest object (ExportGame writes it as JSON)
 */
function buildWebManifest(name, slug) {
  return {
    name,
    short_name: name.slice(0, 30) || slug,
    start_url: "./index.html",
    scope: "./",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "any",
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * @param {string} key original asset key (already filesystem-safe —
 *   see AssetRegistry.js's sanitizeName())
 * @param {string} ext
 * @returns {string}
 */
function safeAssetFilename(key, ext) {
  return key + "." + ext;
}

function buildExportInfo(opts) {
  return (
    "ZenEngine Export\n================\n" +
    "Engine version: " + opts.engineVersion + "\n" +
    "Format: " + (opts.format === "pwa" ? "PWA (installable, offline-capable)" : "HTML5 (static site)") + "\n\n" +
    "This is a complete, standalone game. It does not require ZenEngine's\n" +
    "editor to run — open index.html through a local web server (ES modules\n" +
    "require http:// or https://, not file://) or upload this whole folder\n" +
    "to any static host.\n\n" +
    "Assets: " + opts.spriteCount + " image(s), " + opts.audioCount + " audio clip(s) included.\n" +
    "Unused assets skipped: " + opts.skippedSprites + " image(s), " + opts.skippedAudio + " audio clip(s).\n" +
    "Images were re-encoded to AVIF or WebP where supported by the browser\n" +
    "that exported this build (falling back to the original format\n" +
    "otherwise). Audio was re-encoded to Opus/WebM where supported.\n"
  );
}

/**
 * Runs the full export pipeline and returns a completed JSZip instance
 * ready for generateAsync() — building the final blob/download is left
 * to the caller (ExportWindow.js) so both the HTML5 and PWA formats
 * can share every step here and only branch on the small bits that
 * actually differ (manifest.webmanifest, sw.js, index.html's two extra tags).
 *
 * @param {ReturnType<import('../../runtime/index.js').createGame>} game
 * @param {object} options
 * @param {string} options.projectName
 * @param {"html"|"pwa"} options.format
 * @param {string|null} [options.faviconDataUrl] a favicon/app-icon image
 *   the user picked in the Export popup, as a "data:image/...;base64,..."
 *   string — see ExportWindow.js's details step and TranscodeAssets.js's
 *   renderIconPng(). When omitted, the export falls back to ZenEngine's
 *   own default icons for PWA (needs SOME icon for its manifest to be
 *   valid) and ships no favicon at all for plain HTML5 (a generic
 *   engine icon in someone's shipped game would be more confusing than
 *   no icon).
 * @param {(msg:string)=>void} [options.onProgress]
 * @returns {Promise<{ zip: object, stats: object }>}
 */
export async function buildExport(game, options) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip failed to load — check your network connection and reload the editor.");
  }
  const projectName = options.projectName;
  const format = options.format;
  const faviconDataUrl = options.faviconDataUrl || null;
  const onProgress = options.onProgress || function () {};
  const slug = slugify(projectName);
  const title = (projectName || "ZenEngine Game").trim() || "ZenEngine Game";

  game.saveActiveScene();

  // --- 1. Figure out which assets are actually used (see UsedAssets.js) ---
  onProgress("Scanning project for used assets…");
  const allScriptSources = getAllScripts().map((name) => getScriptSource(name));
  const usedKeys = findUsedAssetKeys(game, allScriptSources);
  const usedSpriteKeys = usedKeys.usedSpriteKeys;
  const usedAudioKeys = usedKeys.usedAudioKeys;

  const allSprites = [...game.getAllSpriteAssets(), ...game.getAllFrameAssets()];
  const allAudio = game.getAllAudioAssets();
  const usedSprites = allSprites.filter((r) => usedSpriteKeys.has(r.key));
  const usedAudio = allAudio.filter((r) => usedAudioKeys.has(r.key));

  const zip = new JSZip();

  // --- 2. Runtime + vendor files, read straight from this same origin ---
  onProgress("Packing runtime files…");
  const runtimeFolder = zip.folder("runtime");
  for (const relPath of RUNTIME_FILES) {
    const bytes = await fetchLocalFile("../../runtime/" + relPath);
    runtimeFolder.file(relPath, bytes);
  }
  for (const entry of VENDOR_FILES) {
    const bytes = await fetchLocalFile("../../" + entry.src);
    zip.file(entry.dest, bytes);
  }

  // --- 3. Transcode + write used assets as real binary files ---
  const spriteManifest = [];
  const audioManifest = [];
  let bytesBefore = 0;
  let bytesAfter = 0;
  const spritesFolder = zip.folder("assets/sprites");
  const audioFolder = zip.folder("assets/audio");

  for (let i = 0; i < usedSprites.length; i++) {
    const rec = usedSprites[i];
    onProgress("Converting images… (" + (i + 1) + "/" + usedSprites.length + ")");
    const result = await transcodeImage(rec.dataUrl);
    const filename = safeAssetFilename(rec.key, result.ext);
    spritesFolder.file(filename, result.bytes);
    spriteManifest.push({ key: rec.key, file: "assets/sprites/" + filename });
    bytesBefore += result.originalBytes;
    bytesAfter += result.bytes.length;
  }

  for (let i = 0; i < usedAudio.length; i++) {
    const rec = usedAudio[i];
    onProgress("Converting audio… (" + (i + 1) + "/" + usedAudio.length + ") — this can take as long as the clip itself");
    const result = await transcodeAudio(rec.dataUrl);
    const filename = safeAssetFilename(rec.key, result.ext);
    audioFolder.file(filename, result.bytes);
    audioManifest.push({ key: rec.key, file: "assets/audio/" + filename });
    bytesBefore += result.originalBytes;
    bytesAfter += result.bytes.length;
  }

  // --- 4. Scenes (camera settings live on the Camera component inside
  //     each scene's own data, so they travel automatically here —
  //     the exported main.js's followMainCamera:true + RenderSystem/
  //     CameraUtils.js do the rest, identically to the Play popup). ---
  onProgress("Writing scenes…");
  const allScenes = game.getAllScenesData();
  const activeSceneId = game.getActiveSceneId();
  const activeScene = allScenes.find((s) => s.id === activeSceneId) || allScenes[0];
  zip.file("scene.json", JSON.stringify(activeScene ? activeScene.data : {}));
  const scenesFolder = zip.folder("scenes");
  for (const scene of allScenes) {
    scenesFolder.file(scene.id + ".json", JSON.stringify({ id: scene.id, name: scene.name, data: scene.data }));
  }
  zip.file("scenes/index.json", JSON.stringify(allScenes.map((s) => ({ id: s.id, name: s.name, file: s.id + ".json" }))));

  onProgress("Writing prefabs…");
  zip.file("prefabs.json", JSON.stringify(game.getAllPrefabs()));

  // --- 5. Favicon / app icon ---
  // Written before index.html/manifest below so both know whether a
  // real icon file exists to point at (see buildIndexHtml()'s
  // `hasFavicon` param and buildWebManifest()'s icons list).
  let hasFavicon = false;
  if (faviconDataUrl) {
    onProgress("Building icons…");
    try {
      if (format === "pwa") {
        // A manifest needs multiple declared sizes — see
        // buildWebManifest() — so render the user's one source image
        // at each required size rather than shipping one size and
        // letting the OS upscale/downscale it at install time.
        const icon192 = await renderIconPng(faviconDataUrl, 192);
        const icon512 = await renderIconPng(faviconDataUrl, 512);
        zip.file("icons/icon-192.png", icon192);
        zip.file("icons/icon-512.png", icon512);
        // No separate maskable source was collected from the user (a
        // real maskable icon needs safe-zone padding authored on
        // purpose, which a single generic upload can't provide
        // correctly) — reuse the 512 icon rather than shipping a
        // manifest entry that points at a file that doesn't exist.
        zip.file("icons/icon-512-maskable.png", icon512);
      } else {
        const favicon = await renderIconPng(faviconDataUrl, 192);
        zip.file("icons/favicon.png", favicon);
      }
      hasFavicon = true;
    } catch (err) {
      console.warn("[export] Could not render the provided favicon, continuing without one:", err);
    }
  }
  if (!hasFavicon && format === "pwa") {
    // No favicon provided (or it failed to render) but PWA still needs
    // SOME icon set for a valid manifest — fall back to ZenEngine's
    // own default icons, same as before this feature existed.
    onProgress("Adding offline support…");
    try {
      for (const iconFile of ["icon-192.png", "icon-512.png", "icon-512-maskable.png"]) {
        const bytes = await fetchLocalFile("../../../icons/" + iconFile);
        zip.file("icons/" + iconFile, bytes);
      }
      hasFavicon = true;
    } catch (err) {
      console.warn("[export] Could not bundle default PWA icons:", err);
    }
  }

  // --- 6. Bootstrap files ---
  onProgress("Writing game files…");
  zip.file("main.js", buildMainJs({ spriteManifest, audioManifest, gameFps: 0 }));
  zip.file("index.html", buildIndexHtml(title, format === "pwa", hasFavicon));
  zip.file(
    "EXPORT_INFO.txt",
    buildExportInfo({
      engineVersion: ENGINE_VERSION,
      format,
      spriteCount: usedSprites.length,
      audioCount: usedAudio.length,
      skippedSprites: allSprites.length - usedSprites.length,
      skippedAudio: allAudio.length - usedAudio.length,
    })
  );

  if (format === "pwa") {
    onProgress("Adding offline support…");
    const manifest = buildWebManifest(title, slug);
    zip.file("manifest.webmanifest", JSON.stringify(manifest, null, 2));
    // Precache list = every file already added to the zip at this
    // point, plus sw.js itself — built from the real zip contents so
    // it can never drift from what's actually shipped (see
    // buildServiceWorker()'s own doc comment).
    const precacheList = [];
    zip.forEach((relPath, fileObj) => {
      if (!fileObj.dir) precacheList.push("./" + relPath);
    });
    zip.file("sw.js", buildServiceWorker(precacheList, "zenengine-game-" + slug + "-v1"));
  }

  return {
    zip,
    stats: {
      spriteCount: usedSprites.length,
      audioCount: usedAudio.length,
      skippedSpriteCount: allSprites.length - usedSprites.length,
      skippedAudioCount: allAudio.length - usedAudio.length,
      bytesBefore,
      bytesAfter,
    },
  };
}

/**
 * @param {string} name
 * @returns {string} filesystem-safe download filename base (no extension)
 */
export function slugifyForFilename(name) {
  return slugify(name);
}
