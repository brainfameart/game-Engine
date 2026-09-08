// Android APK export: where the build requests go, and how the user
// tells the editor which server to use.
//
// This editor is deployed as static files (e.g. on Vercel), which cannot
// run the Android/Gradle build itself. The actual build happens on a
// separate server that turns the uploaded project zip into an APK.
//
// EACH USER RUNS/OWNS THEIR OWN BUILD SERVER (or points at whichever one
// they've been given access to) rather than everyone sharing one baked
// into this file. That avoids one shared server/API key being hardcoded
// into the shipped editor bundle (visible to anyone via devtools) and
// having to absorb every user's build load on one host.
//
// Flow: the user visits a companion website (ANDROID_KEYGEN_SITE_URL
// below) where they can spin up / connect a build server and generate an
// API key for it, then pastes the resulting "server URL" + "API key"
// pair into the Export popup's Android card. A user can have more than
// one such pair saved (e.g. a personal server and a team one) and switch
// between them — see the credential-list functions below.

// TODO: fill in once the key-generation site is live. Shown as a "Get an
// API key →" link in the Export popup's Android card.
export const ANDROID_KEYGEN_SITE_URL = "https://example.com/vaelis-android-build";

const STORAGE_KEY = "zenengine.androidBuildServers";

// Shape of a saved credential entry:
//   { id: string, label: string, serverUrl: string, apiKey: string }
// `id` is a stable identifier (not shown to the user) so the "active"
// pointer survives a rename of `label`.

function _loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { servers: [], activeId: null };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.servers)) return { servers: [], activeId: null };
    return { servers: parsed.servers, activeId: parsed.activeId || null };
  } catch (_) {
    // Corrupt localStorage (manual edit, old format, etc.) — don't crash
    // the editor over it, just treat it as empty.
    return { servers: [], activeId: null };
  }
}

function _saveAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {
    // Storage full/disabled — the in-memory state (held by the caller,
    // e.g. editorState) still works for this session, it just won't
    // persist across reloads. Nothing to do about that here.
  }
}

export function listAndroidServers() {
  return _loadAll().servers;
}

export function getActiveAndroidServer() {
  const { servers, activeId } = _loadAll();
  if (servers.length === 0) return null;
  return servers.find((s) => s.id === activeId) || servers[0];
}

export function setActiveAndroidServer(id) {
  const data = _loadAll();
  if (!data.servers.some((s) => s.id === id)) return;
  data.activeId = id;
  _saveAll(data);
}

// Adds a new saved server, or updates one in place if editingId matches
// an existing entry (used by the Export popup's "add/edit server" form).
// Returns the entry's id.
export function saveAndroidServer({ label, serverUrl, apiKey }, editingId = null) {
  const data = _loadAll();
  const cleanUrl = String(serverUrl || "").trim().replace(/\/+$/, "");
  const cleanKey = String(apiKey || "").trim();
  const cleanLabel = String(label || "").trim() || cleanUrl.replace(/^https?:\/\//, "");

  if (editingId) {
    const existing = data.servers.find((s) => s.id === editingId);
    if (existing) {
      existing.label = cleanLabel;
      existing.serverUrl = cleanUrl;
      existing.apiKey = cleanKey;
      _saveAll(data);
      return existing.id;
    }
  }

  const id = "srv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  data.servers.push({ id, label: cleanLabel, serverUrl: cleanUrl, apiKey: cleanKey });
  if (!data.activeId) data.activeId = id; // first one added becomes active automatically
  _saveAll(data);
  return id;
}

export function deleteAndroidServer(id) {
  const data = _loadAll();
  data.servers = data.servers.filter((s) => s.id !== id);
  if (data.activeId === id) {
    data.activeId = data.servers.length > 0 ? data.servers[0].id : null;
  }
  _saveAll(data);
}

// Build service route. Sends the game title as a query param and the
// zip as the raw POST body (Content-Type: application/zip).
export function androidExportEndpoint(gameTitle, server) {
  const base = server.serverUrl.replace(/\/+$/, "");
  return base + "/api/v1/build?name=" + encodeURIComponent(gameTitle);
}

/**
 * Upload an already-built standalone web export to the same Android build
 * service used by the APK card. This intentionally accepts the finished
 * HTML/PWA archive rather than asking the server to reconstruct the project
 * from editor-only data. That makes the web export the single source of
 * truth for the APK contents.
 */
export async function uploadWebExportForAndroid(blob, gameTitle, format, server) {
  if (!server || !server.serverUrl) throw new Error("No Android build server configured.");
  const cleanFormat = format === "pwa" ? "pwa" : "html";
  const response = await fetch(androidExportEndpoint(gameTitle, server), {
    method: "POST",
    headers: androidExportHeaders(server, {
      "Content-Type": "application/zip",
      "X-ZenEngine-Export-Format": cleanFormat,
      "X-ZenEngine-Standalone-Export": "1",
    }),
    body: blob,
  });
  if (!response.ok) {
    let message = "Android export server rejected the web export (" + response.status + ").";
    try {
      const data = await response.json();
      if (data && data.error) message = data.error;
    } catch (_) {}
    throw new Error(message);
  }
  return response.json();
}

export function androidExportHeaders(server, extra = {}) {
  const headers = { ...extra };
  if (server && server.apiKey) {
    headers["X-Api-Key"] = server.apiKey;
  }
  return headers;
}

// The build server is ASYNC: POST /api/v1/build doesn't return the APK.
// It returns a small JSON job ticket right away, e.g.
//   { "job": { "id", "status": "queued", "progress", "message",
//              "error", "downloadUrl" }, "statusUrl", "downloadUrl" }
// The real APK only exists once the job's status reaches "completed", at
// job.downloadUrl (or the top-level downloadUrl — same URL). This polls
// statusUrl until the job finishes, then returns that URL.
//
// The ZenEngine APK build server (see its src/routes/builds.ts /
// src/lib/apk-builder.ts) uses exactly this closed set of job statuses —
// confirmed directly from its source, not guessed: "queued" and
// "building" are in-progress, "completed" and "failed" are terminal.
const ANDROID_BUILD_DONE_STATUSES = new Set(["completed"]);
const ANDROID_BUILD_FAILED_STATUSES = new Set(["failed"]);

export async function pollAndroidBuildJob(jobTicket, server, { onProgress, intervalMs = 2500, timeoutMs = 10 * 60 * 1000 } = {}) {
  const statusUrl = jobTicket && (jobTicket.statusUrl || (jobTicket.job && jobTicket.job.statusUrl));
  if (!statusUrl) {
    // Server didn't give us anything to poll — assume it meant to hand
    // back the APK directly (shouldn't happen given what we've seen, but
    // don't hang forever if it does).
    return jobTicket && (jobTicket.downloadUrl || (jobTicket.job && jobTicket.job.downloadUrl));
  }

  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Android build timed out waiting for the server.");
    }

    const res = await fetch(statusUrl, { headers: androidExportHeaders(server) });
    if (!res.ok) {
      throw new Error("Lost track of the Android build job (" + res.status + ").");
    }
    const data = await res.json();
    const job = data.job || data;
    const status = String(job.status || "").toLowerCase();

    if (onProgress) {
      onProgress(job.message || ("Building\u2026 (" + status + (job.progress != null ? ", " + job.progress + "%" : "") + ")"));
    }

    if (ANDROID_BUILD_DONE_STATUSES.has(status)) {
      return job.downloadUrl || data.downloadUrl;
    }
    if (ANDROID_BUILD_FAILED_STATUSES.has(status)) {
      throw new Error(job.error || "Android build failed on the server.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Lightweight "is the build server awake?" check, used to show a status
// badge next to the selected server in the Export popup. Free-tier hosts
// (Replit free, Render free, etc.) commonly sleep after inactivity, so a
// plain fetch can hang or fail — this uses a short timeout so the UI
// never gets stuck on it.
//
// There is no reliable client-side way to distinguish "answered but
// blocked by CORS" from "didn't answer at all" from a plain fetch()
// rejection — both throw the same generic error. So: any fetch failure
// (timeout, connection refused, DNS failure, or an opaque CORS block) is
// treated as NOT reachable. This can under-report a CORS-blocked but
// genuinely awake server as asleep, but that's the safer direction — it
// won't promise a fast build from a server that's actually cold-starting.
export async function checkAndroidServerAwake(server, timeoutMs = 6000) {
  if (!server || !server.serverUrl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(server.serverUrl, { method: "GET", signal: controller.signal, mode: "cors" });
    return true; // got an actual HTTP response, including 4xx/5xx
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
