import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';
import { CharacterController, CHARACTER_CONTROLLER } from '../components/CharacterController.js';

function addBody(world, name, type, x, y, w=20, h=20, extra={}) {
  const e=world.createEntity(name);
  e.addComponent(TRANSFORM,new Transform({x,y}));
  e.addComponent(RIGIDBODY_2D,new Rigidbody2D({bodyType:type,...extra}));
  e.addComponent(COLLIDER_2D,new Collider2D({shape:ColliderShape.BOX,width:w,height:h,friction:0}));
  return e;
}

const physics=new PhysicsWorld(); await physics.whenReady();

function approx(a,b,tol=1) { return Math.abs(a-b)<=tol; }

// 1) Kinematic movement behavior blocks against a static wall without a Rapier KCC.
{
  const world=new World();
  const wall=addBody(world,'Wall',BodyType.STATIC,100,50,20,200);
  const kin=addBody(world,'Kin',BodyType.KINEMATIC,50,50,20,20,{velocityX:600,velocityY:0});
  physics.clear();
  for(let i=0;i<20;i++) physics.step(world,1/60,null);
  const tf=kin.getComponent(TRANSFORM);
  const rb=kin.getComponent(RIGIDBODY_2D);
  if (!(tf.x < 80.1 && tf.x > 70)) throw new Error(`kinematic wall resolution failed: x=${tf.x}`);
  if (!physics.isColliding(kin.id, wall.id)) throw new Error('kinematic/static contact not tracked');
  if (!rb.isOnWall) throw new Error(`kinematic wall state false at x=${tf.x}`);
  console.log('PASS kinematic/static stop', {x:tf.x,grounded:rb.grounded,wall:rb.isOnWall});
}

// 2) Dynamic body cannot move a position-based kinematic body.
{
  const world=new World();
  const kin=addBody(world,'Kin',BodyType.KINEMATIC,100,50,20,20);
  const dyn=addBody(world,'Dyn',BodyType.DYNAMIC,40,50,20,20,{gravityScale:0,linearDamping:0});
  physics.clear();
  dyn.getComponent(RIGIDBODY_2D).velocityX=500;
  for(let i=0;i<30;i++) physics.step(world,1/60,null);
  const kx=kin.getComponent(TRANSFORM).x;
  if (!approx(kx,100,0.01)) throw new Error(`dynamic moved kinematic: ${kx}`);
  console.log('PASS dynamic/kinematic one-way response', {kx,dx:dyn.getComponent(TRANSFORM).x});
}

// 3) Dynamic body lands on floor; Rapier contact manifold drives grounded state.
{
  const world=new World();
  addBody(world,'Floor',BodyType.STATIC,100,100,220,20);
  const dyn=addBody(world,'Player',BodyType.DYNAMIC,100,40,20,20,{gravityScale:1,linearDamping:0});
  physics.clear();
  for(let i=0;i<120;i++) physics.step(world,1/60,null);
  const rb=dyn.getComponent(RIGIDBODY_2D);
  const y=dyn.getComponent(TRANSFORM).y;
  if (!rb.grounded) throw new Error(`dynamic grounded state false at y=${y}`);
  if (!approx(y,80,1)) throw new Error(`dynamic did not settle on floor: y=${y}`);
  if (rb.isOnCeiling) throw new Error('dynamic incorrectly classified floor as ceiling');
  console.log('PASS dynamic grounding', {y,grounded:rb.grounded,onWall:rb.isOnWall,onCeiling:rb.isOnCeiling});
}

// 3b) A Dynamic Platformer body's first jump must survive the post-step
// contact read while the old floor manifold is still present. This is the
// exact engine path that previously produced a short first jump followed by
// a full second jump. No custom controller test/mocks are involved: the
// one-shot driveVelocityY goes through the real PhysicsWorld -> Rapier step.
{
  const world=new World();
  addBody(world,'Floor',BodyType.STATIC,100,100,220,20,{gravityScale:0});
  const dyn=addBody(world,'Player',BodyType.DYNAMIC,100,60,20,20,{gravityScale:1,linearDamping:0});
  dyn.addComponent(CHARACTER_CONTROLLER,new CharacterController({controllerType:'Platformer',jumpForce:420}));
  physics.clear();
  const rb=dyn.getComponent(RIGIDBODY_2D);
  for(let i=0;i<120;i++) physics.step(world,1/60,null);
  if (!rb.grounded) throw new Error('jump regression setup did not settle on floor');
  const takeoffY=dyn.getComponent(TRANSFORM).y;
  rb.driveVelocityY=-420;
  physics.step(world,1/60,null);
  if (!(rb.velocityY < -350)) throw new Error(`first jump upward velocity was canceled: vy=${rb.velocityY}`);
  let apexY=dyn.getComponent(TRANSFORM).y;
  for(let i=0;i<36;i++){
    physics.step(world,1/60,null);
    apexY=Math.min(apexY,dyn.getComponent(TRANSFORM).y);
  }
  const rise=takeoffY-apexY;
  if (!(rise > 75 && rise < 105)) throw new Error(`first jump arc incorrect: rise=${rise}`);
  console.log('PASS dynamic first-jump full arc', {takeoffY,apexY,rise,vyAfterTakeoff:rb.velocityY});
}

// 4) Kinematic platformer-style movement has no floor/ceiling stick and clears upward motion on a ceiling.
{
  const world=new World();
  addBody(world,'Floor',BodyType.STATIC,100,130,220,20);
  addBody(world,'Ceiling',BodyType.STATIC,100,30,220,20);
  const kin=addBody(world,'Player',BodyType.KINEMATIC,100,100,20,20,{velocityX:0,velocityY:-900});
  physics.clear();
  for(let i=0;i<5;i++) physics.step(world,1/60,null);
  const rb=kin.getComponent(RIGIDBODY_2D);
  const tf=kin.getComponent(TRANSFORM);
  if (tf.y < 40-0.5) throw new Error(`kinematic passed through ceiling: y=${tf.y}`);
  if (!rb.isOnCeiling) throw new Error(`kinematic ceiling state false at y=${tf.y}`);
  if (rb.velocityY !== 0) throw new Error(`kinematic upward velocity was not cancelled on ceiling hit: vy=${rb.velocityY}`);
  rb.velocityY = 900;
  for(let i=0;i<30;i++) physics.step(world,1/60,null);
  if (kin.getComponent(TRANSFORM).y > 119.5) throw new Error(`kinematic passed through floor: y=${kin.getComponent(TRANSFORM).y}`);
  console.log('PASS kinematic ceiling/floor collision', {y:kin.getComponent(TRANSFORM).y,grounded:rb.grounded,onCeiling:rb.isOnCeiling});
}

// 5) Dynamic body collides with a kinematic body, but the dynamic body never displaces the kinematic.
{
  const world=new World();
  const kin=addBody(world,'Platform',BodyType.KINEMATIC,100,80,40,20,{velocityX:0,velocityY:0});
  const dyn=addBody(world,'Box',BodyType.DYNAMIC,50,80,20,20,{gravityScale:0,linearDamping:0});
  dyn.getComponent(RIGIDBODY_2D).velocityX=300;
  physics.clear();
  for(let i=0;i<30;i++) physics.step(world,1/60,null);
  const kx=kin.getComponent(TRANSFORM).x;
  const dx=dyn.getComponent(TRANSFORM).x;
  if (!approx(kx,100,0.01)) throw new Error(`kinematic displaced by dynamic: ${kx}`);
  if (!(dx < 100)) throw new Error(`dynamic tunneled through kinematic: ${dx}`);
  console.log('PASS kinematic/dynamic collision', {kx,dx});
}


// 8) A Kinematic body that starts already intersecting a Static collider is
// recovered GRADUALLY. The first correction must stay bounded (no teleport),
// and repeated steps must eventually restore normal movement.
{
  const world=new World();
  const floor=addBody(world,'Floor',BodyType.STATIC,100,100,220,20);
  const kin=addBody(world,'OverlappingKin',BodyType.KINEMATIC,100,100,20,20,{velocityX:120,velocityY:0});
  physics.clear();
  const startTf=kin.getComponent(TRANSFORM);
  const start={x:startTf.x,y:startTf.y};
  physics.step(world,1/60,null);
  const tf1=kin.getComponent(TRANSFORM);
  const firstStepMove=Math.hypot(tf1.x-start.x,tf1.y-start.y);
  if (!(firstStepMove <= 0.80)) {
    throw new Error(`initial overlap correction teleported: move=${firstStepMove} x=${tf1.x} y=${tf1.y}`);
  }
  const recoveredX=tf1.x;
  for(let i=0;i<40;i++) physics.step(world,1/60,null);
  const tf2=kin.getComponent(TRANSFORM);
  if (!(tf2.x > recoveredX + 20)) throw new Error(`kinematic remained stuck after gradual overlap recovery: ${recoveredX} -> ${tf2.x}`);
  if (!(Math.abs(tf2.y - 80) < 1.0)) throw new Error(`kinematic did not settle cleanly after overlap recovery: y=${tf2.y}`);
  console.log('PASS bounded initial kinematic/static overlap recovery', {firstStepMove,recoveredX,x2:tf2.x,y:tf2.y});
}

// 8b) A Kinematic body that has penetrated a floor + perpendicular wall
// corner can be recovered and then move away normally. This models a landing
// that arrives a fraction inside both surfaces instead of testing intentional
// continued movement into the wall (which should remain blocked).
{
  const world=new World();
  addBody(world,'Floor',BodyType.STATIC,140,130,280,20);
  addBody(world,'Wall',BodyType.STATIC,260,65,20,150);
  const kin=addBody(world,'CornerKin',BodyType.KINEMATIC,255,125,20,20,{velocityX:0,velocityY:0});
  physics.clear();
  const startTf=kin.getComponent(TRANSFORM);
  const start={x:startTf.x,y:startTf.y};
  physics.step(world,1/60,null);
  const recovered=kin.getComponent(TRANSFORM);
  const rb=kin.getComponent(RIGIDBODY_2D);
  const firstStepMove=Math.hypot(recovered.x-start.x,recovered.y-start.y);
  if (!(firstStepMove <= 0.80)) throw new Error(`corner recovery teleported: move=${firstStepMove}`);
  const before=recovered.x;
  rb.velocityX=-240;
  rb.velocityY=0;
  for(let i=0;i<10;i++) physics.step(world,1/60,null);
  const after=kin.getComponent(TRANSFORM).x;
  if (!(after < before - 5)) {
    throw new Error(`corner left kinematic stuck after recovery: before=${before} after=${after} resolvedVx=${rb.resolvedVelocityX}`);
  }
  console.log('PASS kinematic corner penetration recovery', {before,after,y:kin.getComponent(TRANSFORM).y,resolvedVelocityX:rb.resolvedVelocityX});
}

// 8c) A Kinematic platformer-style jump into a perpendicular wall/floor
// corner must recover from contact geometry without permanently locking the
// controller. After the corner landing, reversing horizontal input must work.
{
  const world=new World();
  addBody(world,'Floor',BodyType.STATIC,120,120,240,20);
  addBody(world,'Wall',BodyType.STATIC,180,60,20,140);
  const kin=addBody(world,'JumpCornerKin',BodyType.KINEMATIC,120,90,20,20,{velocityX:360,velocityY:-420});
  kin.addComponent(CHARACTER_CONTROLLER,new CharacterController({controllerType:'Platformer',jumpForce:420}));
  physics.clear();
  for(let i=0;i<80;i++) physics.step(world,1/60,null);
  const rb=kin.getComponent(RIGIDBODY_2D);
  const tf=kin.getComponent(TRANSFORM);
  const stuckX=tf.x;
  rb.velocityX=-240;
  rb.velocityY=0;
  for(let i=0;i<12;i++) physics.step(world,1/60,null);
  const after=kin.getComponent(TRANSFORM).x;
  if (!(after < stuckX - 5)) throw new Error(`corner jump left kinematic stuck: x=${stuckX} -> ${after}, vx=${rb.resolvedVelocityX}`);
  console.log('PASS kinematic jump wall/floor corner recovery', {stuckX,after,y:kin.getComponent(TRANSFORM).y,resolvedVelocityX:rb.resolvedVelocityX});
}

console.log('ALL PHYSICS REGRESSION TESTS PASSED');

// 6) A moving kinematic body may push a dynamic body, but the dynamic body never pushes the kinematic back.
{
  const world=new World();
  const kin=addBody(world,'Platform',BodyType.KINEMATIC,40,80,20,20,{velocityX:180,velocityY:0});
  const dyn=addBody(world,'Box',BodyType.DYNAMIC,90,80,20,20,{gravityScale:0,linearDamping:0});
  const startDynX=dyn.getComponent(TRANSFORM).x;
  physics.clear();
  let firstPushVelocity = null;
  let previousVelocity = 0;
  let maxSingleFrameVelocityGain = 0;
  for(let i=0;i<30;i++) {
    physics.step(world,1/60,null);
    const vx= dyn.getComponent(RIGIDBODY_2D).velocityX;
    if (firstPushVelocity === null && vx > 0.01) firstPushVelocity = vx;
    maxSingleFrameVelocityGain = Math.max(maxSingleFrameVelocityGain, vx - previousVelocity);
    previousVelocity = vx;
  }
  const kx=kin.getComponent(TRANSFORM).x;
  const dx=dyn.getComponent(TRANSFORM).x;
  if (kx <= 100) throw new Error(`kinematic did not move: ${kx}`);
  if (dx <= startDynX + 0.1) throw new Error(`kinematic failed to push dynamic: ${startDynX} -> ${dx}`);
  const finalPushVx = dyn.getComponent(RIGIDBODY_2D).velocityX;
  if (!(firstPushVelocity > 10 && firstPushVelocity < 50)) {
    throw new Error(`kinematic first contact still shoved at full speed: firstVx=${firstPushVelocity}`);
  }
  if (!(maxSingleFrameVelocityGain < 55)) {
    throw new Error(`kinematic push velocity changed too abruptly: maxDelta=${maxSingleFrameVelocityGain}`);
  }
  if (!(finalPushVx > 0 && finalPushVx < 180.01)) {
    throw new Error(`kinematic push did not converge normally: vx=${finalPushVx}`);
  }
  console.log('PASS smooth kinematic -> dynamic push', {kx,dx,firstPushVelocity,maxSingleFrameVelocityGain,vx:finalPushVx});
}

// 6b) A faster kinematic mover must still push a Dynamic smoothly rather
// than injecting its full speed in one physics step.
{
  const world=new World();
  const kin=addBody(world,'FastPlatform',BodyType.KINEMATIC,40,80,20,20,{velocityX:400,velocityY:0});
  const dyn=addBody(world,'FastBox',BodyType.DYNAMIC,90,80,20,20,{gravityScale:0,linearDamping:0});
  physics.clear();
  let prev=0, first=null, maxGain=0;
  for(let i=0;i<30;i++) {
    physics.step(world,1/60,null);
    const vx=dyn.getComponent(RIGIDBODY_2D).velocityX;
    if(first===null && vx>0.01) first=vx;
    maxGain=Math.max(maxGain,vx-prev);
    prev=vx;
  }
  const vx=dyn.getComponent(RIGIDBODY_2D).velocityX;
  if (!(first > 10 && first < 50)) throw new Error(`fast kinematic shove on first contact: ${first}`);
  if (!(maxGain < 55)) throw new Error(`fast kinematic shove delta too large: ${maxGain}`);
  if (!(vx > 250 && vx < 400.01)) throw new Error(`fast kinematic push did not converge: ${vx}`);
  console.log('PASS high-speed smooth kinematic -> dynamic push', {first,maxGain,vx});
}

// 7) A Dynamic movement-type body sliding against a wall keeps its vertical
// motion even at high horizontal speed. This mirrors ControllerSystem's
// driveVelocityX path instead of merely changing the component's readback
// velocity, so the test exercises the real MovementType/Platformer route.
for (const wallType of [BodyType.STATIC, BodyType.KINEMATIC]) {
  const world=new World();
  const wall=addBody(world,'Wall',wallType,100,100,20,240,{gravityScale:0,velocityX:0,velocityY:0});
  wall.getComponent(COLLIDER_2D).friction=1;
  const dyn=addBody(world,'Player',BodyType.DYNAMIC,70,40,20,20,{gravityScale:1,linearDamping:0});
  dyn.addComponent(CHARACTER_CONTROLLER,new CharacterController({controllerType:'Platformer'}));
  const rb=dyn.getComponent(RIGIDBODY_2D);
  physics.clear();
  for(let i=0;i<20;i++){
    rb.driveVelocityX=400;
    physics.step(world,1/60,null);
  }
  const tf=dyn.getComponent(TRANSFORM);
  const velX=rb.velocityX;
  const velY=rb.velocityY;
  if (!(tf.x < 90.1)) throw new Error(`dynamic platformer body passed through ${wallType} wall: x=${tf.x}`);
  if (!(velY > 300)) throw new Error(`dynamic platformer body lost vertical motion against ${wallType} wall: vy=${velY}`);
  if (Math.abs(velX) > 5) throw new Error(`dynamic wall response failed to remove blocked x motion: vx=${velX}`);
  console.log(`PASS dynamic no-wall-sticking behavior (${wallType})`, {x:tf.x,y:tf.y,vx:velX,vy:velY});
}

// 7b) A controller-driven Dynamic must not lose its gravity/fall velocity
// just because a high-speed wall impact is producing friction. This deliberately
// forces a high-friction Rapier material after collider creation to exercise the
// anti-sticking guard independently of the normal movement-material setup.
for (const speed of [300, 600, 1000, 1500]) {
  const world=new World();
  const wall=addBody(world,'Wall',BodyType.STATIC,150,200,20,500);
  wall.getComponent(COLLIDER_2D).friction=1;
  const dyn=addBody(world,'Player',BodyType.DYNAMIC,100,250,20,20,{gravityScale:1,linearDamping:0,lockRotation:true});
  dyn.addComponent(CHARACTER_CONTROLLER,new CharacterController({controllerType:'Platformer'}));
  const rb=dyn.getComponent(RIGIDBODY_2D);
  physics.clear();

  // First sync creates the Rapier colliders. Override the runtime material so
  // the test reproduces the failure mode even though Movement Type normally
  // forces the player collider to zero friction.
  rb.driveVelocityY=-600;
  physics.step(world,1/60,null);
  const dynHandle=physics._handles.get(dyn.id);
  dynHandle.collider.setFriction(1);
  dynHandle.collider.setFrictionCombineRule(physics.RAPIER.CoefficientCombineRule.Average);

  let wallHitFrame=-1;
  let vyAtHit=null;
  for(let i=0;i<60;i++) {
    rb.driveVelocityX=speed;
    physics.step(world,1/60,null);
    if(wallHitFrame<0 && rb.isOnWall) {
      wallHitFrame=i;
      vyAtHit=rb.velocityY;
    }
  }
  if (wallHitFrame < 0) throw new Error(`high-speed wall test never contacted wall at speed=${speed}`);
  // Once the body is sliding on the wall, gravity must continue changing Y
  // at the normal rate instead of collapsing toward zero as impact speed rises.
  const vyBefore=rb.velocityY;
  rb.driveVelocityX=0;
  physics.step(world,1/60,null);
  const vyAfter=rb.velocityY;
  if (!(vyAfter > vyBefore + 10)) {
    throw new Error(`wall impact stole falling velocity at speed=${speed}: vy ${vyBefore} -> ${vyAfter}`);
  }
  console.log(`PASS high-speed dynamic wall fall preservation (${speed})`, {wallHitFrame,vyAtHit,vyBefore,vyAfter});
}

// 11) A Kinematic mover pushes a free Dynamic body normally, but when that
// Dynamic reaches either a Static or Kinematic obstacle, the Kinematic mover
// must stop at the Dynamic rather than ghosting through it.
for (const wallType of [BodyType.STATIC, BodyType.KINEMATIC]) {
  const world=new World();
  addBody(world,'Wall',wallType,180,100,20,100,{gravityScale:0,velocityX:0,velocityY:0});
  const dyn=addBody(world,'Box',BodyType.DYNAMIC,140,100,20,20,{gravityScale:0,linearDamping:0});
  const kin=addBody(world,'Pusher',BodyType.KINEMATIC,100,100,20,20,{velocityX:300,velocityY:0});
  physics.clear();
  const startDynX=dyn.getComponent(TRANSFORM).x;
  for(let i=0;i<30;i++) physics.step(world,1/60,null);
  const dx=dyn.getComponent(TRANSFORM).x;
  const kx=kin.getComponent(TRANSFORM).x;
  if (!(dx > startDynX + 1)) throw new Error(`kinematic did not push Dynamic against ${wallType}: ${startDynX} -> ${dx}`);
  if (!(dx >= 159 && dx < 161)) throw new Error(`Dynamic did not settle against its ${wallType} wall: x=${dx}`);
  if (!(kx >= 139 && kx < 141)) throw new Error(`Kinematic ghosted through pinned Dynamic (${wallType}): x=${kx}`);
  console.log(`PASS kinematic stops at pinned dynamic (${wallType})`, {startDynX,dx,kx});
}

// 9) A Kinematic Character Controller must cancel upward velocity on the
// exact physics step that it hits a ceiling, then fall normally instead of
// carrying stale upward velocity into the next controller update.
{
  const world=new World();
  addBody(world,'Ceiling',BodyType.STATIC,100,30,220,20);
  const kin=addBody(world,'Character',BodyType.KINEMATIC,100,100,20,20,{velocityX:120,velocityY:-900});
  kin.addComponent(CHARACTER_CONTROLLER,new CharacterController({controllerType:'Platformer',jumpForce:420}));
  physics.clear();
  let hit=false;
  for(let i=0;i<10;i++){
    physics.step(world,1/60,null);
    const rb=kin.getComponent(RIGIDBODY_2D);
    if(rb.isOnCeiling){
      hit=true;
      if(rb.velocityY!==0) throw new Error(`character controller kept upward velocity on ceiling hit: vy=${rb.velocityY}`);
      break;
    }
  }
  if(!hit) throw new Error('character controller never registered the ceiling hit');
  const yAtHit=kin.getComponent(TRANSFORM).y;
  const xAtHit=kin.getComponent(TRANSFORM).x;
  const rbAfterHit=kin.getComponent(RIGIDBODY_2D);
  if (rbAfterHit.velocityY !== 0) throw new Error(`ceiling hit left stale upward velocity: vy=${rbAfterHit.velocityY}`);
  if (!(xAtHit > 100)) throw new Error(`ceiling hit incorrectly cancelled tangent movement: x=${xAtHit}`);
  console.log('PASS kinematic character ceiling velocity cancellation', {yAtHit,xAtHit,vy:rbAfterHit.velocityY});
}

// 8) Rotated static colliders use their real world-space normals. A long
// rotated wall must let a moving kinematic body slide along the rotated
// surface instead of projecting against the collider's local axis and
// appearing to stick.
{
  const world=new World();
  const wall=addBody(world,'RotatedWall',BodyType.STATIC,140,100,220,20,{lockRotation:true});
  wall.getComponent(TRANSFORM).rotation=45;
  const kin=addBody(world,'Kin',BodyType.KINEMATIC,70,170,20,20,{velocityX:300,velocityY:0});
  physics.clear();
  let touched=false;
  let maxResolvedSpeed=0;
  for(let i=0;i<45;i++){
    physics.step(world,1/60,null);
    touched = touched || physics.isColliding(kin.id,wall.id);
    const rbStep=kin.getComponent(RIGIDBODY_2D);
    maxResolvedSpeed=Math.max(maxResolvedSpeed,Math.hypot(rbStep.resolvedVelocityX,rbStep.resolvedVelocityY));
  }
  const tf=kin.getComponent(TRANSFORM);
  const rb=kin.getComponent(RIGIDBODY_2D);
  if (!touched) throw new Error(`rotated wall contact not tracked during sweep: x=${tf.x} y=${tf.y}`);
  if (!(tf.x > 120)) throw new Error(`kinematic did not advance toward/along rotated wall: x=${tf.x}`);
  if (maxResolvedSpeed < 10) throw new Error(`kinematic appears stuck on rotated wall: maxSpeed=${maxResolvedSpeed}`);
  console.log('PASS rotated-collider kinematic sliding', {x:tf.x,y:tf.y,vx:rb.resolvedVelocityX,vy:rb.resolvedVelocityY});
}

// 10) Rotating the MOVING kinematic body itself must not corrupt collision
// resolution. The body remains a normal Rapier position-based rigid body and
// can move against a fixed wall without an axis-aligned sticking assumption.
{
  const world=new World();
  addBody(world,'Wall',BodyType.STATIC,150,80,20,260);
  const kin=addBody(world,'RotatedKin',BodyType.KINEMATIC,60,100,120,20,{velocityX:360,velocityY:140});
  kin.getComponent(TRANSFORM).rotation=35;
  physics.clear();
  for(let i=0;i<35;i++) physics.step(world,1/60,null);
  const tf=kin.getComponent(TRANSFORM);
  const rb=kin.getComponent(RIGIDBODY_2D);
  if (!(tf.x < 150)) throw new Error(`rotated kinematic passed through wall: x=${tf.x}`);
  if (Math.hypot(rb.resolvedVelocityX,rb.resolvedVelocityY) < 10) throw new Error(`rotated kinematic got stuck: vx=${rb.resolvedVelocityX} vy=${rb.resolvedVelocityY}`);
  console.log('PASS rotated-moving-body collision', {x:tf.x,y:tf.y,vx:rb.resolvedVelocityX,vy:rb.resolvedVelocityY});
}

console.log('ALL ROTATION PHYSICS REGRESSION TESTS PASSED');

