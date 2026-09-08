globalThis.window = { addEventListener(){}, removeEventListener(){} };
const { ControllerSystem } = await import('./project/runtime/systems/ControllerSystem.js');
const { TRANSFORM, Transform } = await import('./project/runtime/components/Transform.js');
const { RIGIDBODY_2D, Rigidbody2D, BodyType } = await import('./project/runtime/components/Rigidbody2D.js');
const { CHARACTER_CONTROLLER, CharacterController, ControllerType } = await import('./project/runtime/components/CharacterController.js');
const { World } = await import('./project/runtime/core/World.js');

function make(rotation=180, targetX=0, targetY=-600){
  const world=new World(); const e=world.createEntity('Car');
  e.addComponent(TRANSFORM,new Transform({x:0,y:0,rotation}));
  const rb=new Rigidbody2D({bodyType:BodyType.KINEMATIC,velocityX:0,velocityY:0});
  const cc=new CharacterController({controllerType:ControllerType.CAR,maxSpeed:300,carAcceleration:180,brakeForce:360,turnSpeed:120,useDefaultInput:false,driveTowardArriveDistance:12});
  e.addComponent(RIGIDBODY_2D,rb); e.addComponent(CHARACTER_CONTROLLER,cc);
  return {world,e,rb,cc,targetX,targetY};
}
function step(sc,sys,dt){
  sc.cc.requestDriveTowardX=sc.targetX; sc.cc.requestDriveTowardY=sc.targetY;
  sys.updateLateCarInput(sc.world,dt);
  const t=sc.e.getComponent(TRANSFORM);
  sc.targetY += 0; // static target
  t.x += sc.rb.velocityX*dt; t.y += sc.rb.velocityY*dt;
}
const dt=1/60; const sys=new ControllerSystem();
const sc=make(0,0, -500); // target straight ahead actually; then move car start below? target behind use +500
sc.targetY=500;
let minDist=1e9, sawReverse=false, flips=0, lastMode='';
for(let i=0;i<600;i++){
  step(sc,sys,dt);
  const st=sys._driveTowardManeuver.get(sc.e.id);
  if(st?.mode==='reverseAlign') sawReverse=true;
  if(st?.mode!==lastMode){ console.log(i, 'mode',st?.mode,'rot',sc.e.getComponent(TRANSFORM).rotation.toFixed(1),'pos',sc.e.getComponent(TRANSFORM).x.toFixed(1),sc.e.getComponent(TRANSFORM).y.toFixed(1),'speed',sys._carSpeed.get(sc.e.id).toFixed(1)); lastMode=st?.mode; }
  minDist=Math.min(minDist,Math.hypot(sc.e.getComponent(TRANSFORM).x-sc.targetX,sc.e.getComponent(TRANSFORM).y-sc.targetY));
}
console.log({sawReverse,minDist,finalPosition:sc.e.getComponent(TRANSFORM),finalSpeed:sys._carSpeed.get(sc.e.id),mode:sys._driveTowardManeuver.get(sc.e.id)});
