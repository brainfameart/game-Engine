// Regression tests for the true directional joystick car mode.
// Keyboard/default input must remain the normal throttle+steer model.
// Joystick mode uses x/y direction, magnitude as throttle, and smooth heading.

globalThis.window = { addEventListener() {}, removeEventListener() {} };

const { ControllerSystem } = await import('./ControllerSystem.js');
const { TRANSFORM, Transform } = await import('../components/Transform.js');
const { RIGIDBODY_2D, Rigidbody2D, BodyType } = await import('../components/Rigidbody2D.js');
const { COLLIDER_2D, Collider2D } = await import('../components/Collider2D.js');
const { CHARACTER_CONTROLLER, CharacterController, ControllerType } = await import('../components/CharacterController.js');
const { World } = await import('../core/World.js');

function assert(cond, message) { if (!cond) throw new Error(message); }
function makeScene(useDefaultInput = true) {
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
    driftFactor: 0,
    useDefaultInput,
  });
  entity.addComponent(RIGIDBODY_2D, rb);
  entity.addComponent(CHARACTER_CONTROLLER, cc);
  return { world, entity, rb, cc };
}

const dt = 1 / 60;

// 1. Default keyboard still drives normally and remains fully controlled by the Inspector flag.
{
  const scene = makeScene(true);
  const system = new ControllerSystem();
  system.input.keys.add('ArrowUp');
  system.updateLateCarInput(scene.world, dt);
  assert(scene.rb.velocityY < 0, 'default ArrowUp should accelerate the car forward');
  assert(scene.cc.useDefaultInput === true, 'default input setting should remain true');
}

// 2. Inspector OFF really disables keyboard when no script input is supplied.
{
  const scene = makeScene(false);
  const system = new ControllerSystem();
  system.input.keys.add('ArrowUp');
  system.updateLateCarInput(scene.world, dt);
  assert(scene.rb.velocityX === 0 && scene.rb.velocityY === 0, 'Inspector useDefaultInput=false should disable keyboard');
  assert(scene.cc.useDefaultInput === false, 'default input setting should remain false');
}

// 3. Directional joystick: pushing straight up accelerates without rotating.
{
  const scene = makeScene(false);
  const system = new ControllerSystem();
  scene.cc.requestJoystickX = 0;
  scene.cc.requestJoystickY = -1;
  system.updateLateCarInput(scene.world, dt);
  assert(scene.rb.velocityY < -3, 'up joystick should accelerate forward');
  assert(Math.abs(scene.entity.getComponent(TRANSFORM).rotation) < 0.001, 'up joystick should target current forward heading');
  assert(scene.cc.useDefaultInput === false, 'joystick mode must not mutate Inspector default-input setting');
}

// 4. Diagonal/right joystick uses its direction, not a free 2D movement vector.
{
  const scene = makeScene(false);
  const system = new ControllerSystem();
  for (let i = 0; i < 60; i++) {
    scene.cc.requestJoystickX = 1;
    scene.cc.requestJoystickY = -1;
    system.updateLateCarInput(scene.world, dt);
  }
  const transform = scene.entity.getComponent(TRANSFORM);
  const angle = ((transform.rotation % 360) + 360) % 360;
  assert(angle > 30 && angle < 60, 'diagonal-up-right joystick should smoothly steer toward about 45 degrees, got ' + transform.rotation);
  assert(scene.rb.velocityX > 0 && scene.rb.velocityY < 0, 'diagonal-up-right joystick should move along the car\'s current forward heading');
}

// 5. Partial magnitude produces partial acceleration compared with full push.
{
  const full = makeScene(false);
  const half = makeScene(false);
  const fullSystem = new ControllerSystem();
  const halfSystem = new ControllerSystem();
  full.cc.requestJoystickX = 0;
  full.cc.requestJoystickY = -1;
  half.cc.requestJoystickX = 0;
  half.cc.requestJoystickY = -0.5;
  fullSystem.updateLateCarInput(full.world, dt);
  halfSystem.updateLateCarInput(half.world, dt);
  const fullSpeed = Math.abs(full.rb.velocityY);
  const halfSpeed = Math.abs(half.rb.velocityY);
  assert(Math.abs(halfSpeed - fullSpeed * 0.5) < 0.001, 'half joystick magnitude should produce half the first-step acceleration');
}

// 6. Releasing the joystick does not snap the car to a new heading.
{
  const scene = makeScene(false);
  const system = new ControllerSystem();
  scene.cc.requestJoystickX = 1;
  scene.cc.requestJoystickY = 0;
  system.updateLateCarInput(scene.world, dt);
  const beforeRelease = scene.entity.getComponent(TRANSFORM).rotation;
  scene.cc.requestJoystickX = 0;
  scene.cc.requestJoystickY = 0;
  system.updateLateCarInput(scene.world, dt);
  const afterRelease = scene.entity.getComponent(TRANSFORM).rotation;
  assert(Math.abs(afterRelease - beforeRelease) < 0.001, 'released joystick should not snap the car heading');
}

console.log('PASS: directional joystick car mode, keyboard/default input, and Inspector input setting all work together');
