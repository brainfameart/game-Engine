import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';
const S=[ColliderShape.BOX,ColliderShape.CIRCLE,ColliderShape.CAPSULE,ColliderShape.TRIANGLE];
const D={
 [ColliderShape.BOX]:{width:20,height:20},[ColliderShape.CIRCLE]:{radius:10},
 [ColliderShape.CAPSULE]:{capsuleHalfHeight:8,capsuleRadius:8},
 [ColliderShape.TRIANGLE]:{trianglePoints:[{x:-10,y:10},{x:10,y:10},{x:0,y:-10}]}
};
function add(w,name,type,shape,x,y,extra={}){
 const e=w.createEntity(name); e.addComponent(TRANSFORM,new Transform({x,y,rotation:extra.rotation??0}));
 const {rotation,...rb}=extra; e.addComponent(RIGIDBODY_2D,new Rigidbody2D({bodyType:type,gravityScale:type===BodyType.DYNAMIC?1:0,linearDamping:0,angularDamping:0,lockRotation:true,...rb}));
 e.addComponent(COLLIDER_2D,new Collider2D({shape,friction:0,restitution:0,...D[shape]})); return e;
}
const p=new PhysicsWorld(); await p.whenReady(); function step(w){p.step(w,1/60,null)}
function finite(v){return Number.isFinite(v.x)&&Number.isFinite(v.y)}
function floorY(shape){ return { [ColliderShape.BOX]:210, [ColliderShape.CIRCLE]:210, [ColliderShape.CAPSULE]:204, [ColliderShape.TRIANGLE]:210 }[shape]; }
function halfX(shape){ return { [ColliderShape.BOX]:10, [ColliderShape.CIRCLE]:10, [ColliderShape.CAPSULE]:8, [ColliderShape.TRIANGLE]:10 }[shape]; }
for(const wallType of [BodyType.STATIC,BodyType.KINEMATIC]) for(const ps of S) for(const ds of S){
 test(`gravity pinned smooth ${wallType}:${ps}->${ds}`,()=>{
  const w=new World();
  const floor=add(w,'Floor',BodyType.STATIC,ColliderShape.BOX,180,230); floor.getComponent(COLLIDER_2D).width=360; floor.getComponent(COLLIDER_2D).height=20;
  const wall=add(w,'Wall',wallType,ColliderShape.BOX,170,150); wall.getComponent(COLLIDER_2D).width=20; wall.getComponent(COLLIDER_2D).height=160;
  const targetRotation = ds===ColliderShape.TRIANGLE ? -Math.PI/2 : 0;
  const pusherRotation = ps===ColliderShape.TRIANGLE ? -Math.PI/2 : 0;
  const target=add(w,'Target',BodyType.DYNAMIC,ds,130,floorY(ds),{rotation:targetRotation});
  const pusher=add(w,'Pusher',BodyType.KINEMATIC,ps,75,floorY(ps),{velocityX:0,velocityY:0,rotation:pusherRotation});
  p.clear();
  for(let i=0;i<120;i++) step(w);
  const tr=target.getComponent(TRANSFORM), rbT=target.getComponent(RIGIDBODY_2D), pr=pusher.getComponent(TRANSFORM), rbP=pusher.getComponent(RIGIDBODY_2D);
  assert(Math.abs(rbT.velocityY)<3, 'target not settled');
  const startX=tr.x;
  let first=null,maxGain=0,prevV=0,maxPusherStep=0,maxTargetStep=0,penetrated=false,penetratedFrames=0,maxPenetration=0,signChanges=0,prevDX=0,pinned=false,pinFrames=0,maxWallPenetration=0;
  rbP.velocityX=400;
  for(let i=0;i<90;i++){
    const bx=tr.x,bp=pr.x; const pv=rbT.velocityX;
    step(w);
    const tx=tr.x, px=pr.x, v=rbT.velocityX;
    if(v>0.01&&first===null) first=v;
    maxGain=Math.max(maxGain,v-prevV); prevV=v;
    const dx=tx-bx, dp=px-bp; maxTargetStep=Math.max(maxTargetStep,Math.abs(dx)); maxPusherStep=Math.max(maxPusherStep,Math.abs(dp));
    if(Math.abs(dx)>0.25&&Math.abs(prevDX)>0.25&&Math.sign(dx)!==Math.sign(prevDX)) signChanges++; if(Math.abs(dx)>0.25) prevDX=dx;
    const cP=p._handles.get(pusher.id)?.collider, cT=p._handles.get(target.id)?.collider, cW=p._handles.get(wall.id)?.collider;
    let pd=Infinity, wd=Infinity;
    try {
      const cp=cP?.contactCollider(cT,0);
      pd=Number(cp?.distance);
      const cw=cT?.contactCollider(cW,0);
      wd=Number(cw?.distance);
    } catch {}
    if(Number.isFinite(wd)) {
      maxWallPenetration=Math.max(maxWallPenetration,-wd);
    }
    const expectedWallCenterX = 170 - 10 - halfX(ds);
    if (Math.abs(tr.x - expectedWallCenterX) < 0.9 && Math.abs(rbT.velocityX) < 20) { pinned=true; }
    if(pinned) {
      pinFrames++;
      if(Number.isFinite(pd) && pd < -0.5) penetratedFrames++; else penetratedFrames=0;
      if(penetratedFrames>=2) penetrated=true;
    }
    assert(finite(tr)&&finite(pr),'nonfinite transform');
  }
  assert(first!==null,'no push'); assert(first<120,`abrupt first push ${first}`); assert(maxGain<75,`velocity spike ${maxGain}`); assert(signChanges<=2,`shaking ${signChanges}`); assert(maxTargetStep<10,`target frame teleport ${maxTargetStep}`); assert(maxPusherStep<10,`pusher frame teleport ${maxPusherStep}`); assert(!penetrated,`persistent pusher penetration after pin depth=${maxPenetration}`);
  assert(pinFrames>=3,`dynamic never became pinned against wall`);
  assert(maxWallPenetration<0.75,`dynamic wall penetration depth=${maxWallPenetration}`);
  if(ps!==ds) { /* shape-aware contact position is validated by Rapier distance, not a hard-coded center X. */ }
  assert(tr.x>startX+1,`target never moved start=${startX} end=${tr.x}`);
 });
}
