# Offline PWA support

The ZenEngine Hub now precaches the complete local engine from
`/offline-manifest.json` during service-worker installation. That includes the
launcher, editor, player, runtime modules, local fonts, Rapier WASM, and every
Monaco Editor worker/chunk.

1. Start the included server with `node server.js`.
2. Open `http://localhost:5000/index.html` once while connected.
3. Wait for the first page to finish loading so the service worker can finish
   its precache.
4. Install the PWA from the browser, then it can be relaunched without a
   network connection.

The service worker also handles the `/editor`, `/play`, and `/player` aliases
while offline, preserving the canonical document URL so relative ES-module
imports continue to work.