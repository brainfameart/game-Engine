import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';

function addBody(world, name, type, x, y, extra = {}) {
  const entity = world.createEntity(name);
  entity.addComponent(TRANSFORM, new Transform({
    x,
    y,
    rotation: extra.rotation ?? 0,
  }));
  entity.addComponent(RIGIDBODY_2D, new Rigidbody2D({
    bodyType: type,
    gravityScale: extra.gravityScale ?? 0,
    lockRotation: true,
    velocityX: extra.velocityX ?? 0,
    velocityY: extra.velocityY ?? 0,
    groundAngleLimit: extra.groundAngleLimit ?? 45,
    slopeMinAngle: extra.slopeMinAngle ?? 10,
    friction: 0,
    restitution: 0,
  }));
  entity.addComponent(COLLIDER_2D, new Collider2D({
    shape: ColliderShape.BOX,
    width: extra.width ?? 600,
    height: extra.height ?? 20,
    friction: 0,
    restitution: 0,
  }));
  return entity;
}

const physics = new PhysicsWorld();
await physics.whenReady();

for (const rampAngle of [10, 20, 30]) {
  test(`Kinematic slope ${rampAngle}deg reports grounded AND onSlope`, () => {
    const world = new World();
    addBody(world, 'Ramp', BodyType.STATIC, 1000, 600, {
      rotation: rampAngle,
      width: 2000,
      height: 20,
    });

    const player = addBody(world, 'Player', BodyType.KINEMATIC, 1000, 480, {
      velocityY: 300,
      groundAngleLimit: 45,
      slopeMinAngle: 10,
      width: 20,
      height: 20,
    });

    physics.clear();
    for (let i = 0; i < 180; i++) physics.step(world, 1 / 60, null);

    const rb = player.getComponent(RIGIDBODY_2D);
    assert.equal(rb.grounded, true, `expected grounded on ${rampAngle}deg ramp`);
    assert.equal(rb.isOnSlope, true, `expected isOnSlope on ${rampAngle}deg ramp`);
    assert(rb.groundAngle >= 10 - 0.01, `groundAngle too low: ${rb.groundAngle}`);
    assert(rb.groundAngle <= 45 + 0.01, `groundAngle exceeded groundAngleLimit: ${rb.groundAngle}`);
  });
}

test('Kinematic slope threshold equal to groundAngleLimit is inclusive', () => {
  const world = new World();
  addBody(world, 'Ramp', BodyType.STATIC, 1000, 600, {
    rotation: 10,
    width: 2000,
    height: 20,
  });
  const player = addBody(world, 'Player', BodyType.KINEMATIC, 1000, 480, {
    velocityY: 300,
    groundAngleLimit: 10,
    slopeMinAngle: 10,
    width: 20,
    height: 20,
  });

  physics.clear();
  for (let i = 0; i < 180; i++) physics.step(world, 1 / 60, null);

  const rb = player.getComponent(RIGIDBODY_2D);
  assert.equal(rb.grounded, true, 'equal thresholds must still count as grounded');
  assert.equal(rb.isOnSlope, true, 'equal thresholds must still count as a slope');
});

test('Kinematic flat ground remains grounded but is not a slope', () => {
  const world = new World();
  addBody(world, 'Floor', BodyType.STATIC, 250, 300, {
    width: 600,
    height: 20,
  });
  const player = addBody(world, 'Player', BodyType.KINEMATIC, 250, 180, {
    velocityY: 300,
    groundAngleLimit: 45,
    slopeMinAngle: 10,
    width: 20,
    height: 20,
  });

  physics.clear();
  for (let i = 0; i < 120; i++) physics.step(world, 1 / 60, null);

  const rb = player.getComponent(RIGIDBODY_2D);
  assert.equal(rb.grounded, true);
  assert.equal(rb.isOnSlope, false);
  assert(Math.abs(rb.groundAngle) < 0.01);
});

console.log('PASS Kinematic slope/ground coexistence regression matrix');
