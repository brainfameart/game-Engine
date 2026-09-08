// Car controller regression tests.
// Car controller regression tests.
// 1. Default WASD/Arrow input still drives the car.
// 2. useDefaultInput=false makes the Car script/joystick-only.
// 3. useDefaultInput=true now combines keyboard + scripted input instead
//    of making one source override the other.
// 4. Scripted analog values remain fractional and one-shot.
// 5. Steering causes speed loss while the car is moving, so a joystick
//    turn changes both heading and speed like an arcade driving model.
// 6. The late pass is the single Car pass, avoiding early/late double drive.

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

function makeScene({ useDefaultInput = true } = {}) {
  const world = new World();
  const entity = world.createEntity('Racer');
  entity.addComponent(TRANSFORM, new Transform({ x: 0, y: 0, rotation: 0 }));
  entity.addComponent(COLLIDER_2D, new Collider2D({ width: 16, height: 16 }));
  const rb = new Rigidbody2D({ bodyType: BodyType.KINEMATIC, velocityX: 0, velocityY: 0 });
  const cc = new CharacterController({
    controllerType: ControllerType.CAR,
    maxSpeed: 350,
    carAcceleration: 200,
    brakeForce: 400,
    turnSpeed: 150,
    useDefaultInput,
  });
  entity.addComponent(RIGIDBODY_2D, rb);
  entity.addComponent(CHARACTER_CONTROLLER, cc);
  return { world, entity, rb, cc };
}

const controllerSystem = new ControllerSystem();
const dt = 1 / 60;

// --- Test 1: useDefaultInput=true reads WASD/Arrows ---
{
  const scene = makeScene({ useDefaultInput: true });
  controllerSystem.input.keys.add('KeyW');

  for (let i = 0; i < 30; i++) {
    controllerSystem.updateLateCarInput(scene.world, dt);
  }

  assert(scene.rb.velocityY < -50,
    'expected KeyW to accelerate the car forward, got vy=' + scene.rb.velocityY);

  controllerSystem.input.keys.clear();
  console.log('PASS: useDefaultInput=true drives the car from WASD/Arrows');
}

// --- Test 2: useDefaultInput=false ignores keyboard, uses script input ---
{
  const scene = makeScene({ useDefaultInput: false });
  controllerSystem.input.keys.add('KeyW');

  for (let i = 0; i < 30; i++) {
    scene.cc.requestThrottle = 0.8;
    scene.cc.requestSteer = 0;
    controllerSystem.updateLateCarInput(scene.world, dt);
  }

  assert(scene.rb.velocityY < -50,
    'expected script throttle to drive the car when defaults are off, got vy=' + scene.rb.velocityY);

  controllerSystem.input.keys.clear();
  console.log('PASS: useDefaultInput=false is script/joystick-only');
}

// --- Test 3: default keyboard + script input are additive ---
{
  const scene = makeScene({ useDefaultInput: true });
  controllerSystem.input.keys.add('KeyW');

  // Script adds half throttle. The combined value clamps to 1 rather than
  // exceeding the controller's normalized input range.
  scene.cc.requestThrottle = 0.5;
  scene.cc.requestSteer = 0.0;
  controllerSystem.updateLateCarInput(scene.world, dt);
  const combinedSpeed = Math.abs(scene.rb.velocityY);

  // Same frame with keyboard only gives 1.0 throttle. Both should therefore
  // produce the same first-step acceleration.
  const keyOnly = makeScene({ useDefaultInput: true });
  controllerSystem.input.keys.add('KeyW');
  keyOnly.cc.requestThrottle = 0;
  keyOnly.cc.requestSteer = 0;
  controllerSystem.updateLateCarInput(keyOnly.world, dt);
  controllerSystem.input.keys.clear();

  assert(Math.abs(combinedSpeed - Math.abs(keyOnly.rb.velocityY)) < 0.001,
    'expected W + joystick throttle(.5) to clamp to full throttle, got ' +
    combinedSpeed + ' vs ' + Math.abs(keyOnly.rb.velocityY));

  console.log('PASS: default keyboard and simulateDrive() combine and clamp');
}

// --- Test 4: script can add steering while the default throttle is held ---
{
  const scene = makeScene({ useDefaultInput: true });
  controllerSystem.input.keys.add('KeyW');

  for (let i = 0; i < 30; i++) {
    scene.cc.requestThrottle = 0;
    scene.cc.requestSteer = 0.5;
    controllerSystem.updateLateCarInput(scene.world, dt);
  }
  controllerSystem.input.keys.clear();

  const transform = scene.entity.getComponent(TRANSFORM);
  assert(transform.rotation > 0,
    'expected scripted steer to turn the car while W is held, got rotation=' + transform.rotation);
  console.log('PASS: script steering can be added while default keyboard input is active');
}

// --- Test 5: one-shot requests are consumed ---
{
  const scene = makeScene({ useDefaultInput: false });
  scene.cc.requestThrottle = 1;
  scene.cc.requestSteer = 0;
  controllerSystem.updateLateCarInput(scene.world, dt);

  assert(scene.cc.requestThrottle === null,
    'expected requestThrottle to reset after one late-pass update');
  assert(scene.cc.requestSteer === null,
    'expected requestSteer to reset after one late-pass update');

  const speedAfterCall = Math.abs(scene.rb.velocityY);
  controllerSystem.updateLateCarInput(scene.world, dt);
  const speedAfterCoast = Math.abs(scene.rb.velocityY);

  assert(speedAfterCoast <= speedAfterCall,
    'expected no repeated scripted throttle without another request, got ' +
    speedAfterCall + ' -> ' + speedAfterCoast);

  console.log('PASS: simulateDrive requests remain one-shot');
}

// --- Test 6: joystick magnitude controls acceleration and angle controls heading ---
{
  const full = makeScene({ useDefaultInput: false });
  full.cc.requestThrottle = 1;
  full.cc.requestSteer = 0;
  controllerSystem.updateLateCarInput(full.world, dt);
  const fullStep = Math.abs(full.rb.velocityY);

  const half = makeScene({ useDefaultInput: false });
  half.cc.requestThrottle = 0.5;
  half.cc.requestSteer = 0;
  controllerSystem.updateLateCarInput(half.world, dt);
  const halfStep = Math.abs(half.rb.velocityY);

  assert(Math.abs(halfStep - fullStep * 0.5) < 0.001,
    'expected half joystick magnitude to produce half acceleration, got full=' +
    fullStep + ' half=' + halfStep);

  const turn = makeScene({ useDefaultInput: false });
  for (let i = 0; i < 30; i++) {
    turn.cc.requestThrottle = 1;
    turn.cc.requestSteer = 0;
    controllerSystem.updateLateCarInput(turn.world, dt);
  }
  const beforeTurn = turn.entity.getComponent(TRANSFORM).rotation;
  turn.cc.requestThrottle = 0;
  turn.cc.requestSteer = 1;
  controllerSystem.updateLateCarInput(turn.world, dt);
  const afterTurn = turn.entity.getComponent(TRANSFORM).rotation;
  const expectedTurnStep = 150 / 60;

  assert(afterTurn > beforeTurn,
    'expected joystick right input to turn toward +90 degrees, got ' + afterTurn);
  assert(Math.abs((afterTurn - beforeTurn) - expectedTurnStep) < 0.001,
    'expected smooth turnSpeed-limited steering step, got ' + (afterTurn - beforeTurn));
  assert(turn.rb.angularVelocity > 0,
    'expected positive angular velocity for joystick right');

  console.log('PASS: joystick magnitude controls acceleration and angle controls smooth steering');
}

// --- Test 6b: default keyboard input can add to a scripted joystick ---
{
  const scene = makeScene({ useDefaultInput: true });
  controllerSystem.input.keys.add('KeyW');
  scene.cc.requestThrottle = 0;
  scene.cc.requestSteer = 0.5;
  controllerSystem.updateLateCarInput(scene.world, dt);
  controllerSystem.input.keys.clear();

  const transform = scene.entity.getComponent(TRANSFORM);
  // First frame starts the car moving but must not rotate it in place.
  assert(Math.abs(transform.rotation) < 0.0001,
    'expected a stationary car to keep its heading on the first combined-input frame');
  scene.cc.requestThrottle = 0;
  scene.cc.requestSteer = 0.5;
  controllerSystem.updateLateCarInput(scene.world, dt);
  assert(transform.rotation > 0,
    'expected keyboard + script joystick to produce a combined rightward target once moving');
  assert(scene.rb.velocityY < 0,
    'expected W + scripted steer to continue moving the car forward');

  console.log('PASS: default keyboard input adds to scripted joystick input');
}

// --- Test 7: late pass uses current rotation for current velocity ---
{
  const scene = makeScene({ useDefaultInput: false });

  for (let i = 0; i < 30; i++) {
    scene.cc.requestThrottle = 1;
    scene.cc.requestSteer = 0;
    controllerSystem.updateLateCarInput(scene.world, dt);
  }

  const transform = scene.entity.getComponent(TRANSFORM);
  transform.rotation = 90;
  scene.cc.requestThrottle = 1;
  scene.cc.requestSteer = 0;
  controllerSystem.updateLateCarInput(scene.world, dt);

  assert(scene.rb.velocityX > 90,
    'expected velocityX to follow the new 90-degree heading, got vx=' + scene.rb.velocityX);
  assert(Math.abs(scene.rb.velocityY) < Math.abs(scene.rb.velocityX),
    'expected velocity direction to follow current rotation, got vx=' +
    scene.rb.velocityX + ' vy=' + scene.rb.velocityY);

  console.log('PASS: current rotation and velocity direction stay in lockstep');
}

// --- Test 8: no double-drive through early + late passes ---
{
  const scene = makeScene({ useDefaultInput: true });
  controllerSystem.input.keys.add('KeyW');

  // update() must NOT drive Car entities now; the late pass is the only Car
  // pass, regardless of useDefaultInput.
  controllerSystem.update(scene.world, dt);
  assert(scene.rb.velocityX === 0 && scene.rb.velocityY === 0,
    'expected early update() to leave Car untouched, got vx=' +
    scene.rb.velocityX + ' vy=' + scene.rb.velocityY);

  controllerSystem.updateLateCarInput(scene.world, dt);
  controllerSystem.input.keys.clear();

  assert(scene.rb.velocityY < 0,
    'expected late Car pass to apply the keyboard drive, got vy=' + scene.rb.velocityY);

  console.log('PASS: Car is driven exactly once by the late pass');
}

// --- Test 6c: steering must not rotate a stationary car ---
{
  const scriptScene = makeScene({ useDefaultInput: false });
  const startRotation = scriptScene.entity.getComponent(TRANSFORM).rotation;
  scriptScene.cc.requestThrottle = 0;
  scriptScene.cc.requestSteer = 1;
  controllerSystem.updateLateCarInput(scriptScene.world, dt);
  assert(Math.abs(scriptScene.entity.getComponent(TRANSFORM).rotation - startRotation) < 0.0001,
    'expected scripted steering to leave a stationary car facing the same direction');

  const keyScene = makeScene({ useDefaultInput: true });
  const keyStartRotation = keyScene.entity.getComponent(TRANSFORM).rotation;
  controllerSystem.input.keys.add('KeyD');
  controllerSystem.updateLateCarInput(keyScene.world, dt);
  controllerSystem.input.keys.clear();
  assert(Math.abs(keyScene.entity.getComponent(TRANSFORM).rotation - keyStartRotation) < 0.0001,
    'expected default steering to leave a stationary car facing the same direction');

  console.log('PASS: steering does not rotate a stationary car');
}

console.log('\nAll Car controller tests passed.\n');
