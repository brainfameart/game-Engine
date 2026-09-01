import assert from 'node:assert/strict';
import { PhysicsWorld } from './PhysicsWorld.js';
import { TRANSFORM, Transform } from '../components/Transform.js';
import { RIGIDBODY_2D, Rigidbody2D, BodyType } from '../components/Rigidbody2D.js';
import { COLLIDER_2D, Collider2D, ColliderShape } from '../components/Collider2D.js';
import { CHARACTER_CONTROLLER, CharacterController, ControllerType } from '../components/CharacterController.js';

function add(world, name, type, shape, x, y, rb = {}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({ x, y, lockRotation: true }));
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({
    bodyType: type,
    gravityScale: type === BodyType.DYNAMIC ? 1 : 0,
    lockRotation: true,
    linearDamping: 0,
    angularDamping: 0,
    ...rb,
  }));
  const c = new Collider2D({ shape });
  c.width = 20; c.height = 20; c.radius = 10; c.capsuleRadius = 10; c.capsuleHalfHeight = 10;
  e.addComponent(COLLIDER_2D, c);
  return e;
}

const world = {
  _entities: new Map(),
  createEntity(name) {
    const id = name + Math.random();
    const components = new Map();
    const e = {
      id, name,
      addComponent(k, v) { components.set(k, v); return v; },
      getComponent(k) { return components.get(k); },
      hasComponent(k) { return components.has(k); },
    };
    this._entities.set(id, e);
    return e;
  },
  query(...keys) { return [...this._entities.values()].filter(e => keys.every(k => e.hasComponent(k))); },
  getEntity(id) { return this._entities.get(id); },
};

function addBody(name, type, shape, x, y, rb = {}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({ x, y, rotation: 0, scaleX: 1, scaleY: 1 }));
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: type, gravityScale: type === BodyType.DYNAMIC ? 1 : 0, lockRotation: true, linearDamping: 0, ...rb }));
  const c = new Collider2D({ shape, width: 20, height: 20, radius: 10, capsuleRadius: 10, capsuleHalfHeight: 10 });
  e.addComponent(COLLIDER_2D, c);
  return e;
}

const physics = new PhysicsWorld();
await physics.whenReady();

const wall = addBody('Wall', BodyType.STATIC, ColliderShape.BOX, 230, 170);
wall.getComponent(COLLIDER_2D).width = 20;
wall.getComponent(COLLIDER_2D).height = 180;

const dynamic = addBody('PinnedDynamic', BodyType.DYNAMIC, ColliderShape.BOX, 205, 160, { velocityX: 0, velocityY: 0 });
dynamic.getComponent(COLLIDER_2D).width = 30;
dynamic.getComponent(COLLIDER_2D).height = 30;

const player = addBody('Player', BodyType.KINEMATIC, ColliderShape.BOX, 184, 160, { velocityX: 260, velocityY: 0 });
player.addComponent(CHARACTER_CONTROLLER, new CharacterController({ controllerType: ControllerType.PLATFORMER, jumpForce: 420 }));
player.getComponent(COLLIDER_2D).width = 20;
player.getComponent(COLLIDER_2D).height = 30;

for (let i = 0; i < 90; i++) physics.step(world, 1 / 60);

const pt = player.getComponent(TRANSFORM);
const dt = dynamic.getComponent(TRANSFORM);
assert(Math.abs(dt.x - 205) < 3, `dynamic did not become pinned near wall: ${dt.x}`);

const startY = pt.y;
const rb = player.getComponent(RIGIDBODY_2D);
rb.velocityX = 220;
rb.velocityY = -420;
for (let i = 0; i < 30; i++) physics.step(world, 1 / 60);

assert(pt.y < startY - 20, `player remained sticky at pinned Dynamic: ${startY} -> ${pt.y}`);
assert(Number.isFinite(pt.x) && Number.isFinite(pt.y), 'non-finite player transform');
assert(Math.abs(rb.resolvedVelocityY) > 100, `tangent jump/fall motion was lost: ${rb.resolvedVelocityY}`);
assert(dt.x < 220, `pinned Dynamic escaped through wall: ${dt.x}`);

console.log('PASS pinned-Dynamic tangent escape regression');
