/**
 * sw.js
 * Offline-first service worker for the complete ZenEngine Hub.
 *
 * The included server exposes /offline-manifest.json, generated from the
 * files beside this service worker. During installation every local engine
 * file is precached, including editor modules, runtime code, fonts, images,
 * physics WASM, and Monaco's worker/chunk files. This avoids a hand-maintained
 * list that could silently miss a newly added engine file.
 */

const CACHE_NAME = "zenengine-offline-v6";
const MANIFEST_URL = "/offline-manifest.json";

const NAVIGATION_ALIASES = {
  "/": "/index.html",
  "/editor": "/project/editor/index.html",
  "/project/editor": "/project/editor/index.html",
  "/play": "/project/player/play.html",
  "/player": "/project/player/play.html",
  "/project/player": "/project/player/play.html",
};

function cleanRequest(request) {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  return new Request(url.href, {
    method: "GET",
    headers: request.headers,
    credentials: request.credentials,
  });
}

async function precacheEverything() {
  const response = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Offline manifest request failed: " + response.status);
  }
  const files = await response.json();
  if (!Array.isArray(files)) throw new Error("Offline manifest is not an array");

  const cache = await caches.open(CACHE_NAME);
  const urls = Array.from(new Set([
    MANIFEST_URL,
    "/sw.js",
    ...files,
  ]));

  // Fetch in modest parallel batches so installation stays quick even when
  // the app is hosted remotely, without opening hundreds of connections at
  // once. Add the URL to the error to make quota or transfer failures clear.
  for (let i = 0; i < urls.length; i += 24) {
    const batch = urls.slice(i, i + 24);
    await Promise.all(batch.map(async (url) => {
      try {
        await cache.add(url);
      } catch (error) {
        throw new Error("Could not cache " + url + ": " + error.message);
      }
    }));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheEverything()
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error("[ZenEngine] Offline precache failed:", error);
        throw error;
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("zenengine-offline-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    // Redirect the friendly aliases to their real document paths even while
    // offline. This preserves the correct base URL for relative imports.
    if (request.mode === "navigate" && NAVIGATION_ALIASES[requestUrl.pathname]) {
      const canonical = new URL(
        NAVIGATION_ALIASES[requestUrl.pathname],
        self.location.origin,
      );
      return Response.redirect(canonical.href, 302);
    }

    const cache = await caches.open(CACHE_NAME);
    const cacheKey = cleanRequest(request);

    // Engine source/configuration files must be NETWORK-FIRST while online.
    // The old cache-first path could keep an older PhysicsWorld/NavWorld or
    // editor module alive after a browser refresh because the service worker
    // intentionally stripped query strings before cache lookup. That made
    // a refreshed engine appear to lose newly fixed physics/nav behavior.
    // Keep the offline cache as the fallback, but always prefer a fresh
    // network response for executable/editor state. Static images/fonts can
    // stay cache-first below because stale pixels do not change engine logic.
    const pathname = requestUrl.pathname.toLowerCase();
    const networkFirst =
      request.mode === "navigate" ||
      /\.(?:html?|js|mjs|css|json|map)$/.test(pathname) ||
      pathname.endsWith(".wasm");

    if (networkFirst) {
      try {
        const network = await fetch(request, { cache: "no-store" });
        if (network.ok) {
          await cache.put(cacheKey, network.clone());
        }
        return network;
      } catch (error) {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const fallback = await cache.match("/index.html");
          if (fallback) return fallback;
        }
        throw error;
      }
    }

    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    try {
      const network = await fetch(request);
      if (network.ok) await cache.put(cacheKey, network.clone());
      return network;
    } catch (error) {
      throw error;
    }
  })());
});
