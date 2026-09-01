import assert from "node:assert/strict";
import { World } from "../core/World.js";
import { NavWorldSystem } from "../systems/NavWorldSystem.js";
import { Transform, TRANSFORM } from "../components/Transform.js";
import { Collider2D, ColliderShape, COLLIDER_2D } from "../components/Collider2D.js";
import { Rigidbody2D, BodyType, RIGIDBODY_2D } from "../components/Rigidbody2D.js";
import { NavWorld2D, NAV_WORLD_2D, navCellKey } from "../components/NavWorld2D.js";

const world = new World();
const navEntity = world.createEntity("NavWorld2D");
navEntity.addComponent(TRANSFORM, new Transform());
const nav = navEntity.addComponent(NAV_WORLD_2D, new NavWorld2D({
  boundsX: 0,
  boundsY: 0,
  boundsWidth: 128,
  boundsHeight: 64,
  cellSize: 16,
  dynamic: true,
}));

const obstacle = world.createEntity("StaticObstacle");
const obstacleTransform = obstacle.addComponent(TRANSFORM, new Transform({ x: 24, y: 24 }));
obstacle.addComponent(COLLIDER_2D, new Collider2D({ shape: ColliderShape.BOX, width: 16, height: 16 }));
obstacle.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.STATIC }));

const system = new NavWorldSystem();
// First dynamic tick records the baseline; a subsequent obstacle change must
// trigger the real bake and update bakedCells/cells.
system.update(world);
assert.equal(Object.keys(nav.bakedCells).length, 0, "baseline dynamic tick must not unexpectedly bake");

obstacleTransform.x = 88;
system.update(world);
const firstCell = navCellKey(1, 1);
const movedCell = navCellKey(5, 1);
assert.equal(nav.bakedCells[firstCell], true, "old obstacle location should become walkable after movement");
assert.equal(nav.bakedCells[movedCell], false, "new obstacle location should become blocked after movement");
assert.deepEqual(nav.cells, nav.bakedCells, "automatic dynamic bake should refresh final cells when no paint overrides exist");

obstacleTransform.scaleX = 2;
system.update(world);
assert.equal(nav.bakedCells[navCellKey(4, 1)], false, "static obstacle scale changes must also trigger a re-bake");

console.log("PASS dynamic NavWorld2D automatically re-bakes moved/scaled static colliders with current collision geometry");
