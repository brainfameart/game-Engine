import assert from 'node:assert/strict';
import { buildServiceWorker } from './ExportGame.js';

const sw = buildServiceWorker(['./index.html', './runtime/index.js'], 'zenengine-game-test-v1');

assert.match(sw, /const CACHE_NAME = "zenengine-game-test-v1"/);
assert.match(sw, /const CACHE_PREFIX = "zenengine-game-"/);
assert.match(sw, /n\.startsWith\(CACHE_PREFIX\) && n !== CACHE_NAME/);
assert.match(sw, /caches\.open\(CACHE_NAME\).*cache\.match\(event\.request\)/s);
assert.doesNotMatch(sw, /names\.filter\(function \(n\) \{ return n !== CACHE_NAME; \}\)/);

// The generated PWA worker may delete an older cache only when that cache
// belongs to the exported-game namespace. Engine/editor caches such as
// zenengine-offline-v6 must remain untouched.
const activation = sw.slice(sw.indexOf('self.addEventListener("activate"'));
assert.match(activation, /startsWith\(CACHE_PREFIX\)/);
assert.ok(!activation.includes('return n !== CACHE_NAME'), 'PWA worker must not delete arbitrary origin caches');

console.log('PASS: exported PWA service worker is cache-isolated from the engine/editor');
