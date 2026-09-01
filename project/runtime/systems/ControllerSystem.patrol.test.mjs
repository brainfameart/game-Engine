// Patrol regression tests.
// 1. Reproduces the wall-jitter bug: a stale (one-frame-old) isOnWall
//    contact used to flip state.dir back and forth every frame instead
//    of walking cleanly away from the wall.
// 2. Verifies useDefaultInput=false disables auto-walk/auto-turn and
//    hands control to simulateMove(x, y) via requestMoveX/Y instead.
// 3. Verifies the wall + patrolDistance combo: whichever comes first
//    triggers the turn — a wall hit before reaching patrolDistance
//    turns early, and reaching patrolDistance with no wall in the way
//    still turns on its own.

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

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function makeScene({ useDefaultInput = true, patrolDistance = 150, moveSpeed = 100 } = {}) {
  const world = new World();
  const entity = world.createEntity('Guard');
  entity.addComponent(TRANSFORM, new Transform({ x: 0, y: 0 }));
  entity.addComponent(COLLIDER_2D, new Collider2D({ width: 16, height: 16 }));
  const rb = new Rigidbody2D({
    bodyType: BodyType.KINEMATIC,
    velocityX: 0,
    velocityY: 0,
    grounded: true,
    isOnWall: false,
  });
  const cc = new CharacterController({
    controllerType: ControllerType.PATROL,
    moveSpeed,
    acceleration: 1000, // near-instant so velocity reflects target immediately
    patrolDistance,
    useDefaultInput,
  });
  entity.addComponent(RIGIDBODY_2D, rb);
  entity.addComponent(CHARACTER_CONTROLLER, cc);
  return { world, entity, rb, cc };
}

const controllerSystem = new ControllerSystem();

// --- Test 1: stale isOnWall contact must NOT cause a flip every frame ---
{
  const scene = makeScene({ patrolDistance: 100000 }); // huge — isolate the wall trigger
  const dt = 1 / 60;

  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const state1 = controllerSystem._patrolState.get(scene.entity.id);
  assert(state1.dir === 1, 'expected initial direction to be right (1)');

  scene.rb.isOnWall = true;
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const state2 = controllerSystem._patrolState.get(scene.entity.id);
  assert(state2.dir === -1, 'expected direction to flip to left (-1) after hitting wall');

  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const state3 = controllerSystem._patrolState.get(scene.entity.id);
  assert(state3.dir === -1, 'BUG: direction flipped back on stale isOnWall contact (jitter)');

  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const state4 = controllerSystem._patrolState.get(scene.entity.id);
  assert(state4.dir === -1, 'BUG: direction flipped back again on stale isOnWall contact (jitter)');

  console.log('PASS: patrol wall contact does not oscillate direction every frame (jitter fix)');
}

// --- Test 2: useDefaultInput=false disables auto-walk; simulateMove drives it ---
{
  const scene = makeScene({ useDefaultInput: false });
  const dt = 1 / 60;

  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  assert(scene.rb.velocityX === 0, 'expected no auto-walk while useDefaultInput is false and no simulateMove call was made');

  scene.rb.isOnWall = true;
  const before = controllerSystem._patrolState.get(scene.entity.id).dir;
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const after = controllerSystem._patrolState.get(scene.entity.id).dir;
  assert(before === after, 'expected no auto-turn on wall contact while useDefaultInput is false');
  scene.rb.isOnWall = false;

  for (let i = 0; i < 30; i++) {
    scene.cc.requestMoveX = -1;
    controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  }
  assert(scene.rb.velocityX < -50, 'expected simulateMove(-1, 0) to drive the entity left while useDefaultInput is false, got velocityX=' + scene.rb.velocityX);

  console.log('PASS: useDefaultInput=false disables auto-walk/auto-turn and simulateMove drives movement manually');
}

// --- Test 3a: wall hit BEFORE patrolDistance turns early ---
{
  const scene = makeScene({ patrolDistance: 500, moveSpeed: 100 });
  const dt = 1 / 60;

  // Walk for a while (well under patrolDistance) then hit a wall.
  for (let i = 0; i < 30; i++) { // 0.5s * 100px/s = ~50px, far under 500
    controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  }
  const beforeWall = controllerSystem._patrolState.get(scene.entity.id);
  assert(beforeWall.dir === 1, 'expected still walking right before wall hit');
  assert(beforeWall.distance < 500, 'expected distance walked to still be under patrolDistance');

  scene.rb.isOnWall = true;
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const afterWall = controllerSystem._patrolState.get(scene.entity.id);
  assert(afterWall.dir === -1, 'expected wall hit to turn the patrol around before reaching patrolDistance');

  console.log('PASS: wall hit before patrolDistance turns early (whichever comes first)');
}

// --- Test 3b: reaching patrolDistance with no wall still turns on its own ---
{
  const scene = makeScene({ patrolDistance: 50, moveSpeed: 100 }); // small distance, easy to reach
  const dt = 1 / 60;
  scene.rb.isOnWall = false; // never touches a wall in this test

  let turned = false;
  let lastDir = controllerSystem._patrolState.get(scene.entity.id)?.dir;
  for (let i = 0; i < 120; i++) { // 2 seconds — plenty of time to cross 50px at 100px/s
    controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
    const state = controllerSystem._patrolState.get(scene.entity.id);
    if (lastDir !== undefined && state.dir !== lastDir) turned = true;
    lastDir = state.dir;
  }
  assert(turned, 'expected patrol to turn on its own after walking patrolDistance px with no wall in the way');

  console.log('PASS: reaching patrolDistance with no wall still turns on its own');
}

// --- Test 4: flipDirection() forces an immediate turn in AUTO mode
//     (useDefaultInput = true), without needing to disable auto-walk ---
{
  const scene = makeScene({ patrolDistance: 100000 }); // huge — isolate the flip
  const dt = 1 / 60;

  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const before = controllerSystem._patrolState.get(scene.entity.id);
  assert(before.dir === 1, 'expected initial direction to be right (1)');

  // requestFlip is what ControllerAPI.js's flipDirection() sets.
  scene.cc.requestFlip = true;
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const after = controllerSystem._patrolState.get(scene.entity.id);
  assert(after.dir === -1, 'expected flipDirection() to turn the patrol around while auto-walking');
  assert(scene.cc.requestFlip === false, 'expected requestFlip to be consumed/cleared after one update');

  // It should still be auto-walking afterward (not stuck/manual).
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  assert(scene.rb.velocityX < -50, 'expected patrol to keep auto-walking left after the flip, got velocityX=' + scene.rb.velocityX);

  console.log('PASS: flipDirection() forces an immediate turn while useDefaultInput is on (auto mode)');
}

// --- Test 5: flipDirection() also works in MANUAL mode
//     (useDefaultInput = false) ---
{
  const scene = makeScene({ useDefaultInput: false });
  const dt = 1 / 60;

  // Drive right via simulateMove for a bit.
  for (let i = 0; i < 10; i++) {
    scene.cc.requestMoveX = 1;
    controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  }
  const before = controllerSystem._patrolState.get(scene.entity.id);
  assert(before.dir === 1, 'expected facingDirection to track requestMoveX in manual mode');

  scene.cc.requestFlip = true;
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const after = controllerSystem._patrolState.get(scene.entity.id);
  assert(after.dir === -1, 'expected flipDirection() to work in manual mode too');

  console.log('PASS: flipDirection() also works while useDefaultInput is off (manual mode)');
}

// --- Test 6: flipDirection() does not cause a double-flip even if a
//     wall happens to be touched the same frame (turnLockout applies) ---
{
  const scene = makeScene({ patrolDistance: 100000 });
  const dt = 1 / 60;

  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const before = controllerSystem._patrolState.get(scene.entity.id).dir;

  scene.rb.isOnWall = true; // wall AND flip in the same frame
  scene.cc.requestFlip = true;
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const afterFlipFrame = controllerSystem._patrolState.get(scene.entity.id).dir;
  assert(afterFlipFrame !== before, 'expected exactly one flip this frame');

  // Next frame, isOnWall is still true (stale) — must not flip again.
  controllerSystem._applyPatrol(scene.entity, scene.cc, scene.rb, dt);
  const afterNextFrame = controllerSystem._patrolState.get(scene.entity.id).dir;
  assert(afterNextFrame === afterFlipFrame, 'BUG: flipDirection() + simultaneous stale wall contact caused a double-flip');

  console.log('PASS: flipDirection() + simultaneous wall contact does not double-flip');
}

console.log('All Patrol regression tests passed.');
