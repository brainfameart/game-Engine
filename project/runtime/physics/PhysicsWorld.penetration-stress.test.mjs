import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';

function addBody(world, name, type, x, y, w=20, h=20, extra={}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({x, y}));
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({bodyType:type, ...extra}));
  e.addComponent(COLLIDER_2D, new Collider2D({shape:ColliderShape.BOX, width:w, height:h, friction:0}));
  return e;
}

const physics = new PhysicsWorld();
await physics.whenReady();

function finite(v, label) {
  if (!Number.isFinite(v)) throw new Error(`${label} became non-finite: ${v}`);
}

function runStartupOverlap(bodyType, depth, velocityX) {
  const world = new World();
  addBody(world, 'Floor', bodyType, 100, 100, 220, 20);
  const kin = addBody(world, 'Kin', BodyType.KINEMATIC, 100, 100 - depth, 20, 20, {
    velocityX, velocityY:0,
  });
  physics.clear();

  const start = kin.getComponent(TRANSFORM);
  const sx = start.x, sy = start.y;
  physics.step(world, 1/60, null);
  const first = kin.getComponent(TRANSFORM);
  const firstMove = Math.hypot(first.x - sx, first.y - sy);
  finite(first.x, 'startup x');
  finite(first.y, 'startup y');
  if (firstMove > 1.0) {
    throw new Error(`startup ${bodyType} depth=${depth} moved too far on frame 1: ${firstMove}`);
  }

  let maxFrameMove = firstMove;
  let prevX = first.x, prevY = first.y;
  for (let i=0;i<90;i++) {
    physics.step(world, 1/60, null);
    const t = kin.getComponent(TRANSFORM);
    const move = Math.hypot(t.x-prevX,t.y-prevY);
    maxFrameMove = Math.max(maxFrameMove, move);
    finite(t.x, 'startup x');
    finite(t.y, 'startup y');
    prevX=t.x; prevY=t.y;
  }
  const end = kin.getComponent(TRANSFORM);
  if (end.y < 70 || end.y > 100.5) {
    throw new Error(`startup ${bodyType} depth=${depth} escaped expected floor neighborhood: y=${end.y}`);
  }
  if (velocityX === 0 && Math.abs(end.x-100) > 0.5) {
    throw new Error(`stationary startup ${bodyType} depth=${depth} drifted: x=${end.x}`);
  }
  return {firstMove, maxFrameMove, endX:end.x, endY:end.y};
}

for (const type of [BodyType.STATIC, BodyType.KINEMATIC]) {
  for (const depth of [1, 3, 5, 10, 20]) {
    runStartupOverlap(type, depth, 0);
    runStartupOverlap(type, depth, 240);
  }
}
console.log('PASS startup-overlap matrix (Static/Kinematic floors, 1..20px overlap, stationary/moving Kinematic)');

function runWallFloorCorner(floorType, wallType, angleIndex) {
  const world = new World();
  addBody(world, 'Floor', floorType, 160, 130, 320, 20);
  addBody(world, 'Wall', wallType, 200, 70, 20, 140);

  const startX = 120 + angleIndex * 4;
  const kin = addBody(world, 'Player', BodyType.KINEMATIC, startX, 45, 20, 20, {
    velocityX: 240 + angleIndex * 20,
    velocityY: 420 + angleIndex * 10,
  });
  physics.clear();

  let maxFrameMove = 0;
  let directionChanges = 0;
  let lastDx = 0;
  let minY = Infinity, maxY = -Infinity;
  let preReverse = null;
  for (let i=0;i<100;i++) {
    const before = kin.getComponent(TRANSFORM);
    const bx=before.x, by=before.y;
    physics.step(world, 1/60, null);
    const t = kin.getComponent(TRANSFORM);
    const dx=t.x-bx, dy=t.y-by;
    const move=Math.hypot(dx,dy);
    maxFrameMove=Math.max(maxFrameMove,move);
    if (Math.abs(dx)>0.01 && Math.sign(dx)!==Math.sign(lastDx) && Math.abs(lastDx)>0.01) directionChanges++;
    if (Math.abs(dx)>0.01) lastDx=dx;
    minY=Math.min(minY,t.y); maxY=Math.max(maxY,t.y);
    finite(t.x,'corner x'); finite(t.y,'corner y');
  }
  const stuck=kin.getComponent(TRANSFORM);
  preReverse={x:stuck.x,y:stuck.y};

  // Reverse away from the corner. A stuck/penetrating controller will fail this.
  kin.getComponent(RIGIDBODY_2D).velocityX=-300;
  kin.getComponent(RIGIDBODY_2D).velocityY=0;
  for(let i=0;i<20;i++) physics.step(world,1/60,null);
  const after=kin.getComponent(TRANSFORM);
  const reverseDelta=after.x-preReverse.x;

  if (maxFrameMove > 11.0) {
    throw new Error(`corner ${floorType}/${wallType} angle=${angleIndex} TELEPORTED: maxFrameMove=${maxFrameMove}`);
  }
  if (directionChanges > 12) {
    throw new Error(`corner ${floorType}/${wallType} angle=${angleIndex} SHAKING: directionChanges=${directionChanges}`);
  }
  if (!(reverseDelta < -20)) {
    throw new Error(`corner ${floorType}/${wallType} angle=${angleIndex} remained stuck: reverseDelta=${reverseDelta}, pre=(${preReverse.x},${preReverse.y}), after=(${after.x},${after.y})`);
  }
  return {maxFrameMove,directionChanges,preReverse,after,reverseDelta,minY,maxY};
}

for (const floorType of [BodyType.STATIC, BodyType.KINEMATIC]) {
  for (const wallType of [BodyType.STATIC, BodyType.KINEMATIC]) {
    for (let angle=0; angle<8; angle++) runWallFloorCorner(floorType, wallType, angle);
  }
}
console.log('PASS wall->floor corner stress matrix (16 geometry combinations x 8 trajectories)');

// Repeated landing stress: intentionally start slightly inside the corner,
// then send the Kinematic upward/diagonal and back down. This models tiny
// frame-to-frame penetration at the perpendicular wall/floor seam.
for (const floorType of [BodyType.STATIC, BodyType.KINEMATIC]) {
  for (let run=0; run<20; run++) {
    const world=new World();
    addBody(world,'Floor',floorType,160,130,320,20);
    addBody(world,'Wall',BodyType.STATIC,200,70,20,140);
    const kin=addBody(world,'Player',BodyType.KINEMATIC,190 + (run%3), 119 + (run%2),20,20,{velocityX:(run%2?180:-180),velocityY:-360});
    physics.clear();
    let maxMove=0;
    let prev=kin.getComponent(TRANSFORM);
    let px=prev.x, py=prev.y;
    for(let i=0;i<120;i++){
      physics.step(world,1/60,null);
      const t=kin.getComponent(TRANSFORM);
      const m=Math.hypot(t.x-px,t.y-py);
      maxMove=Math.max(maxMove,m);
      finite(t.x,'landing x'); finite(t.y,'landing y');
      px=t.x; py=t.y;
    }
    const rb=kin.getComponent(RIGIDBODY_2D);
    rb.velocityX=-240; rb.velocityY=0;
    const before=kin.getComponent(TRANSFORM).x;
    for(let i=0;i<15;i++) physics.step(world,1/60,null);
    const after=kin.getComponent(TRANSFORM).x;
    if(maxMove>11.0) throw new Error(`landing stress teleported: floor=${floorType} run=${run} maxMove=${maxMove}`);
    if(!(after<before-12)) throw new Error(`landing stress stuck: floor=${floorType} run=${run} before=${before} after=${after}`);
  }
}
console.log('PASS repeated penetrating landing stress (40 runs)');
