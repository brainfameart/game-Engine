import assert from "node:assert/strict";
import { buildServiceWorker } from "./ExportGame.js";

const sw = buildServiceWorker(["index.html", "main.js"], "zenengine-game-demo-v1");

assert.match(sw, /const CACHE_NAME = "zenengine-game-demo-v1"/);
assert.match(sw, /const CACHE_PREFIX = "zenengine-game-demo-"/);
assert.match(sw, /n\.indexOf\(CACHE_PREFIX\) === 0 && n !== CACHE_NAME/);
assert.match(sw, /caches\.open\(CACHE_NAME\)/);
assert.doesNotMatch(sw, /const CACHE_PREFIX = "zenengine-game-"/);
assert.doesNotMatch(sw, /names\.filter\(function \(n\) \{ return n !== CACHE_NAME; \}\)/);
assert.doesNotMatch(sw, /caches\.match\(event\.request\)/);

// Different game slugs must produce non-overlapping cleanup prefixes.
const swOther = buildServiceWorker(["index.html"], "zenengine-game-other-v1");
assert.match(swOther, /const CACHE_PREFIX = "zenengine-game-other-"/);
assert.doesNotMatch(swOther, /zenengine-game-demo-/);

console.log("Export service-worker same-origin isolation tests passed");
