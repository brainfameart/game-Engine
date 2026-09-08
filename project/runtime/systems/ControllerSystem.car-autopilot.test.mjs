// NPC Car autopilot regressions: reverse maneuver must be committed, must
// create curvature even for a target directly behind, and must hand back to
// forward driving without gear/steering chatter.
globalThis.window = { addEventListener(){}, removeEventListener(){} };
const { ControllerSystem } = await import('./ControllerSystem.js');
const { TRANSFORM, Transform } = await import('../components/Transform.js');
const { RIGIDBODY_2D, Rigidbody2D, BodyType } = await import('../components/Rigidbody2D.js');
const { CHARACTER_CONTROLLER, CharacterController, ControllerType } = await import('../components/CharacterController.js');
const { World } = await import('../core/World.js');

function assert(cond, message) { if (!cond) throw new Error(message); }
function makeScene({ rotation=0, x=0, y=0 }={}) {
  const world = new World();
  const entity = world.createEntity('NPCCar');
  entity.addComponent(TRANSFORM, new Transform({x, y, rotation}));
  const rb = new Rigidbody2D({bodyType: BodyType.KINEMATIC, velocityX: 0, velocityY: 0});
  const cc = new CharacterController({
    controllerType: ControllerType.CAR,
    maxSpeed: 300,
    carAcceleration: 180,
    brakeForce: 360,
    turnSpeed: 120,
    driftFactor: 0.92,
    useDefaultInput: false,
    driveTowardArriveDistance: 12,
  });
  entity.addComponent(RIGIDBODY_2D, rb);
  entity.addComponent(CHARACTER_CONTROLLER, cc);
  return {world, entity, rb, cc};
}

function runToward(scene, system, target, frames=1) {
  for (let i=0;i<frames;i++) {
    scene.cc.requestDriveTowardX = target.x;
    scene.cc.requestDriveTowardY = target.y;
    system.updateLateCarInput(scene.world, 1/60);
  }
}

// 1) Exactly behind: autopilot must not reverse in a straight line forever.
{
  const system = new ControllerSystem();
  const scene = makeScene({rotation:0});
  const target = {x:0,y:500};
  let hadReverse = false;
  let startedTurning = false;
  let previousRotation = scene.entity.getComponent(TRANSFORM).rotation;
  for (let i=0;i<70;i++) {
    runToward(scene, system, target);
    const state = system._driveTowardManeuver.get(scene.entity.id);
    hadReverse ||= state?.mode === 'reverseAlign';
    const rot = scene.entity.getComponent(TRANSFORM).rotation;
    if (Math.abs(rot - previousRotation) > 0.01) startedTurning = true;
    previousRotation = rot;
  }
  assert(hadReverse, 'expected reverseAlign for a target directly behind the car');
  assert(startedTurning, 'expected a centered-behind target to cause a committed reverse turning arc');
  const locked = system._driveTowardManeuver.get(scene.entity.id);
  assert(locked && locked.turnSignLocked, 'expected reverse steering side to remain locked during the maneuver');
  console.log('PASS: centered-behind NPC target commits to reverse and turns instead of straight-line backing');
}

// 2) Target crosses the centerline during reverse: steering side must not flip.
{
  const system = new ControllerSystem();
  const scene = makeScene({rotation:0});
  let target = {x:0,y:500};
  let firstSign = null;
  for (let i=0;i<50;i++) {
    target = {x: i < 25 ? 2 : -2, y: 500};
    runToward(scene, system, target);
    const state = system._driveTowardManeuver.get(scene.entity.id);
    if (state?.mode === 'reverseAlign') {
      if (firstSign == null) firstSign = state.turnSign;
      assert(state.turnSign === firstSign, 'reverse steering side flipped while the target crossed the centerline');
    }
  }
  console.log('PASS: reverse steering side stays committed when target crosses the centerline');
}

// 3) Straight-ahead target must never enter the reverse maneuver.
{
  const system = new ControllerSystem();
  const scene = makeScene({rotation:0});
  const target = {x:0,y:-500};
  for (let i=0;i<120;i++) runToward(scene, system, target);
  const state = system._driveTowardManeuver.get(scene.entity.id);
  assert(state?.mode === 'forward', 'expected a straight-ahead target to remain in forward mode');
  assert((system._driveTowardReverseState.get(scene.entity.id) || false) === false, 'straight-ahead target incorrectly stayed in reverse');
  console.log('PASS: ahead-of-car target stays in forward mode');
}

console.log('\nNPC Car autopilot reverse tests passed.\n');
