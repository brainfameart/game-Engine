#!/usr/bin/env node

/**
 * Portable ZenEngine APK exporter.
 *
 * Usage:
 *   node export-apk.js ./my-game.zip
 *   node export-apk.js ./my-game.zip "My Game" ./MyGame.apk
 *
 * This bypasses HTTP entirely, so it works even when the editor is hosted by
 * a static server or a platform that returns 405 for POST requests.
 */

const fs = require("fs").promises;
const path = require("path");
const { buildAndroidApk } = require("./android-export.js");

async function main() {
  const input = process.argv[2];
  const title = process.argv[3] || "ZenEngine Game";
  const output = process.argv[4] || path.join(process.cwd(), "zenengine-game-android.apk");
  if (!input) {
    console.error("Usage: node export-apk.js <standalone-game.zip> [app-name] [output.apk]");
    process.exitCode = 2;
    return;
  }

  const bundle = await fs.readFile(input);
  console.log("Building one APK on this machine…");
  const result = await buildAndroidApk(bundle, {
    title,
    onProgress: (message) => console.log("[android-export] " + message),
  });
  await fs.writeFile(output, result.apk);
  console.log("APK written: " + path.resolve(output));
  console.log("Package: " + result.packageName);
  console.log("Size: " + result.size + " bytes");
}

main().catch((error) => {
  console.error("APK export failed:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});