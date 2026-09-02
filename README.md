# ZenEngine — Portable Engine Distribution

This folder is the standalone ZenEngine distribution. It does not require
Replit and contains no Replit configuration, caches, secrets, or workspace
metadata.

## Requirements

- Node.js 18 or newer
- Java 17 or newer
- Internet access on the first Android export so the Android SDK can be
  downloaded from Google
- Android Studio is **not** required
- Gradle is **not** required: this distribution includes a Gradle wrapper

## Run the editor

From this folder:

```bash
node server.js
```

Open `http://localhost:5000/` and choose **Open Editor**.

Use **Export → Android APK** to create one directly installable
`your-game-android.apk` file. The Android build uses the included server API;
the browser never downloads a ZIP.

## Build an APK without HTTP

If another host serves the editor as static files, it may reject the editor's
POST request with HTTP 405. Use the direct exporter instead:

```bash
node export-apk.js ./my-standalone-game.zip "My Game" ./MyGame.apk
```

The input ZIP must be a standalone ZenEngine game export containing:

- `index.html`
- `main.js`
- `runtime/index.js`

The command produces one APK at the output path. It automatically installs
the required Android SDK components into a local `.cache/zenengine` directory
outside the source distribution.

## Android behavior

- The APK is debug-signed for direct installation and testing.
- The game runs inside a local HTTPS-style WebView asset origin, which keeps
  ES modules, JSON, audio, images, and Rapier WASM working on Android.
- Native Pointer Events are used for modern devices, with raw Touch Events as
  the fallback for older Android WebViews.
- Multi-touch, swipe, pinch, joystick, and pen/stylus input are supported.
- If a favicon is selected in the export dialog, it becomes the Android
  launcher/app thumbnail icon.

## Folder map

- `project/runtime/` — the game engine shipped with games
- `project/editor/` — the development editor
- `project/player/` — the standalone player
- `project/vendor/` — required local Pixi, Hammer, Rapier, Monaco, JSZip, and
  other vendor files
- `android-export.js` — reusable server-side APK builder
- `export-apk.js` — direct command-line APK builder
- `android-tools/gradle-wrapper/` — portable Gradle wrapper files
- `server.js` — dependency-free Node server for the editor and APK API

## What is intentionally not included

This distribution excludes `.replit`, Replit task/skill files, Replit caches,
workspace secrets, Git metadata, temporary archives, and deployment-only
configuration.