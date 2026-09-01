import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';

const SHAPES = [
  ColliderShape.BOX,
  ColliderShape.CIRCLE,
  ColliderShape.CAPSULE,
  ColliderShape.TRIANGLE,
];

const shapeData = {
  [ColliderShape.BOX]: { width: 20, height: 20 },
  [ColliderShape.CIRCLE]: { radius: 10 },
  [ColliderShape.CAPSULE]: { capsuleHalfHeight: 8, capsuleRadius: 8 },
  [ColliderShape.TRIANGLE]: { trianglePoints: [
    { x: -10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: -10 },
  ] },
};

function addBody(world, name, type, shape, x, y, extra = {}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({ x, y, rotation: extra.rotation ?? 0 }));
  const { rotation, ...rbExtra } = extra;
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({
    bodyType: type,
    gravityScale: 0,
    linearDamping: 0,
    angularDamping: 0,
    ...rbExtra,
  }));
  e.addComponent(COLLIDER_2D, new Collider2D({
    shape,
    friction: 0,
    restitution: 0,
    ...shapeData[shape],
  }));
  return e;
}

function finiteBody(e) {
  const t = e.getComponent(TRANSFORM);
  const rb = e.getComponent(RIGIDBODY_2D);
  for (const v of [t.x, t.y, rb.velocityX, rb.velocityY, rb.angularVelocity]) {
    assert(Number.isFinite(v), `non-finite body state: ${v}`);
  }
  return { x: t.x, y: t.y, vx: rb.velocityX, vy: rb.velocityY };
}

function stepMany(physics, world, n, dt = 1 / 60) {
  for (let i = 0; i < n; i++) physics.step(world, dt, null);
}

const physics = new PhysicsWorld();
await physics.whenReady();

test('Kinematic -> Dynamic every shape pair: smooth first contact and convergence', () => {
  for (const pusherShape of SHAPES) {
    for (const targetShape of SHAPES) {
      const world = new World();
      const pusher = addBody(world, 'KinematicPusher', BodyType.KINEMATIC, pusherShape, 40, 100, { velocityX: 180, velocityY: 0 });
      const target = addBody(world, 'DynamicTarget', BodyType.DYNAMIC, targetShape, 82, 100);
      physics.clear();

      let firstPush = null;
      let maxGain = 0;
      let prevVx = 0;
      let signChanges = 0;
      let prevDx = 0;
      let touched = false;

      for (let frame = 0; frame < 90; frame++) {
        pusher.getComponent(RIGIDBODY_2D).driveVelocityX = 180;
        const before = target.getComponent(TRANSFORM);
        const bx = before.x;
        physics.step(world, 1 / 60, null);
        const after = target.getComponent(TRANSFORM);
        const rb = target.getComponent(RIGIDBODY_2D);
        const vx = rb.velocityX;
        const dx = after.x - bx;
        finiteBody(target);
        if (vx > 0.01 && firstPush === null) firstPush = vx;
        maxGain = Math.max(maxGain, vx - prevVx);
        if (Math.abs(dx) > 0.01) {
          if (Math.abs(prevDx) > 0.01 && Math.sign(dx) !== Math.sign(prevDx)) signChanges++;
          prevDx = dx;
        }
        prevVx = vx;
        if (dx > 0.01) touched = true;
      }

      const end = finiteBody(target);
      assert(touched, `${pusherShape} -> ${targetShape}: target never moved`);
      assert(firstPush !== null, `${pusherShape} -> ${targetShape}: no push detected`);
      assert(firstPush < 90, `${pusherShape} -> ${targetShape}: first push too abrupt ${firstPush}`);
      assert(maxGain < 65, `${pusherShape} -> ${targetShape}: one-frame shove too large ${maxGain}`);
      assert(end.vx > 120 && end.vx < 200, `${pusherShape} -> ${targetShape}: did not converge smoothly, vx=${end.vx}`);
      assert(signChanges <= 1, `${pusherShape} -> ${targetShape}: horizontal shake signChanges=${signChanges}`);
    }
  }
});

test('Dynamic -> Dynamic every shape pair: mutual push remains stable', () => {
  for (const pusherShape of SHAPES) {
    for (const targetShape of SHAPES) {
      const world = new World();
      const pusher = addBody(world, 'DynamicPusher', BodyType.DYNAMIC, pusherShape, 40, 100, { velocityX: 0, velocityY: 0 });
      const target = addBody(world, 'DynamicTarget', BodyType.DYNAMIC, targetShape, 82, 100);
      physics.clear();

      let firstTargetV = null;
      let maxTargetGain = 0;
      let prevTargetV = 0;
      let maxFrameMove = 0;

      for (let frame = 0; frame < 90; frame++) {
        pusher.getComponent(RIGIDBODY_2D).driveVelocityX = 180;
        const before = target.getComponent(TRANSFORM);
        const bx = before.x, by = before.y;
        physics.step(world, 1 / 60, null);
        const after = target.getComponent(TRANSFORM);
        const rb = target.getComponent(RIGIDBODY_2D);
        const vx = rb.velocityX;
        if (vx > 0.01 && firstTargetV === null) firstTargetV = vx;
        maxTargetGain = Math.max(maxTargetGain, vx - prevTargetV);
        prevTargetV = vx;
        maxFrameMove = Math.max(maxFrameMove, Math.hypot(after.x - bx, after.y - by));
        finiteBody(pusher);
        finiteBody(target);
      }

      assert(firstTargetV !== null, `${pusherShape} -> ${targetShape}: Dynamic target never received momentum`);
      assert(maxTargetGain < 130, `${pusherShape} -> ${targetShape}: unstable Dynamic impulse ${maxTargetGain}`);
      assert(maxFrameMove < 8, `${pusherShape} -> ${targetShape}: teleport-like Dynamic movement ${maxFrameMove}`);
    }
  }
});

test('Kinematic -> stacked Dynamic: bottom body remains easy to push for every shape pairing under gravity', () => {
  for (const pusherShape of SHAPES) {
    for (const bottomShape of SHAPES) {
      for (const topShape of SHAPES) {
        const world = new World();
        const floor = addBody(world, 'Floor', BodyType.STATIC, ColliderShape.BOX, 120, 190, { gravityScale: 0, lockRotation: true });
        floor.getComponent(COLLIDER_2D).width = 240;
        const pusher = addBody(world, 'KinematicPusher', BodyType.KINEMATIC, pusherShape, 35, 170, { velocityX: 0, velocityY: 0, lockRotation: true });
        const bottom = addBody(world, 'BottomDynamic', BodyType.DYNAMIC, bottomShape, 80, 150, { gravityScale: 1, lockRotation: true });
        const top = addBody(world, 'TopDynamic', BodyType.DYNAMIC, topShape, 80, 125, { gravityScale: 1, lockRotation: true, rotation: topShape === ColliderShape.TRIANGLE ? 180 : 0 });
        world.gravity = world.gravity || undefined;
        physics.clear();

        // Let the stack settle onto the real Static floor before pushing.
        stepMany(physics, world, 120);
        const bottomStart = bottom.getComponent(TRANSFORM).x;
        const topStart = top.getComponent(TRANSFORM).x;
        assert(Math.abs(bottom.getComponent(RIGIDBODY_2D).velocityY) < 2, `${pusherShape}/${bottomShape}/${topShape}: bottom not settled`);

        pusher.getComponent(RIGIDBODY_2D).velocityX = 180;
        let firstPush = null;
        let maxGain = 0;
        let prevV = 0;
        let maxFrameMove = 0;
        let prevX = bottomStart;
        for (let frame = 0; frame < 120; frame++) {
          physics.step(world, 1 / 60, null);
          const brb = bottom.getComponent(RIGIDBODY_2D);
          const vx = brb.velocityX;
          const bx = bottom.getComponent(TRANSFORM).x;
          if (vx > 0.01 && firstPush === null) firstPush = vx;
          maxGain = Math.max(maxGain, vx - prevV);
          maxFrameMove = Math.max(maxFrameMove, Math.abs(bx - prevX));
          prevV = vx;
          prevX = bx;
          finiteBody(bottom);
          finiteBody(top);
          finiteBody(pusher);
        }

        const bottomEnd = bottom.getComponent(TRANSFORM);
        const topEnd = top.getComponent(TRANSFORM);
        const moved = bottomEnd.x - bottomStart;
        const topMoved = topEnd.x - topStart;

        assert(firstPush !== null, `${pusherShape}/${bottomShape}/${topShape}: stack bottom never started moving`);
        assert(firstPush < 100, `${pusherShape}/${bottomShape}/${topShape}: stack first push too abrupt ${firstPush}`);
        assert(maxGain < 90, `${pusherShape}/${bottomShape}/${topShape}: stack shove too large ${maxGain}`);
        assert(maxFrameMove < 8, `${pusherShape}/${bottomShape}/${topShape}: stack teleport-like move ${maxFrameMove}`);
        assert(moved > 20, `${pusherShape}/${bottomShape}/${topShape}: bottom remained effectively immobile moved=${moved}`);
        assert(Math.abs(topMoved) < 500, `${pusherShape}/${bottomShape}/${topShape}: top body became unstable moved=${topMoved}`);
      }
    }
  }
});

test('Every shape pair against Static and Kinematic obstacles: no tunneling or instability', () => {
  for (const moverShape of SHAPES) {
    for (const obstacleShape of SHAPES) {
      for (const obstacleType of [BodyType.STATIC, BodyType.KINEMATIC]) {
        const world = new World();
        addBody(world, 'Obstacle', obstacleType, obstacleShape, 110, 100, { velocityX: 0, velocityY: 0 });
        const mover = addBody(world, 'Mover', BodyType.DYNAMIC, moverShape, 40, 100, { velocityX: 600, velocityY: 0 });
        physics.clear();
        let maxFrameMove = 0;
        let previousX = mover.getComponent(TRANSFORM).x;
        for (let frame = 0; frame < 30; frame++) {
          physics.step(world, 1 / 60, null);
          const t = mover.getComponent(TRANSFORM);
          maxFrameMove = Math.max(maxFrameMove, Math.abs(t.x - previousX));
          previousX = t.x;
          finiteBody(mover);
        }
        const finalX = mover.getComponent(TRANSFORM).x;
        assert(finalX < 112, `${moverShape} vs ${obstacleType}/${obstacleShape}: tunneled through obstacle finalX=${finalX}`);
        assert(maxFrameMove < 15, `${moverShape} vs ${obstacleType}/${obstacleShape}: unstable movement spike ${maxFrameMove}`);
      }
    }
  }
});

test('Rotated mixed-shape Kinematic pushes remain smooth', () => {
  for (const pusherShape of SHAPES) {
    for (const targetShape of SHAPES) {
      const world = new World();
      const pusher = addBody(world, 'RotatedPusher', BodyType.KINEMATIC, pusherShape, 35, 100, { velocityX: 220, rotation: 22 });
      const target = addBody(world, 'RotatedTarget', BodyType.DYNAMIC, targetShape, 82, 100, { rotation: -18 });
      physics.clear();
      let first = null;
      let maxGain = 0;
      let prev = 0;
      for (let i = 0; i < 75; i++) {
        physics.step(world, 1 / 60, null);
        const v = target.getComponent(RIGIDBODY_2D).velocityX;
        if (v > 0.01 && first === null) first = v;
        maxGain = Math.max(maxGain, v - prev);
        prev = v;
        finiteBody(target);
      }
      assert(first !== null, `${pusherShape}/${targetShape}: rotated push never started`);
      assert(first < 110, `${pusherShape}/${targetShape}: rotated first push too large ${first}`);
      assert(maxGain < 80, `${pusherShape}/${targetShape}: rotated push spike ${maxGain}`);
    }
  }
});

console.log('PASS: comprehensive shape/body push matrix loaded');
