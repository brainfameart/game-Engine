// NavCar regressions: a valid path must launch from rest, steering must not
// chatter on a straight segment, and a short behind-target maneuver commits
// to one reverse side.
globalThis.window = { addEventListener(){}, removeEventListener(){} };
const { ControllerSystem } = await import('./ControllerSystem.js');
const { TRANSFORM, Transform } = await import('../components/Transform.js');
const { RIGIDBODY_2D, Rigidbody2D, BodyType } = await import('../components/Rigidbody2D.js');
const { CHARACTER_CONTROLLER, CharacterController, ControllerType } = await import('../components/CharacterController.js');
const { World } = await import('../core/World.js');

function assert(cond, message) { if (!cond) throw new Error(message); }
function scene() {
  const world = new World();
  const entity = world.createEntity('NavCar');
  const transform = new Transform({ x: 0, y: 0, rotation: 0 });
  const rb = new Rigidbody2D({ bodyType: BodyType.KINEMATIC });
  const cc = new CharacterController({
    controllerType: ControllerType.CAR,
    useDefaultInput: false,
    maxSpeed: 300,
    carAcceleration: 180,
    brakeForce: 360,
    turnSpeed: 120,
    driftFactor: 0.92,
  });
  entity.addComponent(TRANSFORM, transform);
  entity.addComponent(RIGIDBODY_2D, rb);
  entity.addComponent(CHARACTER_CONTROLLER, cc);
  return { world, entity, transform, rb, cc, system: new ControllerSystem() };
}

// Straight route: the car must actually launch from zero input speed.
{
  const s = scene();
  for (let i = 0; i < 12; i++) {
    s.cc.requestDriveTowardX = 0;
    s.cc.requestDriveTowardY = -400;
    s.system.updateLateCarInput(s.world, 1 / 60);
  }
  assert((s.system._carSpeed.get(s.entity.id) || 0) > 20, 'NavCar failed to launch from rest');
  assert(Math.abs(s.transform.rotation) < 1, 'straight route caused an unnecessary steering change');
  console.log('PASS NavCar launches and stays straight');
}

// Close behind target: reverse should be chosen and the steering side locked.
{
  const s = scene();
  let firstSign = null;
  let sawReverse = false;
  for (let i = 0; i < 30; i++) {
    s.cc.requestDriveTowardX = i < 15 ? 1 : -1;
    s.cc.requestDriveTowardY = 80;
    s.system.updateLateCarInput(s.world, 1 / 60);
    const state = s.system._driveTowardManeuver.get(s.entity.id);
    if (state?.mode === 'reverseAlign') {
      sawReverse = true;
      if (firstSign == null) firstSign = state.turnSign;
      assert(state.turnSign === firstSign, 'reverse steering side flipped during one maneuver');
    }
  }
  assert(sawReverse, 'close behind target did not enter reverse maneuver');
  console.log('PASS NavCar commits to one reverse direction');
}

console.log('\nNavCar regression tests passed.\n');
