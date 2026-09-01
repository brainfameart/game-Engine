import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from './core/World.js';
import { Transform, TRANSFORM } from './components/Transform.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from './components/Collider2D.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from './components/Rigidbody2D.js';
import { NavWorld2D, NAV_WORLD_2D, navCellKey } from './components/NavWorld2D.js';
import { NavAgent2D, NAV_AGENT_2D } from './components/NavAgent2D.js';
import { serializeScene, deserializeScene } from './scene/SceneSerializer.js';
import { NavWorldSystem } from './systems/NavWorldSystem.js';
import { findGridPath } from './pathfinding/AStar.js';

// Scene data must preserve both physics layer/mask and navigation grid/area
// data across the same serialize -> deserialize path used by project saves.
{
  const world = new World();
  const floor = world.createEntity('Floor');
  floor.addComponent(TRANSFORM, new Transform({ x: 100, y: 100 }));
  floor.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.STATIC }));
  floor.addComponent(COLLIDER_2D, new Collider2D({
    shape: ColliderShape.BOX,
    width: 100,
    height: 20,
    layer: 3,
    mask: (1 << 0) | (1 << 3),
  }));

  const nav = world.createEntity('NavWorld2D');
  nav.addComponent(TRANSFORM, new Transform());
  nav.addComponent(NAV_WORLD_2D, new NavWorld2D({
    boundsX: 0,
    boundsY: 0,
    boundsWidth: 128,
    boundsHeight: 64,
    cellSize: 16,
    cells: {
      [navCellKey(0, 0)]: true,
      [navCellKey(1, 0)]: true,
      [navCellKey(2, 0)]: false,
    },
    bakedCells: {
      [navCellKey(0, 0)]: true,
      [navCellKey(1, 0)]: true,
      [navCellKey(2, 0)]: false,
    },
    cellAreas: { [navCellKey(1, 0)]: 1 },
    areaCosts: [1, 2.5],
  }));

  const agent = world.createEntity('SchoolAgent');
  agent.addComponent(TRANSFORM, new Transform({ x: 8, y: 8 }));
  agent.addComponent(NAV_AGENT_2D, new NavAgent2D({ radius: 6, area: 1 << 1 }));

  const saved = serializeScene(world);
  const restored = deserializeScene(new World(), saved);

  const restoredFloor = restored.getEntity(floor.id);
  const restoredCollider = restoredFloor.getComponent(COLLIDER_2D);
  assert.equal(restoredCollider.layer, 3);
  assert.equal(restoredCollider.mask, (1 << 0) | (1 << 3));

  const restoredNav = restored.getEntity(nav.id).getComponent(NAV_WORLD_2D);
  assert.equal(restoredNav.cells[navCellKey(1, 0)], true);
  assert.equal(restoredNav.cells[navCellKey(2, 0)], false);
  assert.equal(restoredNav.cellAreas[navCellKey(1, 0)], 1);
  assert.equal(restoredNav.areaCosts[1], 2.5);

  const restoredAgent = restored.getEntity(agent.id).getComponent(NAV_AGENT_2D);
  assert.equal(restoredAgent.area, 1 << 1);
  console.log('PASS refresh scene round-trip preserves Nav + Physics layer data');
}

// After a scene reload, a fresh NavWorldSystem must rebuild its runtime cache
// from the restored serialized data and still answer a path query correctly.
{
  const world = new World();
  const navEntity = world.createEntity('Nav');
  navEntity.addComponent(TRANSFORM, new Transform());
  navEntity.addComponent(NAV_WORLD_2D, new NavWorld2D({
    boundsX: 0,
    boundsY: 0,
    boundsWidth: 64,
    boundsHeight: 32,
    cellSize: 16,
    cells: {
      '0,0': true,
      '1,0': true,
      '2,0': true,
      '3,0': true,
      '0,1': false,
      '1,1': false,
      '2,1': false,
      '3,1': false,
    },
  }));

  const saved = serializeScene(world);
  const restored = deserializeScene(new World(), saved);
  const restoredNavEntity = restored.getEntity(navEntity.id);
  const navSystem = new NavWorldSystem();
  navSystem.update(restored);
  const path = navSystem.findPath(restoredNavEntity, 8, 8, 56, 8, 0, 0xffff);
  assert.ok(Array.isArray(path) && path.length >= 2, 'restored NavWorld should path after reload');
  assert.deepEqual(path[0], { x: 8, y: 8 });
  assert.deepEqual(path[path.length - 1], { x: 56, y: 8 });
  console.log('PASS restored NavWorld paths after reload');
}

// The service worker must not reintroduce the refresh bug by serving stale
// executable/editor modules before trying the network.
{
  const sw = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /zenengine-offline-v6/);
  assert.match(sw, /const networkFirst\s*=\s*[\s\S]*?request\.mode === "navigate"/);
  assert.match(sw, /fetch\(request, \{ cache: "no-store" \}\)/);
  assert.match(sw, /const cached = await cache\.match\(cacheKey\);/);
  console.log('PASS refresh cache policy: fresh code preferred, cache retained as offline fallback');
}


// Area-mask + area-cost behavior must survive the COMPLETE scene reload path,
// not merely preserve the raw fields. This reproduces the reported failure:
// after refresh, the agent still has its navigation area mask and the saved
// area cost must still influence the route.
{
  const cellSize = 16;
  const cells = {};
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cells[`${c},${r}`] = true;
  const nav = new World();
  const navEntity = nav.createEntity('Nav');
  navEntity.addComponent(TRANSFORM, new Transform());
  navEntity.addComponent(NAV_WORLD_2D, new NavWorld2D({
    boundsWidth: 80,
    boundsHeight: 80,
    cellSize,
    cells,
    cellAreas: { '2,1': 2, '2,2': 2, '2,3': 2 },
    areaCosts: [1, 1, 20],
    allowDiagonal: true,
  }));
  const agent = nav.createEntity('SchoolAgent');
  agent.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  agent.addComponent(NAV_AGENT_2D, new NavAgent2D({ radius: 0, area: 1 << 2 }));
  const costAgent = nav.createEntity('CostAgent');
  costAgent.addComponent(TRANSFORM, new Transform({ x: 8, y: 40 }));
  costAgent.addComponent(NAV_AGENT_2D, new NavAgent2D({ radius: 0, area: 0xffff }));

  const saved = serializeScene(nav);
  const restored = deserializeScene(new World(), JSON.parse(JSON.stringify(saved)));
  const restoredNav = restored.getEntity(navEntity.id);
  const restoredAgent = restored.getEntity(agent.id);
  const restoredWorld = restoredNav.getComponent(NAV_WORLD_2D);
  const restoredAgentData = restoredAgent.getComponent(NAV_AGENT_2D);
  const restoredCostAgent = restored.getEntity(costAgent.id);
  const restoredCostAgentData = restoredCostAgent.getComponent(NAV_AGENT_2D);
  const system = new NavWorldSystem();
  system.update(restored);

  assert.equal(restoredAgentData.area, 1 << 2, 'navigation area mask must survive refresh');
  assert.equal(restoredWorld.areaCosts[2], 20, 'area cost must survive refresh');
  assert.equal(restoredCostAgentData.area, 0xffff, 'navigation full area mask must survive refresh');
  const preferredPath = findGridPath(restoredWorld, 0, 2, 4, 2, restoredCostAgentData.radius, restoredCostAgentData.area);
  assert.ok(preferredPath, 'restored navigation world must still produce a path');
  // The expensive area occupies the middle column. Since the agent allows
  // that area, the route should detour through the cheaper Ground cells.
  const preferredCrossesCostlyArea = preferredPath.some((p) => p.col === 2 && p.row >= 1 && p.row <= 3);
  assert.equal(preferredCrossesCostlyArea, false, 'restored area cost must still influence path choice after refresh');
  console.log('PASS refresh preserves Nav area mask + area-cost path behavior');
}

console.log('ALL REQUESTED REFRESH/PERSISTENCE REGRESSIONS PASSED');
