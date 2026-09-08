# Vaelis Web Export → Android APK contract

Vaelis HTML5 and PWA exports are standalone ZIP packages. The APK build path must consume that ZIP directly; it must not reconstruct the game from editor-only project data.

## Request

`POST /api/v1/build?name=<url-encoded-game-title>`

Headers:

- `Content-Type: application/zip`
- `X-Api-Key: <configured build-server key>`
- `X-ZenEngine-Standalone-Export: 1`
- `X-ZenEngine-Export-Format: html | pwa`

Body: the exact ZIP produced by `ExportGame.buildExport()`.

## Required package entry point

The ZIP must contain `index.html` at its root. The runtime and all referenced assets are relative to that root. Do not rewrite asset URLs to absolute editor/server URLs.

## Android behavior

The APK wrapper should load the bundled `index.html` locally from the APK/WebView asset space. The game should not require the build server, Vercel, or an external asset URL at runtime.

For a PWA source package, `manifest.webmanifest` and `sw.js` may be present. An APK wrapper does not need a browser install prompt or service-worker registration; it should simply load the same `index.html` and bundled runtime/assets. Ignoring service-worker registration inside a native wrapper is acceptable.

## Async response

The existing client expects the build server to return a JSON job ticket containing either top-level or nested `job` data plus a `statusUrl`. The final completed status should provide `downloadUrl`.

This design makes HTML5, PWA, and APK outputs originate from the same generated game package, so a fix to the game runtime is automatically shared by all three targets.
