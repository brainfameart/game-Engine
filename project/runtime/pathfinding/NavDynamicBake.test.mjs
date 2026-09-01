import assert from "node:assert/strict";
import { World } from "../core/World.js";
import { NavWorldSystem } from "../systems/NavWorldSystem.js";
import { Transform } from "../components/Transform.js";
import { Collider2D, ColliderShape } from "../components/Collider2D.js";
import { Rigidbody2D, BodyType } from "../components/Rigidbody2D.js";
import { TRANSFORM } from "../components/Transform.js";
import { COLLIDER_2D } from "../components/Collider2D.js";
import { RIGIDBODY_2D } from "../components/Rigidbody2D.js";

const world = new World();
const obstacle = world.createEntity("StaticObstacle");
const transform = obstacle.addComponent(TRANSFORM, new Transform({ x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 }));
const collider = obstacle.addComponent(COLLIDER_2D, new Collider2D({
  shape: ColliderShape.BOX,
  width: 40,
  height: 20,
  offsetX: 3,
  offsetY: -2,
}));
obstacle.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.STATIC }));

const system = new NavWorldSystem();
system._world = world;
const signatures = [];
const snapshot = () => signatures.push(system._colliderSignature());

snapshot();
transform.x += 5;
snapshot();
assert.notEqual(signatures[1], signatures[0], "moving a static collider must dirty the dynamic NavWorld2D signature");

transform.scaleX = 1.4;
snapshot();
assert.notEqual(signatures[2], signatures[1], "scaling a static collider must dirty the signature");

collider.width = 52;
snapshot();
assert.notEqual(signatures[3], signatures[2], "changing collider width must dirty the signature");

collider.offsetX = 9;
snapshot();
assert.notEqual(signatures[4], signatures[3], "changing collider offset must dirty the signature");

collider.capsuleHalfHeight = 23;
collider.capsuleRadius = 7;
collider.shape = ColliderShape.CAPSULE;
snapshot();
assert.notEqual(signatures[5], signatures[4], "changing capsule dimensions must dirty the signature");

collider.shape = ColliderShape.TRIANGLE;
collider.trianglePoints[0].x = -10;
snapshot();
assert.notEqual(signatures[6], signatures[5], "changing triangle points must dirty the signature");

// Dynamic/kinematic bodies remain excluded because they are not baked obstacles.
const moving = world.createEntity("MovingAgent");
moving.addComponent(TRANSFORM, new Transform({ x: 10, y: 20 }));
moving.addComponent(COLLIDER_2D, new Collider2D({ shape: ColliderShape.BOX, width: 20, height: 20 }));
moving.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: BodyType.DYNAMIC }));
const before = system._colliderSignature();
moving.getComponent(TRANSFORM).x += 100;
assert.equal(system._colliderSignature(), before, "dynamic bodies must not dirty NavWorld2D obstacle signatures");

console.log("PASS dynamic NavWorld2D tracks static movement, scale, offsets, and shape dimensions");
