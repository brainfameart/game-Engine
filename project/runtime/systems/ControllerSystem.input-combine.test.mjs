// Regression tests for the shared default-input + scripted-input relationship.
globalThis.window = { addEventListener() {}, removeEventListener() {} };
const { ControllerSystem } = await import('./ControllerSystem.js');
const { TRANSFORM, Transform } = await import('../components/Transform.js');
const { RIGIDBODY_2D, Rigidbody2D, BodyType } = await import('../components/Rigidbody2D.js');
const { CHARACTER_CONTROLLER, CharacterController, ControllerType } = await import('../components/CharacterController.js');
const { World } = await import('../core/World.js');
function assert(c,m){if(!c)throw new Error(m)}
function scene(type, bodyType, useDefaultInput=true){
  const w=new World(), e=w.createEntity('Test');
  e.addComponent(TRANSFORM,new Transform({x:0,y:0,rotation:0}));
  const rb=new Rigidbody2D({bodyType,velocityX:0,velocityY:0});
  const cc=new CharacterController({controllerType:type,useDefaultInput,moveSpeed:200,acceleration:20});
  e.addComponent(RIGIDBODY_2D,rb); e.addComponent(CHARACTER_CONTROLLER,cc);
  return {w,e,rb,cc};
}
const cs=new ControllerSystem(), dt=1/60;

// Character Controller, Dynamic: default + script are additive.
{
 const s=scene(ControllerType.CHARACTER,BodyType.DYNAMIC,true);
 cs.input.keys.add('KeyD'); s.cc.requestMoveX=0.5; cs.update(s.w,dt);
 assert(s.rb.driveVelocityX > 0,'Character Dynamic should combine default + script movement');
 cs.input.keys.clear();
}
// Character Controller, Kinematic: same relationship.
{
 const s=scene(ControllerType.CHARACTER,BodyType.KINEMATIC,true);
 cs.input.keys.add('KeyD'); s.cc.requestMoveX=0.5; cs.update(s.w,dt);
 assert(s.rb.velocityX > 0,'Character Kinematic should combine default + script movement');
 cs.input.keys.clear();
}
// Platformer: script-only when default input is off.
{
 const s=scene(ControllerType.PLATFORMER,BodyType.KINEMATIC,false);
 cs.input.keys.add('KeyD'); s.cc.requestMoveX=0.5; cs.update(s.w,dt);
 assert(s.rb.velocityX > 0,'Platformer script input should work with default input off');
 cs.input.keys.clear();
}
// Top-Down: default + script can cancel or reinforce each other.
{
 const s=scene(ControllerType.TOP_DOWN,BodyType.KINEMATIC,true);
 cs.input.keys.add('KeyD'); s.cc.requestMoveX=-1; cs.update(s.w,dt);
 assert(Math.abs(s.rb.velocityX) < 1,'Top-Down opposite script input should combine with default input');
 cs.input.keys.clear();
}
// Patrol: default auto-walk remains active while script can add to it.
{
 const s=scene(ControllerType.PATROL,BodyType.KINEMATIC,true);
 s.cc.requestMoveX=-1; cs.update(s.w,dt);
 assert(Math.abs(s.rb.velocityX) < 1,'Patrol should allow scripted input to combine with auto-walk');
}
console.log('PASS: default input and scripted movement combine consistently across movement types');
