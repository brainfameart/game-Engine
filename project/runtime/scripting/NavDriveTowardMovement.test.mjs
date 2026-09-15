globalThis.window = { addEventListener(){}, removeEventListener(){} };
import assert from 'node:assert/strict';
import { World } from '../core/World.js';
import { Transform, TRANSFORM } from '../components/Transform.js';
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from '../components/Rigidbody2D.js';
import { CharacterController, CHARACTER_CONTROLLER, ControllerType } from '../components/CharacterController.js';
import { NavAgent2D, NAV_AGENT_2D } from '../components/NavAgent2D.js';
import { NavWorld2D, NAV_WORLD_2D } from '../components/NavWorld2D.js';
import { NavWorldSystem } from '../systems/NavWorldSystem.js';
import { ControllerSystem } from '../systems/ControllerSystem.js';
import { ScriptAPI } from './ScriptAPI.js';

const world = new World();
const navEntity = world.createEntity('NavWorld');
navEntity.addComponent(TRANSFORM, new Transform({x:0,y:0}));
const cells = {};
for (let y=0;y<8;y++) for (let x=0;x<16;x++) cells[`${x},${y}`]=true;
navEntity.addComponent(NAV_WORLD_2D, new NavWorld2D({boundsX:0,boundsY:0,boundsWidth:256,boundsHeight:128,cellSize:16,cells,allowDiagonal:true}));
const navSystem = new NavWorldSystem(); navSystem.update(world);
const car = world.createEntity('NavCar');
car.addComponent(TRANSFORM, new Transform({x:24,y:40,rotation:0}));
car.addComponent(RIGIDBODY_2D, new Rigidbody2D({bodyType:BodyType.KINEMATIC}));
car.addComponent(CHARACTER_CONTROLLER, new CharacterController({controllerType:ControllerType.CAR,useDefaultInput:false,maxSpeed:220,carAcceleration:180,brakeForce:360,turnSpeed:120,driftFactor:.9}));
car.addComponent(NAV_AGENT_2D, new NavAgent2D({radius:4,speed:120,area:0xffff}));
const api = new ScriptAPI(world); api.time.deltaTime=1/60;
api._navFindPathFn=(x1,y1,x2,y2,r,a,c)=>navSystem.findPath(navEntity,x1,y1,x2,y2,r,a,c);
api._navIsWalkableForAgentFn=(x,y,r,a,c)=>navSystem.isWalkableForAgent(navEntity,x,y,r,a,c);
api._navNearestWalkableFn=(x,y,r,a,m,c)=>navSystem.nearestWalkablePointForAgent(navEntity,x,y,r,m,a,c);
const ctx=api.createEntityContext(car); const controllerSystem=new ControllerSystem();
let maxSpeed=0;
for(let i=0;i<30;i++){
  api.time.elapsed=i/60;
  const active=ctx.navDriveToward(200,40,120);
  assert.equal(active,true);
  controllerSystem.updateLateCarInput(world,1/60);
  maxSpeed=Math.max(maxSpeed,Math.abs(controllerSystem._carSpeed.get(car.id)||0));
}
assert.ok(maxSpeed>1,'navDriveToward submitted no usable drive input from rest');
console.log('PASS navDriveToward produces actual non-zero car drive from rest');
