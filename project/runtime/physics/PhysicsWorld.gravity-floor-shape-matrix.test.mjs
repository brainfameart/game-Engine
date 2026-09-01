import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { Collider2D, COLLIDER_2D, ColliderShape } from '../components/Collider2D.js';

const SHAPES = [ColliderShape.BOX, ColliderShape.CIRCLE, ColliderShape.CAPSULE, ColliderShape.TRIANGLE];
const shapeData = {
  [ColliderShape.BOX]: { width: 20, height: 20 },
  [ColliderShape.CIRCLE]: { radius: 10 },
  [ColliderShape.CAPSULE]: { capsuleHalfHeight: 8, capsuleRadius: 8 },
  [ColliderShape.TRIANGLE]: { trianglePoints: [ {x:-10,y:10}, {x:10,y:10}, {x:0,y:-10} ] },
};

function addBody(world, name, type, shape, x, y, extra={}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({ x, y, rotation: extra.rotation ?? 0 }));
  const { rotation, ...rbExtra } = extra;
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({
    bodyType: type,
    gravityScale: type === BodyType.DYNAMIC ? 1 : 0,
    linearDamping: 0,
    angularDamping: 0,
    lockRotation: true,
    ...rbExtra,
  }));
  e.addComponent(COLLIDER_2D, new Collider2D({ shape, friction: 0, restitution: 0, ...shapeData[shape] }));
  return e;
}

const physics = new PhysicsWorld();
await physics.whenReady();

function step(physics, world, n) { for (let i=0;i<n;i++) physics.step(world,1/60,null); }

for (const pusherShape of SHAPES) {
  for (const targetShape of SHAPES) {
    test(`gravity floor smooth push ${pusherShape}->${targetShape}`, () => {
      const world = new World();
      const floor = addBody(world,'Floor',BodyType.STATIC,ColliderShape.BOX,180,210);
      floor.getComponent(COLLIDER_2D).width = 340;
      floor.getComponent(COLLIDER_2D).height = 20;
      const pusher = addBody(world,'Pusher',BodyType.KINEMATIC,pusherShape,70,190);
      const target = addBody(world,'Target',BodyType.DYNAMIC,targetShape,110,180);
      physics.clear();

      // Let the dynamic target settle completely on the actual Static floor.
      pusher.getComponent(RIGIDBODY_2D).velocityX = 0;
      step(physics,world,120);
      const startY = target.getComponent(TRANSFORM).y;
      assert(Math.abs(target.getComponent(RIGIDBODY_2D).velocityY) < 2, 'target not settled');

      let first=null, maxGain=0, prevV=0, maxMove=0, signChanges=0, prevDx=0;
      for(let i=0;i<90;i++){
        pusher.getComponent(RIGIDBODY_2D).velocityX=180;
        const beforeX=target.getComponent(TRANSFORM).x;
        physics.step(world,1/60,null);
        const rb=target.getComponent(RIGIDBODY_2D);
        const x=target.getComponent(TRANSFORM).x;
        const dx=x-beforeX;
        if(rb.velocityX>0.01 && first===null) first=rb.velocityX;
        maxGain=Math.max(maxGain,rb.velocityX-prevV);
        maxMove=Math.max(maxMove,Math.abs(dx));
        if(Math.abs(dx)>0.01 && Math.abs(prevDx)>0.01 && Math.sign(dx)!==Math.sign(prevDx)) signChanges++;
        if(Math.abs(dx)>0.01) prevDx=dx;
        prevV=rb.velocityX;
        assert(Number.isFinite(x) && Number.isFinite(target.getComponent(TRANSFORM).y));
      }
      const end=target.getComponent(RIGIDBODY_2D);
      assert(Math.abs(target.getComponent(TRANSFORM).y-startY)<3, `vertical floor drift ${target.getComponent(TRANSFORM).y-startY}`);
      assert(first!==null, `${pusherShape}->${targetShape}: no first push`);
      assert(first<90, `${pusherShape}->${targetShape}: abrupt first push ${first}`);
      assert(maxGain<65, `${pusherShape}->${targetShape}: velocity spike ${maxGain}`);
      assert(signChanges<=1, `${pusherShape}->${targetShape}: shaking ${signChanges}`);
      assert(maxMove<8, `${pusherShape}->${targetShape}: frame teleport ${maxMove}`);
      assert(end.velocityX>100 && end.velocityX<200, `${pusherShape}->${targetShape}: poor convergence vx=${end.velocityX}`);
    });
  }
}

console.log('PASS: 16 gravity-floor shape push cases');
