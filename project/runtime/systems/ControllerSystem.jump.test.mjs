// Controller jump-state regression tests.
// These tests exercise the real ControllerSystem methods with a deterministic
// fake Rapier contact source so the pre-physics/post-physics ordering bug is
// isolated without depending on a browser or renderer.

globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
};

const { ControllerSystem } = await import('./ControllerSystem.js');
const { TRANSFORM, Transform } = await import('../components/Transform.js');
const { RIGIDBODY_2D, Rigidbody2D, BodyType } = await import('../components/Rigidbody2D.js');
const { COLLIDER_2D, Collider2D } = await import('../components/Collider2D.js');
const { CHARACTER_CONTROLLER, CharacterController, ControllerType } = await import('../components/CharacterController.js');
const { World } = await import('../core/World.js');

const controllerSystem = new ControllerSystem();
// Simulate the exact stale-contact condition: Rapier still reports the floor
// contact from the previous physics step for the first frame after takeoff.
controllerSystem.physicsWorld = { hasGroundContact: () => true };

function makeScene(bodyType, maxJumps = 1) {
  const world = new World();
  const entity = world.createEntity('Player');
  entity.addComponent(TRANSFORM, new Transform({ x: 0, y: 0 }));
  const rb = new Rigidbody2D({
    bodyType,
    gravityScale: 1,
    velocityX: 0,
    velocityY: 0,
    grounded: true,
  });
  const cc = new CharacterController({
    controllerType: ControllerType.PLATFORMER,
    moveSpeed: 0,
    acceleration: 20,
    airControl: 0,
    canJump: true,
    jumpForce: 420,
    maxJumps,
    useGravity: true,
    useDefaultInput: false,
  });
  entity.addComponent(RIGIDBODY_2D, rb);
  entity.addComponent(CHARACTER_CONTROLLER, cc);
  return { world, entity, rb, cc };
}

function dynamicTick(scene, dt = 1 / 60) {
  controllerSystem._applyDynamic(scene.entity.id, scene.cc, scene.rb, dt);
}

function kinematicTick(scene, dt = 1 / 60) {
  controllerSystem._applyKinematic(scene.entity.id, scene.cc, scene.rb, dt);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// Dynamic: a real jump must survive the stale floor contact from the previous step.
{
  const s = makeScene(BodyType.DYNAMIC, 1);
  s.cc.requestJump = true;
  dynamicTick(s);
  assert(s.rb.driveVelocityY === -420, `Dynamic jump kick missing: ${s.rb.driveVelocityY}`);
  assert(s.cc && controllerSystem._jumpsUsed.get(s.entity.id) === 1, 'Dynamic jump allowance was not consumed');
  // PhysicsWorld consumes this transient drive value during the real physics step.
  s.rb.driveVelocityY = null;

  // Simulate Rapier's next frame: the body is already moving upward, while the
  // contact manifold still says it touches the floor.
  s.rb.velocityY = -403.667;
  s.rb.grounded = true;
  s.cc.requestJump = true;
  dynamicTick(s);
  assert(s.rb.grounded === false, 'Dynamic stale floor contact was still treated as grounded during ascent');
  assert(controllerSystem._jumpsUsed.get(s.entity.id) === 1, 'Dynamic stale floor contact reset jumps-used during ascent');
  assert(s.rb.driveVelocityY === null, 'Dynamic mid-air jump spam incorrectly overwrote the jump velocity');

  // A genuine landing is different: upward velocity is gone, contact remains,
  // so the allowance must reset and a fresh jump must work.
  s.rb.velocityY = 0;
  s.rb.grounded = true;
  controllerSystem._jumpAirTime.set(s.entity.id, 0.10);
  s.cc.requestJump = false;
  dynamicTick(s);
  assert(controllerSystem._jumpsUsed.get(s.entity.id) === 0, 'Dynamic landing did not reset jump allowance');
  s.cc.requestJump = true;
  dynamicTick(s);
  assert(s.rb.driveVelocityY === -420, 'Dynamic jump after landing did not launch');
}

// Kinematic: the stored controller velocity must not be zeroed by the stale
// floor contact on the frame immediately after takeoff.
{
  const s = makeScene(BodyType.KINEMATIC, 1);
  s.cc.requestJump = true;
  kinematicTick(s);
  assert(s.rb.velocityY === -420, `Kinematic jump kick missing: ${s.rb.velocityY}`);
  assert(controllerSystem._jumpsUsed.get(s.entity.id) === 1, 'Kinematic jump allowance was not consumed');

  // Rapier's previous-step contact is still true, but the controller's stored
  // vertical velocity is upward. Gravity should continue the arc instead of
  // resetting it to zero.
  s.rb.grounded = true;
  s.cc.requestJump = true;
  kinematicTick(s);
  assert(s.rb.velocityY < -350, `Kinematic jump was cancelled/shortened: vy=${s.rb.velocityY}`);
  assert(controllerSystem._jumpsUsed.get(s.entity.id) === 1, 'Kinematic stale floor contact reset jumps-used during ascent');

  // Genuine landing resets the allowance.
  s.rb.velocityY = 0;
  controllerSystem._verticalVelocity.set(s.entity.id, 0);
  controllerSystem._jumpAirTime.set(s.entity.id, 0.10);
  s.rb.grounded = true;
  s.cc.requestJump = false;
  kinematicTick(s);
  assert(controllerSystem._jumpsUsed.get(s.entity.id) === 0, 'Kinematic landing did not reset jump allowance');
  s.cc.requestJump = true;
  kinematicTick(s);
  assert(s.rb.velocityY === -420, 'Kinematic jump after landing did not launch');
}

// Double jump: upward contact must not accidentally reset the first jump,
// while a third request must still be rejected when maxJumps=2.
for (const bodyType of [BodyType.DYNAMIC, BodyType.KINEMATIC]) {
  controllerSystem._jumpsUsed.clear();
  const s = makeScene(bodyType, 2);
  const tick = bodyType === BodyType.DYNAMIC ? dynamicTick : kinematicTick;

  s.cc.requestJump = true;
  tick(s);
  if (bodyType === BodyType.DYNAMIC) s.rb.velocityY = -403.667;
  s.rb.grounded = true; // stale contact again.

  s.cc.requestJump = true;
  tick(s);
  assert(controllerSystem._jumpsUsed.get(s.entity.id) === 2, `${bodyType} second mid-air jump was blocked/reset incorrectly`);

  if (bodyType === BodyType.DYNAMIC) s.rb.velocityY = -403.667;
  s.rb.grounded = false;
  s.cc.requestJump = true;
  tick(s);
  assert(controllerSystem._jumpsUsed.get(s.entity.id) === 2, `${bodyType} third mid-air jump was incorrectly accepted`);
}


// Script-authored Kinematic Platformer jump: a direct
// `this.rigidbody.velocityY = -200` must not be overwritten by the
// controller's private gravity velocity on the following frame. This is the
// exact lifecycle ordering used by the engine: ScriptSystem runs after
// PhysicsSystem, then ControllerSystem runs before the next physics step.
{
  controllerSystem._verticalVelocity.clear();
  controllerSystem._jumpsUsed.clear();
  controllerSystem._jumpAirTime.clear();
  controllerSystem._jumpHasLaunched.clear();
  const s = makeScene(BodyType.KINEMATIC, 1);
  s.cc.useDefaultInput = false;
  // Simulate the RigidbodyAPI Kinematic velocityY setter.
  s.rb._scriptVelocityY = -200;
  s.rb.grounded = true;
  kinematicTick(s);
  assert(s.rb.velocityY === -200, `script velocityY jump was overwritten on the ground: ${s.rb.velocityY}`);
  assert(controllerSystem._verticalVelocity.get(s.entity.id) === -200, 'script velocityY was not handed into the controller velocity state');

  // Simulate the next Platformer frame: the old ground manifold may still be
  // true, but the upward velocity must keep the body airborne. The controller
  // then applies exactly one gravity step, rather than replacing the jump
  // with its old zeroed state.
  s.rb.grounded = true;
  kinematicTick(s);
  assert(s.rb.velocityY < -180 && s.rb.velocityY > -190, `script-authored jump was not carried into the Platformer arc: ${s.rb.velocityY}`);

  // Simulate the user's onUpdate gravity line for several frames. Each frame
  // the script reads the current velocity and adds +20, then the controller
  // consumes that explicit script value. The jump must continue through the
  // full arc rather than requiring repeated Space presses.
  let sawUpward = false;
  let sawDownward = false;
  for (let i = 0; i < 24; i++) {
    s.rb.grounded = true;
    s.rb._scriptVelocityY = s.rb.velocityY + 20;
    kinematicTick(s);
    if (s.rb.velocityY < 0) sawUpward = true;
    if (sawUpward && s.rb.velocityY > 0) sawDownward = true;
    assert(Number.isFinite(s.rb.velocityY), `script-driven Platformer arc became non-finite at frame ${i}`);
  }
  assert(sawUpward, 'script-driven Platformer jump never entered the upward arc');
  assert(sawDownward, 'script-driven Platformer jump never transitioned into the downward arc');
}

console.log('PASS dynamic stale-contact jump preservation');
console.log('PASS kinematic stale-contact jump preservation');
console.log('PASS dynamic + kinematic double-jump limits');
console.log('ALL JUMP CONTROLLER REGRESSION TESTS PASSED');
