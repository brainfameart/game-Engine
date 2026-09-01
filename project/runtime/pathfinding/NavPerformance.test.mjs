import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { NavWorld2D, navCellKey, invalidateNavWorldRuntime, navRuntimeCacheStats, getAgentNavLayer } from "../components/NavWorld2D.js";
import { findGridPath } from "./AStar.js";
import { World } from "../core/World.js";
import { Transform, TRANSFORM } from "../components/Transform.js";
import { Collider2D, ColliderShape, COLLIDER_2D } from "../components/Collider2D.js";
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from "../components/Rigidbody2D.js";
import { bakeNavWorld } from "./NavWorldBaker.js";

function makeOpenMesh(cols, rows) {
  const cells = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[navCellKey(c, r)] = true;
  return new NavWorld2D({ boundsX: 0, boundsY: 0, boundsWidth: cols * 8, boundsHeight: rows * 8, cellSize: 8, cells });
}

// Repeated identical requests are shared by all agents rather than rebuilt.
const mesh = makeOpenMesh(180, 180);
const first = findGridPath(mesh, 1, 1, 178, 178);
assert.ok(first && first.length > 1);
const before = navRuntimeCacheStats(mesh);
for (let i = 0; i < 1000; i++) assert.strictEqual(findGridPath(mesh, 1, 1, 178, 178), first);
const after = navRuntimeCacheStats(mesh);
assert.equal(after.cachedPaths, before.cachedPaths, "repeated routes should reuse the shared cache");
assert.ok(after.cells === 180 * 180);

// A bake invalidates the cached topology so stale paths cannot survive a
// changed obstacle layout.
invalidateNavWorldRuntime(mesh);
assert.equal(navRuntimeCacheStats(mesh).cachedPaths, 0);

// Bake correctness smoke test with rotated geometry and mixed collider types.
const world = new World();
const wall = world.createEntity("RotatedWall");
wall.addComponent(TRANSFORM, new Transform({ x: 240, y: 240, rotation: 37 }));
wall.addComponent(COLLIDER_2D, new Collider2D({ shape: ColliderShape.BOX, width: 160, height: 24 }));
wall.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.STATIC }));
const circle = world.createEntity("Circle");
circle.addComponent(TRANSFORM, new Transform({ x: 420, y: 300 }));
circle.addComponent(COLLIDER_2D, new Collider2D({ shape: ColliderShape.CIRCLE, radius: 28 }));
circle.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.STATIC }));
const bakeMesh = new NavWorld2D({ boundsX: 0, boundsY: 0, boundsWidth: 640, boundsHeight: 640, cellSize: 8 });
const start = performance.now();
const summary = bakeNavWorld(bakeMesh, world, new Transform());
const elapsed = performance.now() - start;
assert.equal(summary.walkable + summary.blocked, 80 * 80);
assert.ok(summary.blocked > 0 && summary.walkable > 0);
console.log(`Nav bake smoke test: ${elapsed.toFixed(2)}ms, ${summary.blocked} blocked / ${summary.walkable} walkable`);

// Agent-radius clearance is now derived PER RADIUS on top of the shared
// (unpadded) bake, not baked into the mesh itself. A radius-8 agent must
// see strictly fewer (or equal) walkable cells than the raw bake, since
// erosion can only remove cells near obstacles, never add them; two
// agents sharing the same radius must reuse one derived layer instead of
// each computing their own.
const smallLayer = getAgentNavLayer(bakeMesh, 0);
const largeLayer = getAgentNavLayer(bakeMesh, 8);
const sameRadiusLayer = getAgentNavLayer(bakeMesh, 8);
assert.strictEqual(largeLayer, sameRadiusLayer, "agents sharing a radius must reuse one derived layer, not recompute it");
let smallWalkable = 0, largeWalkable = 0;
for (let i = 0; i < smallLayer.walkable.length; i++) {
  if (smallLayer.walkable[i] === 1) smallWalkable++;
  if (largeLayer.walkable[i] === 1) largeWalkable++;
}
assert.ok(largeWalkable <= smallWalkable, "a larger agent radius must never open up MORE walkable cells than radius 0");
assert.ok(largeWalkable > 0, "the large-radius layer must still find some open floor away from obstacles");
console.log(`Radius layers: radius0=${smallWalkable} walkable, radius8=${largeWalkable} walkable (shared layer confirmed)`);
console.log("Nav performance/validation tests passed");
