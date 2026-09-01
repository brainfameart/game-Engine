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

function addBody(world, name, type, x, y, { width = 30, height = 30, friction = 0.5, gravityScale = type === BodyType.DYNAMIC ? 1 : 0 } = {}) {
  const entity = world.createEntity(name);
  entity.addComponent(TRANSFORM, new Transform({ x, y }));
  entity.addComponent(RIGIDBODY_2D, new Rigidbody2D({
    bodyType: type,
    gravityScale,
    linearDamping: 0,
    angularDamping: 0,
    lockRotation: true,
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

function makePlatformerKinematic(world, x, y) {
  const player = addBody(world, 'KinematicPlayer', BodyType.KINEMATIC, x, y, {
    width: 20,
    height: 30,
    friction: 0,
  });
  player.addComponent(CHARACTER_CONTROLLER, new CharacterController({
    controllerType: ControllerType.PLATFORMER,
    moveSpeed: 220,
    acceleration: 100,
    airControl: 1,
  }));
  player.getComponent(RIGIDBODY_2D)._controllerType = ControllerType.PLATFORMER;
  return player;
}

function step(world, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) physics.step(world, dt, null);
}

test('Grounded Kinematic pushes a single Dynamic consistently from both sides', () => {
  for (const direction of [-1, 1]) {
    const world = new World();
    const floor = addBody(world, 'Floor', BodyType.STATIC, 200, 230, { width: 400, height: 20, gravityScale: 0 });
    const floorCollider = floor.getComponent(COLLIDER_2D);
    floorCollider.friction = 0.5;

    const dynamicX = direction > 0 ? 180 : 220;
    const playerX = direction > 0 ? 130 : 270;
    const dynamic = addBody(world, 'DynamicTarget', BodyType.DYNAMIC, dynamicX, 200, {
      width: 30,
      height: 30,
      friction: 0.5,
    });
    const player = makePlatformerKinematic(world, playerX, 200);
    physics.clear();
    step(world, 120);

    const dynamicTransform = dynamic.getComponent(TRANSFORM);
    const playerRb = player.getComponent(RIGIDBODY_2D);
    const startX = dynamicTransform.x;
    playerRb.velocityX = direction * 220;
    playerRb.velocityY = 0;

    step(world, 120);

    const moved = (dynamicTransform.x - startX) * direction;
    assert(moved > 100, `grounded push failed from ${direction > 0 ? 'left' : 'right'}: moved=${moved}`);
    assert(Number.isFinite(dynamicTransform.x), 'Dynamic x became non-finite');
  }
});

test('Grounded Kinematic can push heavily stacked Dynamics instead of stopping from load alone', () => {
  for (let stackHeight = 1; stackHeight <= 10; stackHeight++) {
    const world = new World();
    addBody(world, 'Floor', BodyType.STATIC, 300, 250, {
      width: 600,
      height: 20,
      gravityScale: 0,
      friction: 0.5,
    });
    const player = makePlatformerKinematic(world, 100, 220);
    const dynamics = [];
    for (let i = 0; i < stackHeight; i++) {
      dynamics.push(addBody(world, `Dynamic_${i}`, BodyType.DYNAMIC, 150, 220 - i * 31, {
        width: 30,
        height: 30,
        friction: 0.5,
      }));
    }

    physics.clear();
    step(world, 180);

    const bottom = dynamics[0];
    const bottomTransform = bottom.getComponent(TRANSFORM);
    const playerRb = player.getComponent(RIGIDBODY_2D);
    const startX = bottomTransform.x;
    playerRb.velocityX = 220;
    playerRb.velocityY = 0;

    step(world, 120);

    const moved = bottomTransform.x - startX;
    assert(moved > 30, `stack of ${stackHeight} became effectively immovable: moved=${moved}`);
    assert(Number.isFinite(bottomTransform.x), `stack of ${stackHeight} produced non-finite state`);
  }
});

function buildPinnedEscapeWorld(direction) {
  const world = new World();
  const wallX = direction > 0 ? 220 : 180;
  const dynamicX = direction > 0 ? 205 : 195;
  const playerX = direction > 0 ? 184 : 216;

  const wall = addBody(world, 'Wall', BodyType.STATIC, wallX, 170, { width: 20, height: 180, gravityScale: 0 });
  wall.getComponent(COLLIDER_2D).friction = 0.5;
  const dynamic = addBody(world, 'PinnedDynamic', BodyType.DYNAMIC, dynamicX, 160, { width: 30, height: 30, friction: 0.5 });
  const player = addBody(world, 'Player', BodyType.KINEMATIC, playerX, 160, { width: 20, height: 30, friction: 0 });
  player.addComponent(CHARACTER_CONTROLLER, new CharacterController({ controllerType: ControllerType.PLATFORMER, jumpForce: 420 }));
  const rb = player.getComponent(RIGIDBODY_2D);
  rb._controllerType = 'Platformer';
  rb.velocityX = direction * 260;
  rb.velocityY = 0;
  return { world, dynamic, player };
}

test('Pinned Dynamic does not create a directional asymmetry when the Kinematic jumps away on either side', () => {
  for (const direction of [-1, 1]) {
    const { world, dynamic, player } = buildPinnedEscapeWorld(direction);
    physics.clear();
    step(world, 90);

    const playerTransform = player.getComponent(TRANSFORM);
    const dynamicTransform = dynamic.getComponent(TRANSFORM);
    const playerRb = player.getComponent(RIGIDBODY_2D);
    const startY = playerTransform.y;

    playerRb.velocityX = direction * 220;
    playerRb.velocityY = -420;
    step(world, 30);

    assert(playerTransform.y < startY - 20, `player stayed trapped when escaping ${direction > 0 ? 'right' : 'left'}`);
    assert(Math.abs(playerRb.resolvedVelocityY) > 100, `vertical escape was lost when escaping ${direction > 0 ? 'right' : 'left'}`);
    if (direction > 0) {
      assert(dynamicTransform.x < 220, `pinned Dynamic escaped right through wall: ${dynamicTransform.x}`);
    } else {
      assert(dynamicTransform.x > 180, `pinned Dynamic escaped left through wall: ${dynamicTransform.x}`);
    }
  }
});
