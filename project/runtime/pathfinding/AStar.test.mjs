import assert from "node:assert/strict";

import { NavWorld2D, NAV_WORLD_2D, navCellKey } from "../components/NavWorld2D.js";
import { Transform, TRANSFORM } from "../components/Transform.js";
import { Entity } from "../core/Entity.js";
import { World } from "../core/World.js";
import { findGridPath, hasGridLineOfSight, smoothGridPath } from "./AStar.js";
import { NavWorldSystem } from "../systems/NavWorldSystem.js";
import { ScriptAPI } from "../scripting/ScriptAPI.js";

function makeMesh(width, height, blocked = []) {
  const blockedKeys = new Set(blocked.map(([col, row]) => navCellKey(col, row)));
  const cells = {};
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      cells[navCellKey(col, row)] = !blockedKeys.has(navCellKey(col, row));
    }
  }
  return new NavWorld2D({ boundsX: 0, boundsY: 0, boundsWidth: width * 10, boundsHeight: height * 10, cellSize: 10, cells });
}

// Open routes reduce to one straight segment instead of a staircase.
const openMesh = makeMesh(6, 6);
const openPath = findGridPath(openMesh, 0, 0, 5, 5);
const openSmooth = smoothGridPath(openMesh, openPath);
assert.deepEqual(openSmooth, [{ col: 0, row: 0 }, { col: 5, row: 5 }]);
assert.equal(hasGridLineOfSight(openMesh, 0, 0, 5, 0), true, "horizontal line traces must terminate and stay clear");

// A shortcut may not pass a wall or squeeze through a blocked corner.
const obstacleMesh = makeMesh(6, 5, [[2, 0], [2, 1], [2, 2]]);
const detour = findGridPath(obstacleMesh, 0, 1, 5, 1);
const detourSmooth = smoothGridPath(obstacleMesh, detour);
assert.equal(hasGridLineOfSight(obstacleMesh, 0, 1, 5, 1), false);
for (let i = 0; i < detourSmooth.length - 1; i++) {
  assert.equal(
    hasGridLineOfSight(obstacleMesh, detourSmooth[i].col, detourSmooth[i].row, detourSmooth[i + 1].col, detourSmooth[i + 1].row),
    true,
    "each smoothed segment must remain collision-safe"
  );
}
const cornerMesh = makeMesh(2, 2, [[1, 0], [0, 1]]);
assert.equal(hasGridLineOfSight(cornerMesh, 0, 0, 1, 1), false, "blocked corners cannot be cut");

// Exact endpoints fix the former same-cell false-arrival case.
const navEntity = new Entity("NavWorld2D");
navEntity.addComponent(TRANSFORM, new Transform());
navEntity.addComponent(NAV_WORLD_2D, openMesh);
const navSystem = new NavWorldSystem();
assert.deepEqual(navSystem.findPath(navEntity, 1.5, 1.5, 8.5, 8.5), [
  { x: 1.5, y: 1.5 },
  { x: 8.5, y: 8.5 },
]);

// Direct-transform movement clamps to every waypoint and spends any
// remaining frame distance on the next segment, so high speeds cannot
// overshoot a turn and bounce back on the following update.
const world = new World();
const actor = world.createEntity("Agent");
actor.addComponent(TRANSFORM, new Transform());
const scriptApi = new ScriptAPI(world);
scriptApi.time.deltaTime = 1;
scriptApi._navFindPathFn = (x, y, goalX, goalY) => [
  { x, y },
  { x: 10, y: 0 },
  { x: goalX, y: goalY },
];
const agent = scriptApi.createEntityContext(actor);
assert.equal(agent.navMoveToward(20, 0, 100), true);
assert.deepEqual({ x: agent.x, y: agent.y }, { x: 20, y: 0 });
scriptApi._navFindPathFn = () => null;
assert.equal(agent.navMoveToward(30, 0, 100, { targetChangeDistance: 0.1 }), false);
assert.deepEqual({ x: agent.x, y: agent.y }, { x: 20, y: 0 });

console.log("AStar navigation tests passed");
