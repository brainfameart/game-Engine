import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';

const SHAPES = [ColliderShape.BOX, ColliderShape.CIRCLE, ColliderShape.CAPSULE, ColliderShape.TRIANGLE];
const DIMS = {
  [ColliderShape.BOX]: { width: 20, height: 20 },
  [ColliderShape.CIRCLE]: { radius: 10 },
  [ColliderShape.CAPSULE]: { capsuleHalfHeight: 8, capsuleRadius: 8 },
  [ColliderShape.TRIANGLE]: { trianglePoints: [{x:-10,y:10},{x:10,y:10},{x:0,y:-10}] },
};
function add(world, name, type, shape, x, y, extra={}) {
  const e=world.createEntity(name);
  e.addComponent(TRANSFORM,new Transform({x,y,rotation:extra.rotation??0}));
  const {rotation, ...rbExtra}=extra;
  e.addComponent(RIGIDBODY_2D,new Rigidbody2D({bodyType:type, gravityScale:type===BodyType.DYNAMIC?1:0, linearDamping:0, angularDamping:0, lockRotation:true, ...rbExtra}));
  e.addComponent(COLLIDER_2D,new Collider2D({shape, friction:0, restitution:0, ...DIMS[shape]}));
  return e;
}
function floorY(shape){ return {[ColliderShape.BOX]:210,[ColliderShape.CIRCLE]:210,[ColliderShape.CAPSULE]:204,[ColliderShape.TRIANGLE]:210}[shape]; }
const TOP_GAP = 5;
const physics=new PhysicsWorld();
await physics.whenReady();
function step(world){ physics.step(world,1/60,null); }

for (const ks of SHAPES) for (const ds of SHAPES) {
  test(`Kinematic ${ks} lands on Dynamic ${ds} top and immediately moves`,()=>{
    const w=new World();
    const floor=add(w,'Floor',BodyType.STATIC,ColliderShape.BOX,180,230); floor.getComponent(COLLIDER_2D).width=360; floor.getComponent(COLLIDER_2D).height=20;
    const targetRotation = ds===ColliderShape.TRIANGLE ? Math.PI : 0; // flat edge faces upward
    const pusherRotation = ks===ColliderShape.TRIANGLE ? 0 : 0; // flat bottom edge
    const dyn=add(w,'Dynamic',BodyType.DYNAMIC,ds,150,floorY(ds),{rotation:targetRotation});
    const kin=add(w,'Kinematic',BodyType.KINEMATIC,ks,150,140,{velocityX:0,velocityY:0,rotation:pusherRotation});
    physics.clear();
    for(let i=0;i<120;i++) step(w);
    const kr=kin.getComponent(RIGIDBODY_2D), kt=kin.getComponent(TRANSFORM), dr=dyn.getComponent(RIGIDBODY_2D), dt=dyn.getComponent(TRANSFORM);

    // Descend straight onto the Dynamic. The Dynamic is already resting on the floor.
    kr.velocityX=0; kr.velocityY=260;
    let landed=false;
    let previousY=kt.y;
    for(let i=0;i<90;i++){
      step(w);
      const dy=Math.abs(kt.y-previousY); previousY=kt.y;
      if (i>8 && Math.abs(kr.resolvedVelocityY)<5 && dy<0.25 && kt.y < dt.y-TOP_GAP) {
        landed=true; break;
      }
    }
    assert(landed,`Kinematic did not settle on Dynamic top (${ks}->${ds}); y=${kt.y}, targetY=${dt.y}, rvy=${kr.resolvedVelocityY}`);
    const landX=kt.x, landY=kt.y;
    assert(landY < dt.y-TOP_GAP,`landing was not above Dynamic (${ks}->${ds}): kY=${landY}, dY=${dt.y}`);

    // This is the bug target: moving across the Dynamic top must not glue the Kinematic.
    kr.velocityX=120; kr.velocityY=0;
    let maxStep=0; let minProgress=Infinity;
    for(let i=0;i<12;i++){
      const beforeX=kt.x;
      step(w);
      const dx=kt.x-beforeX;
      maxStep=Math.max(maxStep,Math.abs(dx));
      minProgress=Math.min(minProgress,dx);
      assert(Math.abs(dx)<10,`top-contact teleport (${ks}->${ds}) dx=${dx}`);
      assert(Math.abs(kt.y-landY)<1.0,`Kinematic vertical shake/stick correction (${ks}->${ds}) y=${kt.y} land=${landY}`);
    }
    assert(minProgress>0.5,`Kinematic stuck on Dynamic top (${ks}->${ds}); min dx=${minProgress}`);
    assert(kt.x>landX+8,`Kinematic failed to move off Dynamic top (${ks}->${ds}); x=${kt.x}`);
    assert(Math.abs(dr.velocityY)<12,`landing imparted large vertical velocity to Dynamic (${ks}->${ds}): vy=${dr.velocityY}`);
    assert(maxStep<10,`unexpected motion spike (${ks}->${ds}) max step=${maxStep}`);
  });
}

// Side-contact regression: the new top-support rule must NOT let the Kinematic pass through a Dynamic's side.
test('Kinematic horizontal side contact still blocks on Dynamic body',()=>{
  const w=new World();
  const floor=add(w,'Floor',BodyType.STATIC,ColliderShape.BOX,180,230); floor.getComponent(COLLIDER_2D).width=360; floor.getComponent(COLLIDER_2D).height=20;
  const dyn=add(w,'Dynamic',BodyType.DYNAMIC,ColliderShape.BOX,150,210);
  const kin=add(w,'Kinematic',BodyType.KINEMATIC,ColliderShape.BOX,100,210);
  physics.clear(); for(let i=0;i<120;i++) step(w);
  const kr=kin.getComponent(RIGIDBODY_2D), kt=kin.getComponent(TRANSFORM), dt=dyn.getComponent(TRANSFORM);
  kr.velocityX=120; kr.velocityY=0;
  for(let i=0;i<90;i++) step(w);
  assert(kt.x < dt.x-15+1,`Kinematic passed through Dynamic side: kX=${kt.x}, dX=${dt.x}`);
  assert(Math.abs(kt.x-(dt.x-20))<4,`Kinematic stopped at unexpected side location: kX=${kt.x}, dX=${dt.x}`);
});

console.log('PASS: 16 top-landing shape pairs + side-block regression');
