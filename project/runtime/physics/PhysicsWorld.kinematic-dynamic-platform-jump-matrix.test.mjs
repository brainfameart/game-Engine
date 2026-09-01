import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';

const SHAPES = [ColliderShape.BOX, ColliderShape.CIRCLE, ColliderShape.CAPSULE, ColliderShape.TRIANGLE];
const DIMS = {
  [ColliderShape.BOX]: { width: 20, height: 20 },
  [ColliderShape.CIRCLE]: { radius: 10 },
  [ColliderShape.CAPSULE]: { capsuleHalfHeight: 8, capsuleRadius: 8 },
  [ColliderShape.TRIANGLE]: { trianglePoints: [{ x: -10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: -10 }] },
};
const HALF = {
  [ColliderShape.BOX]: { x: 10, y: 10 },
  [ColliderShape.CIRCLE]: { x: 10, y: 10 },
  [ColliderShape.CAPSULE]: { x: 8, y: 16 },
  [ColliderShape.TRIANGLE]: { x: 10, y: 10 },
};

function add(world, name, bodyType, shape, x, y, extra = {}) {
  const entity = world.createEntity(name);
  entity.addComponent(TRANSFORM, new Transform({ x, y, rotation: extra.rotation ?? 0 }));
  entity.addComponent(RIGIDBODY_2D, new Rigidbody2D({
    bodyType,
    gravityScale: bodyType === BodyType.DYNAMIC ? 1 : 0,
    lockRotation: true,
    linearDamping: 0,
    angularDamping: 0,
    ...extra,
  }));
  entity.addComponent(COLLIDER_2D, new Collider2D({
    shape,
    friction: 0,
    restitution: 0,
    ...DIMS[shape],
  }));
  return entity;
}

function rotationForWall(shape) {
  return shape === ColliderShape.TRIANGLE ? -Math.PI / 2 : 0;
}

function rotationForTop(shape) {
  return shape === ColliderShape.TRIANGLE ? Math.PI : 0;
}

function step(physics, world, dt = 1 / 60) {
  physics.step(world, dt, null);
}

const physics = new PhysicsWorld();
await physics.whenReady();

// 4x4 Dynamic support matrix. Every Kinematic shape lands on every Dynamic
// support shape under gravity, is carried by a moving Dynamic support, then
// leaves it with the complete jump velocity instead of getting clipped/freeing.
for (const kShape of SHAPES) {
  for (const platformShape of SHAPES) {
    test(`Platformer Kinematic ${kShape} on moving Dynamic ${platformShape}`, () => {
      const world = new World();
      const floor = add(world, 'Floor', BodyType.STATIC, ColliderShape.BOX, 180, 260);
      const floorCollider = floor.getComponent(COLLIDER_2D);
      floorCollider.width = 600;
      floorCollider.height = 20;

      const platformHalf = HALF[platformShape];
      const platformY = 250 - platformHalf.y;
      const platform = add(world, 'Platform', BodyType.DYNAMIC, platformShape, 180, platformY, {
        rotation: rotationForTop(platformShape),
      });

      const kHalf = HALF[kShape];
      const player = add(world, 'Player', BodyType.KINEMATIC, kShape, 180, platformY - platformHalf.y - kHalf.y - 1, {
        velocityX: 0,
        velocityY: 0,
        rotation: rotationForTop(kShape),
      });
      const pr = player.getComponent(RIGIDBODY_2D);
      pr._controllerType = 'Platformer';

      physics.clear();
      for (let i = 0; i < 150; i++) step(physics, world);

      const pt = player.getComponent(TRANSFORM);
      const platT = platform.getComponent(TRANSFORM);
      const platH = platform.getComponent(RIGIDBODY_2D);
      const startRelativeY = pt.y - platT.y;
      assert(Math.abs(startRelativeY + platformHalf.y + kHalf.y) < 2.0,
        `failed to settle on Dynamic support: kY=${pt.y}, pY=${platT.y}`);
      assert(pr.grounded, 'Kinematic did not report grounded on Dynamic support');

      const platformHandle = physics._handles.get(platform.id);
      assert(platformHandle?.body, 'Dynamic platform Rapier handle missing');
      platformHandle.body.setLinvel({ x: 75, y: 0 }, true);
      const startX = pt.x;
      for (let i = 0; i < 30; i++) {
        platformHandle.body.setLinvel({ x: 75, y: platformHandle.body.linvel().y }, true);
        step(physics, world);
      }
      assert(pt.x > startX + 20, `Kinematic was not carried by Dynamic support: ${startX} -> ${pt.x}`);

      // Jump relative to the moving support. The Kinematic must leave on the
      // first frame with the full upward kick and must not lose the platform
      // contact's motion or remain stuck to its head.
      pr.velocityX = 0;
      pr.velocityY = -420;
      const launchY = pt.y;
      const launchPlatformY = platT.y;
      step(physics, world);
      assert(pr.velocityY < -380, `jump kick clipped on ${kShape}->${platformShape}: ${pr.velocityY}`);
      for (let i = 0; i < 6; i++) step(physics, world);
      assert(pt.y < launchY - 18,
        `Kinematic did not leave Dynamic support on ${kShape}->${platformShape}: ${launchY} -> ${pt.y}`);
      assert(Math.abs(pt.y - launchPlatformY) > 5, 'Kinematic remained glued to moving Dynamic support');
      assert(Number.isFinite(pt.x) && Number.isFinite(pt.y), 'non-finite Kinematic transform');
      void platH;
    });
  }
}

// 4x4 pinned-wall jump matrix. A Dynamic is resting on a Static floor and is
// genuinely pinned against a wall. The Kinematic first pushes it into that
// wall, then jumps while touching it. The Kinematic must keep its tangent /
// vertical motion and fall away normally; only its blocked inward component is
// removed. Every shape pair is exercised, including triangles against a flat
// wall orientation.
for (const kShape of SHAPES) {
  for (const dynamicShape of SHAPES) {
    test(`Pinned Dynamic ${dynamicShape} does not trap jumping Kinematic ${kShape}`, () => {
      const world = new World();
      const floor = add(world, 'Floor', BodyType.STATIC, ColliderShape.BOX, 180, 260);
      floor.getComponent(COLLIDER_2D).width = 600;
      floor.getComponent(COLLIDER_2D).height = 20;

      const wall = add(world, 'Wall', BodyType.STATIC, ColliderShape.BOX, 230, 170);
      wall.getComponent(COLLIDER_2D).height = 180;
      wall.getComponent(COLLIDER_2D).width = 20;

      const dh = HALF[dynamicShape];
      const dynamic = add(world, 'Dynamic', BodyType.DYNAMIC, dynamicShape, 230 - 10 - dh.x, 250 - dh.y, {
        rotation: rotationForWall(dynamicShape),
        gravityScale: 1,
      });
      const kh = HALF[kShape];
      const kinematic = add(world, 'Kinematic', BodyType.KINEMATIC, kShape,
        dynamic.getComponent(TRANSFORM).x - dh.x - kh.x - 1,
        dynamic.getComponent(TRANSFORM).y,
        { rotation: rotationForWall(kShape), velocityX: 240, velocityY: 0 });
      const kr = kinematic.getComponent(RIGIDBODY_2D);
      kr._controllerType = 'Platformer';

      physics.clear();
      for (let i = 0; i < 120; i++) step(physics, world);

      const dynamicT = dynamic.getComponent(TRANSFORM);
      const playerT = kinematic.getComponent(TRANSFORM);
      // Push into the wall until the Dynamic becomes pinned.
      kr.velocityX = 240;
      kr.velocityY = 0;
      for (let i = 0; i < 45; i++) step(physics, world);
      const pinnedDynamicX = dynamicT.x;
      const wallX = wall.getComponent(TRANSFORM).x;
      assert(Math.abs(pinnedDynamicX - (wallX - 10 - dh.x)) < 2.0,
        `Dynamic did not settle at wall for ${kShape}->${dynamicShape}: x=${pinnedDynamicX}`);

      // Jump while the Kinematic is still at the Dynamic's side. No horizontal
      // input is required for the escape case: vertical motion alone must not
      // be eaten by the Dynamic collision.
      kr.velocityX = 0;
      kr.velocityY = -420;
      const y0 = playerT.y;
      for (let i = 0; i < 12; i++) step(physics, world);
      const y1 = playerT.y;
      assert(y1 < y0 - 20,
        `Kinematic stuck on pinned Dynamic ${kShape}->${dynamicShape}: ${y0} -> ${y1}`);
      assert(Number.isFinite(playerT.x) && Number.isFinite(playerT.y), 'non-finite pinned-jump transform');
      assert(Math.abs(kr.resolvedVelocityY) > 200, `jump tangent velocity was lost: ${kr.resolvedVelocityY}`);
      assert(dynamicT.x <= wallX - 10 - dh.x + 2.0, 'pinned Dynamic crossed its wall boundary');
    });
  }
}

console.log('PASS 16 Dynamic-support/jump shape pairs');
console.log('PASS 16x16 pinned-Dynamic jump escape shape matrix');
