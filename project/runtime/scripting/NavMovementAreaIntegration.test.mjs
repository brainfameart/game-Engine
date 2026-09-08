import assert from "node:assert/strict";
import { World } from "../core/World.js";
import { Transform, TRANSFORM } from "../components/Transform.js";
import { NavWorld2D, NAV_WORLD_2D, setNavCellArea, setNavAreaCost } from "../components/NavWorld2D.js";
import { NavAgent2D, NAV_AGENT_2D } from "../components/NavAgent2D.js";
import { CharacterController, CHARACTER_CONTROLLER, ControllerType } from "../components/CharacterController.js";
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from "../components/Rigidbody2D.js";
import { serializeScene, deserializeScene } from "../scene/SceneSerializer.js";
import { NavWorldSystem } from "../systems/NavWorldSystem.js";
import { ScriptAPI } from "./ScriptAPI.js";

const ROAD = 1;
const GROUND = 0;
const ROAD_MASK = 1 << ROAD;
const CELL = 16;
const COLS = 8;
const ROWS = 7;

function buildRoadWorld() {
  const world = new World();
  const navEntity = world.createEntity("NavWorld");
  navEntity.addComponent(TRANSFORM, new Transform({ x: 0, y: 0 }));

  const cells = {};
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) cells[`${col},${row}`] = true;
  }

  const nav = new NavWorld2D({
    boundsX: 0,
    boundsY: 0,
    boundsWidth: COLS * CELL,
    boundsHeight: ROWS * CELL,
    cellSize: CELL,
    cells,
    allowDiagonal: false,
  });
  navEntity.addComponent(NAV_WORLD_2D, nav);

  // L-shaped ROAD. Everything else remains walkable GROUND so a geometric
  // shortcut exists, but the NPC's ROAD-only area mask makes that shortcut
  // illegal.
  for (let col = 0; col < COLS; col++) setNavCellArea(nav, col, 2, ROAD);
  for (let row = 2; row < ROWS; row++) setNavCellArea(nav, COLS - 1, row, ROAD);

  // Keep Ground expensive too: this verifies that the same navigation world
  // contains both a hard area restriction (mask) and a soft preference (cost).
  setNavAreaCost(nav, GROUND, 50);
  setNavAreaCost(nav, ROAD, 1);

  return { world, navEntity, nav };
}

function wireNav(scriptApi, navSystem) {
  scriptApi._navFindPathFn = (x1, y1, x2, y2, radius, area, areaCosts) => {
    const navEntity = navSystem._firstNavWorld();
    return navSystem.findPath(navEntity, x1, y1, x2, y2, radius, area, areaCosts);
  };
  scriptApi._navIsWalkableForAgentFn = (x, y, radius, area, areaCosts) => {
    const navEntity = navSystem._firstNavWorld();
    return navSystem.isWalkableForAgent(navEntity, x, y, radius, area, areaCosts);
  };
  scriptApi._navNearestWalkableFn = (x, y, radius, area, maxRing, areaCosts) => {
    const navEntity = navSystem._firstNavWorld();
    return navSystem.nearestWalkablePointForAgent(navEntity, x, y, radius, area, maxRing, areaCosts);
  };
}


function buildCurvedRoadWorld() {
  const world = new World();
  const navEntity = world.createEntity("Curved NavWorld");
  navEntity.addComponent(TRANSFORM, new Transform({ x: 0, y: 0 }));
  const CELL = 16, COLS = 16, ROWS = 16;
  const cells = {};
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) cells[`${col},${row}`] = true;
  const nav = new NavWorld2D({
    boundsX: 0, boundsY: 0, boundsWidth: COLS * CELL, boundsHeight: ROWS * CELL,
    cellSize: CELL, cells, allowDiagonal: true,
  });
  navEntity.addComponent(NAV_WORLD_2D, nav);
  // A wide U-shaped/curved Road made by sampling a cubic curve. The direct
  // start->goal line runs through Ground, while the only legal Road route
  // bends smoothly around the upper part of the map.
  const roadWidth = 1.6;
  for (let s = 0; s <= 1; s += 0.005) {
    const u = 1 - s;
    const x = u*u*u*3 + 3*u*u*s*3 + 3*u*s*s*13 + s*s*s*13;
    const y = u*u*u*12 + 3*u*u*s*4 + 3*u*s*s*4 + s*s*s*12;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (Math.hypot(col - x, row - y) <= roadWidth) {
          setNavCellArea(nav, col, row, ROAD);
        }
      }
    }
  }
  setNavAreaCost(nav, GROUND, 80);
  setNavAreaCost(nav, ROAD, 1);
  return { world, navEntity, nav };
}

function assertRoadPoint(nav, navSystem, navEntity, x, y, label) {
  const c = navSystem.worldToCell(navEntity, x, y);
  assert.equal(nav.cellAreas[`${c.col},${c.row}`] ?? GROUND, ROAD, `${label} must stay on a ROAD cell`);
}

// navMoveToward: real script-facing movement follows the road-only route.
{
  const { world, navEntity, nav } = buildRoadWorld();
  const navSystem = new NavWorldSystem();
  navSystem.update(world);

  const npc = world.createEntity("NPC");
  npc.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  npc.addComponent(NAV_AGENT_2D, new NavAgent2D({
    radius: 0,
    speed: 96,
    acceleration: 1000,
    deceleration: 1000,
    stoppingDistance: 2,
    area: ROAD_MASK,
    avoidanceEnabled: false,
  }));

  const target = world.createEntity("Target");
  target.addComponent(TRANSFORM, new Transform({ x: 120, y: 88 }));

  const api = new ScriptAPI(world);
  api.time.deltaTime = 1 / 60;
  wireNav(api, navSystem);
  const ctx = api.createEntityContext(npc);

  let reached = false;
  for (let frame = 0; frame < 240; frame++) {
    api.time.elapsed = frame / 60;
    const goal = target.getComponent(TRANSFORM);
    assert.equal(ctx.navMoveToward(goal.x, goal.y, 96), true, "navMoveToward should keep following the reachable road path");
    assertRoadPoint(nav, navSystem, navEntity, ctx.x, ctx.y, `navMoveToward frame ${frame}`);
    if (Math.hypot(ctx.x - goal.x, ctx.y - goal.y) <= 2.5) {
      reached = true;
      break;
    }
  }
  assert.equal(reached, true, "navMoveToward should reach the target through the road turn");
}

// Soft-cost preference: both Ground and Road are LEGAL, but Ground is
// intentionally much more expensive. The movement API must follow the
// cheaper Road route rather than reverting to a geometric straight line.
{
  const { world, navEntity, nav } = buildRoadWorld();
  const navSystem = new NavWorldSystem();
  navSystem.update(world);

  const npc = world.createEntity("Cost Preference NPC");
  npc.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  npc.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.DYNAMIC, lockRotation: true }));
  npc.addComponent(NAV_AGENT_2D, new NavAgent2D({
    radius: 0, speed: 96, acceleration: 1000, deceleration: 1000,
    stoppingDistance: 2, area: 0xffff, avoidanceEnabled: false,
  }));

  const api = new ScriptAPI(world);
  api.time.deltaTime = 1 / 60;
  wireNav(api, navSystem);
  const ctx = api.createEntityContext(npc);
  const goal = { x: 120, y: 88 };

  const weightedPath = navSystem.findPathForAgent(npc, goal.x, goal.y);
  assert.ok(weightedPath && weightedPath.length > 2, "cost-preference agent should receive the weighted road route");
  for (const point of weightedPath) {
    assertRoadPoint(nav, navSystem, navEntity, point.x, point.y, "weighted-cost path waypoint");
  }

  let previousAngle = null;
  let maxAngleStep = 0;
  for (let frame = 0; frame < 180; frame++) {
    api.time.elapsed = frame / 60;
    ctx.navMoveToward(goal.x, goal.y, 96);
    const body = npc.getComponent(RIGIDBODY_2D);
    const vx = Number(body.velocity?.x) || 0;
    const vy = Number(body.velocity?.y) || 0;
    if (Math.hypot(vx, vy) > 2) {
      const angle = Math.atan2(vy, vx);
      if (previousAngle !== null) {
        let d = angle - previousAngle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        maxAngleStep = Math.max(maxAngleStep, Math.abs(d));
      }
      previousAngle = angle;
    }
    // The weighted route is authoritative: even while smoothing its
    // direction, the simulated agent must remain on the preferred area.
    assertRoadPoint(nav, navSystem, navEntity, ctx.x, ctx.y, `weighted-cost movement frame ${frame}`);
  }
  assert.ok(maxAngleStep < 0.55, `weighted-cost movement should turn smoothly, max frame heading step was ${maxAngleStep.toFixed(3)} rad`);
}

// navDriveToward: the car receives the same road-only route and its steering
// target stays on that route. In particular, no lookahead interpolation may
// invent a diagonal shortcut through Ground at the 90-degree corner.
{
  const { world, navEntity, nav } = buildRoadWorld();
  const navSystem = new NavWorldSystem();
  navSystem.update(world);

  const car = world.createEntity("NPC Car");
  car.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  car.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.DYNAMIC, lockRotation: true }));
  car.addComponent(CHARACTER_CONTROLLER, new CharacterController({
    controllerType: ControllerType.CAR,
    useDefaultInput: false,
    maxSpeed: 220,
  }));
  car.addComponent(NAV_AGENT_2D, new NavAgent2D({
    radius: 0,
    speed: 180,
    area: ROAD_MASK,
    avoidanceEnabled: false,
    vehicleLookahead: 90,
    vehicleCornerLookahead: 120,
  }));

  const target = world.createEntity("Target Car Goal");
  target.addComponent(TRANSFORM, new Transform({ x: 120, y: 88 }));

  const api = new ScriptAPI(world);
  api.time.deltaTime = 1 / 60;
  wireNav(api, navSystem);
  const ctx = api.createEntityContext(car);

  const firstPath = navSystem.findPathForAgent(car, 120, 88);
  assert.ok(firstPath && firstPath.length > 2, "navDriveToward must receive a real multi-waypoint road path");
  for (const point of firstPath) {
    assertRoadPoint(nav, navSystem, navEntity, point.x, point.y, "navDriveToward path waypoint");
  }

  for (let frame = 0; frame < 180; frame++) {
    api.time.elapsed = frame / 60;
    ctx.navDriveToward(target.getComponent(TRANSFORM).x, target.getComponent(TRANSFORM).y, 180);
    const controller = car.getComponent(CHARACTER_CONTROLLER);
    assert.ok(Number.isFinite(controller.requestDriveTowardX), "navDriveToward must submit a finite steering X");
    assert.ok(Number.isFinite(controller.requestDriveTowardY), "navDriveToward must submit a finite steering Y");
    assertRoadPoint(nav, navSystem, navEntity, controller.requestDriveTowardX, controller.requestDriveTowardY, `navDriveToward steering frame ${frame}`);
  }
}

// Refresh regression: area tags, costs, and route restrictions survive a
// serialize/deserialize refresh with a brand-new NavWorldSystem.
{
  const { world, navEntity } = buildRoadWorld();
  const npc = world.createEntity("Refresh NPC");
  npc.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  npc.addComponent(NAV_AGENT_2D, new NavAgent2D({ radius: 0, area: ROAD_MASK }));
  const target = world.createEntity("Refresh Target");
  target.addComponent(TRANSFORM, new Transform({ x: 120, y: 88 }));

  const restored = deserializeScene(new World(), JSON.parse(JSON.stringify(serializeScene(world))));
  const restoredNavEntity = restored.getEntity(navEntity.id);
  const restoredNav = restoredNavEntity.getComponent(NAV_WORLD_2D);
  assert.equal(restoredNav.cellAreas["0,2"], ROAD, "road area tags must survive refresh");
  assert.equal(restoredNav.areaCosts[GROUND], 50, "ground cost must survive refresh");

  const navSystem = new NavWorldSystem();
  navSystem.update(restored);
  const path = navSystem.findPathForAgent(restored.getEntity(npc.id), target.getComponent(TRANSFORM).x, target.getComponent(TRANSFORM).y);
  assert.ok(path && path.length > 2, "refreshed nav world must still produce the road route");
  for (const point of path) {
    assertRoadPoint(restoredNav, navSystem, restoredNavEntity, point.x, point.y, "refreshed road path waypoint");
  }
}

// API forwarding regression: both script movement methods must pass the
// calling NavAgent2D's area mask and per-agent area cost overrides through to
// the shared NavWorld query rather than silently using defaults.
{
  const world = new World();
  const entity = world.createEntity("Forwarding Agent");
  entity.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  entity.addComponent(NAV_AGENT_2D, new NavAgent2D({ area: ROAD_MASK, areaCosts: [3, 0.25] }));
  entity.addComponent(CHARACTER_CONTROLLER, new CharacterController({ controllerType: ControllerType.CAR }));

  const api = new ScriptAPI(world);
  api.time.deltaTime = 1 / 60;
  const calls = [];
  api._navFindPathFn = (...args) => {
    calls.push(args);
    return [{ x: 8, y: 40 }, { x: 24, y: 40 }];
  };
  const ctx = api.createEntityContext(entity);
  ctx.navMoveToward(24, 40, 120);
  ctx.navDriveToward(24, 40, 120);

  assert.equal(calls.length, 2, "both navigation movement helpers must query the nav system");
  assert.equal(calls[0][5], ROAD_MASK, "navMoveToward must pass the NavAgent2D area mask");
  assert.equal(calls[0][6][0], 3, "navMoveToward must pass the agent's Ground cost override");
  assert.equal(calls[0][6][1], 0.25, "navMoveToward must pass the agent's Road cost override");
  assert.equal(calls[1][5], ROAD_MASK, "navDriveToward must pass the NavAgent2D area mask");
  assert.equal(calls[1][6][0], 3, "navDriveToward must pass the agent's Ground cost override");
  assert.equal(calls[1][6][1], 0.25, "navDriveToward must pass the agent's Road cost override");
}

// Curved-road regression: smooth route following must remain smooth when the
// preferred Road itself bends through several small direction changes. Both
// movement helpers must keep their samples on the curved road corridor.
{
  const { world, navEntity, nav } = buildCurvedRoadWorld();
  const navSystem = new NavWorldSystem();
  navSystem.update(world);

  const npc = world.createEntity("Curved Road NPC");
  npc.addComponent(TRANSFORM, new Transform({ x: 56, y: 200 }));
  npc.addComponent(NAV_AGENT_2D, new NavAgent2D({
    radius: 0, speed: 64, acceleration: 700, deceleration: 700,
    stoppingDistance: 2, area: ROAD_MASK, avoidanceEnabled: false,
  }));
  const api = new ScriptAPI(world);
  api.time.deltaTime = 1 / 60;
  wireNav(api, navSystem);
  const ctx = api.createEntityContext(npc);

  const path = navSystem.findPathForAgent(npc, 216, 200);
  assert.ok(path && path.length >= 4, "curved-road test must produce a multi-turn route");

  let prevAngle = null;
  let maxAngleStep = 0;
  let reached = false;
  for (let frame = 0; frame < 360; frame++) {
    api.time.elapsed = frame / 60;
    const active = ctx.navMoveToward(216, 200, 64);

    assert.equal(active, true, `navMoveToward should follow curved road frame ${frame}`);
    assertRoadPoint(nav, navSystem, navEntity, ctx.x, ctx.y, `curved-road movement frame ${frame}`);
    const state = ctx._navMoveState;
    if (state && Number.isFinite(state.routeDirX) && Number.isFinite(state.routeDirY)) {
      const angle = Math.atan2(state.routeDirY, state.routeDirX);
      if (prevAngle !== null) {
        let d = angle - prevAngle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        maxAngleStep = Math.max(maxAngleStep, Math.abs(d));
      }
      prevAngle = angle;
    }
    if (Math.hypot(ctx.x - 216, ctx.y - 200) <= 3) { reached = true; break; }
  }
  assert.equal(reached, true, "navMoveToward should reach the target around the curved road");
  assert.ok(maxAngleStep < 0.45, `curved-road navMoveToward should turn smoothly, max frame angle step ${maxAngleStep.toFixed(3)} rad`);

  const car = world.createEntity("Curved Road Car");
  car.addComponent(TRANSFORM, new Transform({ x: 56, y: 200 }));
  car.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.DYNAMIC, lockRotation: true }));
  car.addComponent(CHARACTER_CONTROLLER, new CharacterController({
    controllerType: ControllerType.CAR, useDefaultInput: false, maxSpeed: 160,
  }));
  car.addComponent(NAV_AGENT_2D, new NavAgent2D({
    radius: 0, speed: 120, area: ROAD_MASK, avoidanceEnabled: false,
    vehicleLookahead: 42, vehicleCornerLookahead: 70,
  }));
  const carCtx = api.createEntityContext(car);
  let carPrevAngle = null;
  let carMaxAngleStep = 0;
  for (let frame = 0; frame < 180; frame++) {
    api.time.elapsed = frame / 60;
    carCtx.navDriveToward(216, 200, 120);
    const controller = car.getComponent(CHARACTER_CONTROLLER);
    assertRoadPoint(nav, navSystem, navEntity, controller.requestDriveTowardX, controller.requestDriveTowardY, `curved-road car steering frame ${frame}`);
    const dx = controller.requestDriveTowardX - carCtx.x;
    const dy = controller.requestDriveTowardY - carCtx.y;
    if (Math.hypot(dx, dy) > 2) {
      const angle = Math.atan2(dy, dx);
      if (carPrevAngle !== null) {
        let d = angle - carPrevAngle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        carMaxAngleStep = Math.max(carMaxAngleStep, Math.abs(d));
      }
      carPrevAngle = angle;
    }
  }
  assert.ok(carMaxAngleStep < 0.75, `curved-road navDriveToward should not snap steering around bends, max step ${carMaxAngleStep.toFixed(3)} rad`);
}

console.log("PASS navMoveToward/navDriveToward road-only routing, cost/mask forwarding, and refresh regression");
