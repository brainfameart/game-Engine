# Fix: exported games show "Game failed to load" / black screen with SW MIME error

File changed: `project/editor/export/ExportGame.js`
(This is the ONLY file that needed to change — it's the single source used
by HTML5, PWA, and APK export, per ANDROID_EXPORT_CONTRACT.md, so this one
fix covers all three formats.)

## Root cause #1 (the actual game-breaking bug)

`RUNTIME_FILES` (the explicit manifest of runtime files copied into every
export) was missing two files that `runtime/scripting/ScriptAPI.js` always
imports at module load time:

  - scripting/components/LightingSettingsAPI.js
  - scripting/components/ShadowCasterAPI.js

Because `main.js` is loaded as an ES module (`<script type="module">`), a
missing import is a hard failure of the whole module graph — not just a
missing feature. On most static hosts / preview proxies, a 404 for a JS
file gets rewritten to serve `index.html` (SPA fallback) instead of a
real 404. The browser then tries to parse HTML as JavaScript and throws
a syntax/parse error, which is exactly the "black screen, then error
after ~12s" behavior you saw. This affected essentially any exported
project, since ScriptAPI.js is part of the core scripting surface.

Fix: added both files to `RUNTIME_FILES` so they're always included in
every exported build (HTML5, PWA, APK).

## Root cause #2 (the ServiceWorker error message specifically)

In PWA exports, `navigator.serviceWorker.register()` was called with no
`.catch()`. If the host serves `sw.js` back as `text/html` (again, the
SPA-fallback-on-404 behavior — this is what your error message was
reporting verbatim), registration throws, and since nothing caught it,
it became an unhandled promise rejection. The generated `index.html`
already had a global `unhandledrejection` listener whose job is to show
the "Game failed to load" overlay — and it was treating that SW failure
as fatal, painting over the game even on runs where the canvas had
already booted successfully underneath it.

Fix:
  - `.catch()` added to the SW registration; failure is now logged as a
    warning only and never surfaces as a fatal error.
  - The `unhandledrejection` and `error` listeners in the generated
    `index.html` now bail out early if (a) the message mentions
    "service worker", or (b) the game canvas already has content
    (i.e. boot() already succeeded) — so a cosmetic offline-support
    failure can never hide a working game behind an error screen again.

## What you need to do

Replace your existing `project/editor/export/ExportGame.js` with this one,
redeploy the editor, and re-export your game (HTML5, PWA, or APK — all
three go through this same code). Existing already-exported zips will
still have the bug baked in; you need a fresh export after this fix.
