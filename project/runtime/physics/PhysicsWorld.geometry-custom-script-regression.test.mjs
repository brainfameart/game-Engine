import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';
import { ScriptAPI } from '../scripting/ScriptAPI.js';

const physics = new PhysicsWorld();
await physics.whenReady();

function addBody(world, name, type, x, y, w = 20, h = 20, extra = {}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({ x, y }));
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: type, ...extra }));
  e.addComponent(COLLIDER_2D, new Collider2D({ shape: ColliderShape.BOX, width: w, height: h, friction: 0 }));
  return e;
}

// Exact custom Geometry-style script with NO Movement Type / CharacterController.
// The important regression is that the first jump must not be cancelled by the
// previous frame's grounded contact, while the collider is rotating in mid-air.
{
  const world = new World();
  addBody(world, 'Floor', BodyType.STATIC, 100, 100, 240, 20);
  const player = addBody(world, 'GeometryPlayer', BodyType.KINEMATIC, 100, 80, 20, 20, {
    velocityX: 0,
    velocityY: 0,
  });
  const rb = player.getComponent(RIGIDBODY_2D);
  const tf = player.getComponent(TRANSFORM);
  const scriptApi = new ScriptAPI(world);
  scriptApi._kinematicRotationFn = (entity, rotationDeg) => physics.syncScriptKinematicRotation(entity, rotationDeg);
  const script = scriptApi.createEntityContext(player);
  physics.clear();

  // Establish a genuine grounded state first.
  for (let i = 0; i < 5; i++) physics.step(world, 1 / 60, null);
  assert.equal(rb.grounded, true, 'custom Kinematic test did not start grounded');

  let sawFullJump = false;
  let sawRotation = false;
  let sawDownward = false;
  let jumpSent = false;
  let minY = tf.y;

  for (let frame = 0; frame < 40; frame++) {
    // Physics runs before ScriptSystem in the engine.
    physics.step(world, 1 / 60, null);

    // Exact user script, with only Space's keyPressed represented by jumpSent.
    if (!rb.grounded) {
      rb.velocityY += 20;
      rb._scriptVelocityY = rb.velocityY;
      tf.rotation = tf.rotation + 2;
      sawRotation = true;
    } else {
      rb.velocityY = 0;
      rb._scriptVelocityY = 0;
      tf.rotation = 0;
    }
    if (!jumpSent && rb.grounded) {
      rb.velocityY = -200;
      rb._scriptVelocityY = -200;
      jumpSent = true;
      minY = tf.y;
    }

    minY = Math.min(minY, tf.y);
    if (rb.velocityY <= -180) sawFullJump = true;
    if (jumpSent && rb.velocityY > 0) sawDownward = true;
  }

  assert.equal(jumpSent, true, 'custom Geometry jump was never triggered');
  assert.equal(sawFullJump, true, 'custom Geometry jump did not retain its full initial upward velocity');
  assert.equal(sawRotation, true, 'custom Geometry body did not rotate in mid-air');
  assert.equal(sawDownward, true, 'custom Geometry jump never transitioned into downward motion');
  assert.ok(minY < 74, `custom Geometry body did not rise from the ground: minY=${minY}`);
  console.log('PASS custom Kinematic Geometry jump + mid-air rotation');
}

console.log('ALL CUSTOM GEOMETRY REGRESSIONS PASSED');

// Grounded rotation snap regression: run the exact game ordering
// (physics -> script -> physics). A Geometry-style cube rotates in air, then
// snaps to the nearest 90° on landing. The snap must preserve ground support
// so the next script update does NOT resume airborne rotation.
{
  const world = new World();
  addBody(world, 'SnapFloor', BodyType.STATIC, 100, 110, 240, 20);
  const player = addBody(world, 'SnapCube', BodyType.KINEMATIC, 100, 70, 20, 20, { velocityY: 0 });
  const rb = player.getComponent(RIGIDBODY_2D);
  const tf = player.getComponent(TRANSFORM);
  const scriptApi = new ScriptAPI(world);
  scriptApi._kinematicRotationFn = (entity, rotationDeg) => physics.syncScriptKinematicRotation(entity, rotationDeg);
  const script = scriptApi.createEntityContext(player);
  physics.clear();

  // Run the exact custom-script lifecycle and establish a real grounded state.
  for (let i = 0; i < 80; i++) {
    physics.step(world, 1 / 60, null);
    if (!rb.grounded) {
      rb.velocityY += 20;
      rb._scriptVelocityY = rb.velocityY;
      script.rotation = script.rotation + 6;
    } else {
      rb.velocityY = 0;
      rb._scriptVelocityY = 0;
      script.rotation = 0;
    }
  }
  assert.equal(rb.grounded, true, 'rotation-snap cube did not reach a stable grounded state');

  // Jump once. At 6°/frame this intentionally reaches the floor at a
  // non-cardinal angle so the landing snap changes the collider support point.
  rb.velocityY = -200;
  rb._scriptVelocityY = -200;
  rb.grounded = false;
  let landed = false;
  let landingFrame = -1;
  let landingY = 0;
  let landingX = 0;
  for (let frame = 0; frame < 80; frame++) {
    physics.step(world, 1 / 60, null);

    // Exact user script.
    if (!rb.grounded) {
      rb.velocityY += 20;
      rb._scriptVelocityY = rb.velocityY;
      script.rotation = script.rotation + 6;
    } else {
      rb.velocityY = 0;
      rb._scriptVelocityY = 0;
      const target = Math.round(tf.rotation / 90) * 90;
      script.rotation = target;
      if (!landed) {
        landed = true;
        landingFrame = frame;
        landingY = tf.y;
        landingX = tf.x;
      }
    }

    if (landed && frame >= landingFrame + 1) {
      assert.equal(rb.grounded, true, `grounded state was lost after snap at frame ${frame}`);
      assert.ok(Math.abs(tf.rotation % 90) < 1e-4, `rotation was not aligned to 90° after landing: ${tf.rotation}`);
      assert.ok(Math.abs(tf.y - landingY) < 0.05, `cube moved/oscillated after landing snap: ${tf.y} vs ${landingY}`);
      assert.ok(Math.abs(tf.x - landingX) < 0.05, `rotation snap caused unintended horizontal movement: ${tf.x} vs ${landingX}`);
      if (frame >= landingFrame + 10) break;
    }
  }

  assert.equal(landed, true, 'custom Geometry jump never landed');
  console.log('PASS Kinematic Geometry landing snap preserves support with no vibration');
}

console.log('ALL CUSTOM GEOMETRY ROTATION-SNAP REGRESSIONS PASSED');

// Exact reported script: no horizontal movement logic at all. A grounded
// rotation reset must never manufacture X travel on a flat floor.
{
  const world = new World();
  addBody(world, 'ExactFloor', BodyType.STATIC, 100, 110, 240, 20);
  const player = addBody(world, 'ExactCube', BodyType.KINEMATIC, 100, 70, 20, 20, { velocityX: 0, velocityY: 0 });
  const rb = player.getComponent(RIGIDBODY_2D);
  const tf = player.getComponent(TRANSFORM);
  const scriptApi = new ScriptAPI(world);
  scriptApi._kinematicRotationFn = (entity, rotationDeg) => physics.syncScriptKinematicRotation(entity, rotationDeg);
  const script = scriptApi.createEntityContext(player);
  physics.clear();

  for (let i = 0; i < 80; i++) {
    physics.step(world, 1 / 60, null);
    if (!rb.grounded) {
      rb.velocityY += 20;
      rb._scriptVelocityY = rb.velocityY;
      script.rotation = script.rotation + 2;
    } else {
      rb.velocityY = 0;
      rb._scriptVelocityY = 0;
      script.rotation = 0;
    }
  }
  assert.equal(rb.grounded, true, 'exact reported script did not start grounded');
  const startX = tf.x;

  // Launch once, then execute the exact logic reported by the user.
  rb.velocityY = -200;
  rb._scriptVelocityY = -200;
  rb.grounded = false;

  let landed = false;
  let landedX = startX;
  let postLandingFrames = 0;
  for (let frame = 0; frame < 120; frame++) {
    physics.step(world, 1 / 60, null);
    if (!rb.grounded) {
      rb.velocityY += 20;
      rb._scriptVelocityY = rb.velocityY;
      script.rotation = script.rotation + 2;
    } else {
      rb.velocityY = 0;
      rb._scriptVelocityY = 0;
      script.rotation = 0;
      if (!landed) {
        landed = true;
        landedX = tf.x;
      }
      postLandingFrames++;
      if (postLandingFrames >= 10) break;
    }
  }

  assert.equal(landed, true, 'exact reported script never landed');
  assert.ok(Math.abs(tf.rotation) < 1e-4, `exact reported script did not reset rotation: ${tf.rotation}`);
  assert.ok(Math.abs(tf.x - landedX) < 0.05, `exact reported script drifted horizontally after rotation reset: ${tf.x} vs ${landedX}`);
  assert.ok(Math.abs(landedX - startX) < 0.05, `exact reported script manufactured forward movement: ${landedX} vs ${startX}`);
  console.log('PASS exact reported custom Geometry script has zero unintended horizontal rotation movement');
}

console.log('ALL EXACT REPORTED SCRIPT REGRESSIONS PASSED');

// Grounded stability regression: a Kinematic cube that was grounded must not
// enter the airborne rotation branch for one transient manifold-refresh frame.
// The nearby-support query is shape-accurate and only applies when there is no
// upward jump velocity, so ledge departure and jumps are unaffected.
{
  const world = new World();
  addBody(world, 'StableFloor', BodyType.STATIC, 100, 110, 240, 20);
  const player = addBody(world, 'StableCube', BodyType.KINEMATIC, 100, 90, 20, 20, { velocityX: 0, velocityY: 0 });
  const rb = player.getComponent(RIGIDBODY_2D);
  const tf = player.getComponent(TRANSFORM);
  const scriptApi = new ScriptAPI(world);
  scriptApi._kinematicRotationFn = (entity, rotationDeg) => physics.syncScriptKinematicRotation(entity, rotationDeg);
  const script = scriptApi.createEntityContext(player);
  physics.clear();
  for (let i = 0; i < 20; i++) physics.step(world, 1 / 60, null);
  assert.equal(rb.grounded, true, 'stability regression did not start grounded');

  // Mimic the contact-manifold refresh boundary without applying any upward
  // command: hide the current grounded flag for the script-visible frame,
  // then run the same rotation branch the user uses.
  rb.grounded = false;
  rb._scriptVelocityY = 0;
  const before = tf.rotation;
  const previousGrounded = true;
  // The engine's support tolerance is exercised by the next physics step.
  physics.step(world, 1 / 60, null);
  const visibleGrounded = rb.grounded;
  assert.equal(visibleGrounded, true, 'transient grounded loss was not stabilized');
  if (!visibleGrounded) script.rotation = script.rotation + 2;
  else script.rotation = 0;
  assert.equal(tf.rotation, 0, 'custom grounded script entered airborne rotation during contact refresh');
  console.log('PASS Kinematic grounded-state stability prevents false airborne rotation');
}

console.log('ALL GROUNDED-STABILITY REGRESSIONS PASSED');
