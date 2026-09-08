import assert from "node:assert/strict";
import { World } from "../core/World.js";
import { Transform, TRANSFORM } from "../components/Transform.js";
import { NavWorld2D, NAV_WORLD_2D, setNavCellArea, setNavAreaCost } from "../components/NavWorld2D.js";
import { NavAgent2D, NAV_AGENT_2D } from "../components/NavAgent2D.js";
import { serializeScene, deserializeScene } from "../scene/SceneSerializer.js";
import { NavWorldSystem } from "../systems/NavWorldSystem.js";

function makeWorld() {
  const world = new World();
  const navEntity = world.createEntity("Nav");
  navEntity.addComponent(TRANSFORM, new Transform());

  const cells = {};
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) cells[`${col},${row}`] = true;
  }

  const nav = new NavWorld2D({
    boundsX: 0,
    boundsY: 0,
    boundsWidth: 80,
    boundsHeight: 80,
    cellSize: 16,
    cells,
    allowDiagonal: true,
  });
  navEntity.addComponent(NAV_WORLD_2D, nav);
  return { world, navEntity, nav };
}

// Regression: A* correctly finds a cheap detour, but the public NavWorldSystem
// used to smooth that path back into a straight line because smoothing checked
// only geometric line-of-sight and ignored area traversal cost.
{
  const { world, navEntity, nav } = makeWorld();
  for (let row = 1; row <= 3; row++) setNavCellArea(nav, 2, row, 2);
  setNavAreaCost(nav, 2, 20);

  const system = new NavWorldSystem();
  system.update(world);
  const path = system.findPath(navEntity, 8, 40, 72, 40, 0, 0xffff, null);
  assert.ok(path && path.length >= 2, "public findPath must return a route");

  // The route must visibly leave the expensive middle column. If smoothing
  // incorrectly ignores cost, it returns only start -> goal through the
  // costly area and this assertion catches the regression.
  const middleColumnX = 2 * 16 + 8;
  const crossesCostlyMiddle = path.some((point) =>
    Math.abs(point.x - middleColumnX) < 0.001 && point.y >= 24 && point.y <= 56
  );
  assert.equal(crossesCostlyMiddle, false, "public findPath must not smooth an expensive-area detour back through the costly area");

  // The returned path should contain an actual bend rather than only the
  // exact start and goal.
  assert.ok(path.length > 2, "cost-aware smoothing must preserve the cheaper detour");
}

// Lower-cost areas must still be preferred when the lower-cost route is the
// longer geometric route. This verifies that the fix does not merely block
// expensive areas; it preserves the intended soft preference in both directions.
{
  const { world, navEntity, nav } = makeWorld();
  // Make the LONGER top-row detour the cheap area.
  for (let col = 0; col < 5; col++) setNavCellArea(nav, col, 0, 2);
  setNavAreaCost(nav, 2, 0.05);

  const system = new NavWorldSystem();
  system.update(world);
  const path = system.findPath(navEntity, 8, 40, 72, 40, 0, 0xffff, null);
  assert.ok(path && path.length >= 2);

  const crossesCheapTopRow = path.some((point) => point.y < 16);
  assert.equal(crossesCheapTopRow, true, "public findPath must be allowed to choose a cheaper area even when its route is geometrically longer");
}

// Refresh regression: serialize -> deserialize -> fresh NavWorldSystem must
// retain the area cost and continue making the same cost-aware route choice.
{
  const { world, navEntity, nav } = makeWorld();
  for (let row = 1; row <= 3; row++) setNavCellArea(nav, 2, row, 2);
  setNavAreaCost(nav, 2, 20);
  const agent = world.createEntity("Agent");
  agent.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  agent.addComponent(NAV_AGENT_2D, new NavAgent2D({ radius: 0, area: 0xffff }));

  const restored = deserializeScene(new World(), JSON.parse(JSON.stringify(serializeScene(world))));
  const restoredNavEntity = restored.getEntity(navEntity.id);
  const restoredNav = restoredNavEntity.getComponent(NAV_WORLD_2D);
  assert.equal(restoredNav.areaCosts[2], 20, "area cost must survive scene refresh");
  assert.equal(restoredNav.cellAreas["2,2"], 2, "area painting must survive scene refresh");

  const system = new NavWorldSystem();
  system.update(restored);
  const path = system.findPathForAgent(restored.getEntity(agent.id), 72, 40);
  assert.ok(path && path.length > 2, "fresh NavWorldSystem after refresh must still honor the expensive-area detour");

  const middleColumnX = 40;
  assert.equal(
    path.some((point) => Math.abs(point.x - middleColumnX) < 0.001 && point.y >= 24 && point.y <= 56),
    false,
    "refreshed agent path must not cut through the expensive area"
  );
}

console.log("PASS public Nav area costs, smoothing, and refresh regressions");
