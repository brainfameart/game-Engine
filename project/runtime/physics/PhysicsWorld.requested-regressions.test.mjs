import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';

const physics = new PhysicsWorld();
await physics.whenReady();

function addBody(world, name, type, x, y, w = 20, h = 20, extra = {}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({ x, y }));
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: type, ...extra }));
  e.addComponent(COLLIDER_2D, new Collider2D({
    shape: ColliderShape.BOX,
    width: w,
    height: h,
    friction: 0,
  }));
  return e;
}

// Requested onUpdate regression: simulate the exact user script after each
// physics step. Once grounded, rotation must become exactly 90 and remain
// there instead of alternating around the target because the Rapier body and
// Transform were previously one frame out of sync.
{
  const world = new World();
  addBody(world, 'Floor', BodyType.STATIC, 100, 100, 240, 20);
  const kin = addBody(world, 'Spinner', BodyType.KINEMATIC, 100, 74, 20, 20, {
    velocityX: 0,
    velocityY: 60,
  });
  const tf = kin.getComponent(TRANSFORM);
  const rb = kin.getComponent(RIGIDBODY_2D);
  tf.rotation = 88;
  physics.clear();

  let groundedSeen = false;
  const groundedRotations = [];
  let maxGroundedDeviation = 0;
  for (let i = 0; i < 30; i++) {
    physics.step(world, 1 / 60, null);

    // Exact user logic, with the same API values used by scripts.
    if (!rb.grounded) {
      rb.velocityY += 20;
      tf.rotation = tf.rotation + 2;
    } else {
      rb.velocityY = 0;
      tf.rotation = 90;
      groundedSeen = true;
      groundedRotations.push(tf.rotation);
      maxGroundedDeviation = Math.max(maxGroundedDeviation, Math.abs(tf.rotation - 90));
    }
  }

  if (!groundedSeen) throw new Error('rotation regression setup never became grounded');
  if (groundedRotations.some((r) => r !== 90)) {
    throw new Error(`grounded rotation did not stay snapped to 90: ${groundedRotations.join(',')}`);
  }
  if (maxGroundedDeviation !== 0) {
    throw new Error(`grounded rotation deviated from 90 by ${maxGroundedDeviation}`);
  }
  console.log('PASS requested kinematic rotation snap', {
    groundedFrames: groundedRotations.length,
    finalRotation: tf.rotation,
    finalY: tf.y,
  });
}

// Requested falling-through-static-body regression: a high-speed downward
// Kinematic must resolve at the floor contact instead of entering the Static
// collider and requiring multiple frames of bounded upward recovery.
{
  const world = new World();
  const floor = addBody(world, 'Floor', BodyType.STATIC, 100, 100, 240, 20);
  const kin = addBody(world, 'FallingKin', BodyType.KINEMATIC, 100, 0, 20, 20, {
    velocityX: 0,
    velocityY: 3000,
  });
  const rb = kin.getComponent(RIGIDBODY_2D);
  physics.clear();

  let firstContactY = null;
  let worstFloorPenetration = 0;
  for (let i = 0; i < 12; i++) {
    physics.step(world, 1 / 60, null);
    const tf = kin.getComponent(TRANSFORM);
    const floorTop = 90;
    const penetration = Math.max(0, tf.y + 10 - floorTop);
    worstFloorPenetration = Math.max(worstFloorPenetration, penetration);
    if (firstContactY === null && rb.grounded) firstContactY = tf.y;
  }

  const finalY = kin.getComponent(TRANSFORM).y;
  if (firstContactY === null) throw new Error('falling kinematic never reported ground contact');
  if (!(firstContactY >= 79.75 && firstContactY <= 80.25)) {
    throw new Error(`falling kinematic entered floor too far before settling: firstContactY=${firstContactY}`);
  }
  if (worstFloorPenetration > 0.05) {
    throw new Error(`falling kinematic penetrated static floor by ${worstFloorPenetration}px`);
  }
  if (!(finalY >= 79.75 && finalY <= 80.25)) {
    throw new Error(`falling kinematic did not remain on floor: finalY=${finalY}`);
  }
  console.log('PASS requested kinematic/static fall resolution', {
    firstContactY,
    finalY,
    worstFloorPenetration,
    grounded: rb.grounded,
    floor: floor.id,
  });
}
