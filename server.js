// Minimal static file server for ZenEngine Hub (launcher + editor +
// player + runtime). No build step is used in this project — plain ES
// modules served as-is.
//
// Layout:
//   /                      -> launcher (Hub) app, this is the landing page
//   /project/editor/...    -> the level editor (formerly served at /editor/)
//   /project/player/...    -> the standalone game player (formerly /player/)
//   /project/runtime/...   -> the engine runtime, imported by both of the above
const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleAndroidExport, handleAndroidStatus } = require("./android-export.js");

const ROOT = __dirname;
const PORT = process.env.PORT || 5000;
const OFFLINE_MANIFEST_PATH = "/offline-manifest.json";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

function collectFiles(directory, relativeDirectory = "") {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push("/" + relativePath.split(path.sep).join("/"));
    }
  }
  return files;
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  const query = new URL(req.url, "http://127.0.0.1").searchParams;

  if (req.method === "GET" && urlPath === "/api/android/status") {
    handleAndroidStatus(res);
    return;
  }
  if (req.method === "POST" && urlPath === "/api/android/export") {
    handleAndroidExport(req, res, query);
    return;
  }

  // The service worker uses this generated list to precache every file in
  // the archive. Keeping it server-generated means new local engine files
  // automatically become offline-capable without another manifest edit.
  if (urlPath === OFFLINE_MANIFEST_PATH) {
    const files = Array.from(new Set([
      ...collectFiles(ROOT),
      OFFLINE_MANIFEST_PATH,
    ])).sort();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(files));
    return;
  }

  // Redirect (not rewrite) so the browser's document URL actually becomes
  // the target path — otherwise relative imports/links (./main.js,
  // ./styles/editor.css) would resolve against the wrong directory.
  if (urlPath === "/") {
    res.writeHead(302, { Location: "/index.html" });
    res.end();
    return;
  }
  if (urlPath === "/editor" || urlPath === "/project/editor") {
    res.writeHead(302, { Location: "/project/editor/index.html" });
    res.end();
    return;
  }
  if (urlPath === "/play" || urlPath === "/player" || urlPath === "/project/player") {
    res.writeHead(302, { Location: "/project/player/play.html" });
    res.end();
    return;
  }

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ZenEngine Hub server running on http://0.0.0.0:${PORT}`);
  console.log(`Launcher: /   Editor: /project/editor/index.html   Player: /project/player/play.html`);
});
