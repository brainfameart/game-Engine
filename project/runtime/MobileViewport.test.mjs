import assert from "node:assert/strict";

globalThis.window = { devicePixelRatio: 3 };
const { getSafeRendererResolution, clientToScreen, clientToLocal } = await import("./core/MobileViewport.js");

assert.equal(getSafeRendererResolution(1080, 1920), 2, "DPR 3 should be capped to 2x on mobile");

const canvas = {
  clientWidth: 1080,
  clientHeight: 1920,
  getBoundingClientRect() { return { left: 0, top: 0, width: 1080, height: 1920 }; },
};
const app = { screen: { width: 1080, height: 1920 } };
const center = clientToScreen(540, 960, canvas, app);
assert.deepEqual(center, { x: 540, y: 960 });

const ui = {
  toLocal(p) { return { x: (p.x - 40) / 2, y: (p.y - 100) / 2 }; },
};
const local = clientToLocal(540, 960, canvas, app, ui);
assert.equal(local.x, 250);
assert.equal(local.y, 430);

console.log("MobileViewport regression tests passed");
