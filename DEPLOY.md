# Vaelis — split deployment

This is your engine split into two pieces:

- `vaelis-vercel/` — the editor UI, runtime, player. Deploy this to Vercel
  as a static site. No server logic runs here.
- `vaelis-server/` — the Android APK export backend only. Deploy this to
  Replit (or later Railway/Fly/a VPS via the included Dockerfile). This is
  the piece that needs Java + the Android SDK + Gradle.

## 1. Deploy vaelis-server to Replit

1. Create a new Replit project, "Import from folder" (or push this folder to
   a GitHub repo and import that).
2. Replit will detect `.replit` and `replit.nix` and install Node 20 + Java 17
   automatically.
3. Generate a random API key for yourself, e.g. run this in any terminal:
   `openssl rand -hex 24`
   Copy the output somewhere safe — you'll paste it in two places below.
4. In Replit, open the "Secrets" (lock icon) panel and add:
   - `API_KEY` = the random value from step 3
   - `ALLOWED_ORIGIN` = your future Vercel URL, e.g.
     `https://your-project.vercel.app` (comma-separate if you have more
     than one URL, e.g. a preview + production domain)
5. Click Run. It starts `node server.js` and prints the URL, something like:
   `https://vaelis-server.yourname.repl.co`
6. The first APK export will be slow — it downloads and caches the Android
   SDK. Every export after that reuses the cache.

Without `API_KEY` set, the export endpoint is open to anyone who has (or
guesses) the URL. With it set, every request needs a matching `X-Api-Key`
header — see step 3 below for wiring that into the editor. A request rate
limit (5 APK builds/hour/IP, 30 general requests/min/IP) is always on,
regardless of whether API_KEY is set.

## 2. Deploy vaelis-vercel to Vercel

1. Push `vaelis-vercel/` to a GitHub repo (or use the Vercel CLI: `vercel`
   from inside this folder).
2. Vercel auto-detects it as static — no build command needed.
3. Once deployed, note your URL, e.g. `https://your-project.vercel.app`.

## 3. Connect the two

Open `vaelis-vercel/project/editor/state/ServerConfig.js` and set:

```js
export const ANDROID_EXPORT_SERVER_URL = "https://vaelis-server.yourname.repl.co";
export const ANDROID_EXPORT_API_KEY = "the same random value from step 1.3";
```

Redeploy the Vercel side (push the change, Vercel auto-redeploys).

Note: this API key ends up inside the JS bundle Vercel serves, so anyone
who opens devtools can read it. It stops casual/accidental abuse of your
build quota, not a determined attacker. That's an acceptable tradeoff for
a personal project — it is not real authentication.

## Notes

- If Replit's free tier has been idle, the first request after waking may be
  slow (cold start + possible SDK re-cache). This is expected, not a bug.
- `vaelis-server/Dockerfile` exists so you can move this exact server
  folder to Railway, Fly.io, or a VPS later with no code changes — just
  point a Docker-based host at the folder and set the same `API_KEY` and
  `ALLOWED_ORIGIN` env vars there too.
- The editor's non-Android exports (plain HTML5 ZIP, etc.) still work
  entirely client-side on Vercel — only the Android/APK path needs the
  separate server.
