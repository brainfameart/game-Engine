import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';
import { CharacterController, CHARACTER_CONTROLLER, ControllerType } from '../components/CharacterController.js';

const physics = new PhysicsWorld();
await physics.whenReady();

function addBody(world, name, type, x, y, {
  width = 34,
  height = 34,
  rotation = 0,
  friction = 0.5,
  gravityScale = type === BodyType.DYNAMIC ? 1 : 0,
  lockRotation = true,
} = {}) {
  const entity = world.createEntity(name);
  entity.addComponent(TRANSFORM, new Transform({ x, y, rotation }));
  entity.addComponent(RIGIDBODY_2D, new Rigidbody2D({
    bodyType: type,
    gravityScale,
    linearDamping: 0,
    angularDamping: 0,
    lockRotation,
  }));
  entity.addComponent(COLLIDER_2D, new Collider2D({
    shape: ColliderShape.BOX,
    width,
    height,
    friction,
    restitution: 0,
  }));
  return entity;
}

function addPlayer(world, x, y) {
  const player = addBody(world, 'KinematicPlayer', BodyType.KINEMATIC, x, y, {
    width: 22,
    height: 30,
    friction: 0,
  });
  player.addComponent(CHARACTER_CONTROLLER, new CharacterController({
    controllerType: ControllerType.PLATFORMER,
    moveSpeed: 240,
    acceleration: 200,
    airControl: 1,
  }));
  player.getComponent(RIGIDBODY_2D)._controllerType = ControllerType.PLATFORMER;
  return player;
}

function step(world, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) physics.step(world, dt, null);
}

for (const direction of [-1, 1]) {
  test(`Kinematic can push a genuinely rotating Dynamic from ${direction < 0 ? 'right' : 'left'} without instability`, () => {
    const world = new World();
    addBody(world, 'Floor', BodyType.STATIC, 240, 250, {
      width: 480,
      height: 20,
      gravityScale: 0,
      friction: 0.5,
      lockRotation: true,
    });

    // The target starts rotated and is intentionally NOT rotation-locked so
    // Rapier can apply torque as the Kinematic contacts it at different
    // points. This exercises the real moving/rotating Dynamic case.
    const target = addBody(world, 'RotatingDynamicTarget', BodyType.DYNAMIC, 200, 210, {
      width: 42,
      height: 30,
      rotation: direction > 0 ? -18 : 18,
      friction: 0.5,
      lockRotation: false,
    });

    const playerX = direction > 0 ? 120 : 280;
    const player = addPlayer(world, playerX, 210);

    physics.clear();
    step(world, 180); // gravity settles the target and player onto the floor

    const targetTransform = target.getComponent(TRANSFORM);
    const targetRb = target.getComponent(RIGIDBODY_2D);
    const playerRb = player.getComponent(RIGIDBODY_2D);
    const startX = targetTransform.x;
    const startAngle = targetTransform.rotation;

    playerRb.velocityX = direction * 220;
    playerRb.velocityY = 0;
    step(world, 120);

    const moved = (targetTransform.x - startX) * direction;
    const angleChanged = Math.abs(targetTransform.rotation - startAngle);

    for (const value of [targetTransform.x, targetTransform.y, targetTransform.rotation,
      targetRb.velocityX, targetRb.velocityY, targetRb.angularVelocity,
      playerRb.resolvedVelocityX, playerRb.resolvedVelocityY]) {
      assert(Number.isFinite(value), `non-finite rotated Dynamic/pusher state: ${value}`);
    }

    assert(moved > 25, `rotating Dynamic was not pushed reliably: moved=${moved}`);
    assert(Math.abs(targetTransform.x) < 10000 && Math.abs(targetTransform.y) < 10000,
      `rotating Dynamic escaped to an invalid position: (${targetTransform.x}, ${targetTransform.y})`);
    assert(Math.abs(targetRb.angularVelocity) < 5000, `rotating Dynamic angular velocity exploded: ${targetRb.angularVelocity}`);
    assert(angleChanged >= 0, 'rotation delta became invalid');
  });
}

console.log('PASS: rotating Dynamic kinematic-push regression loaded');
