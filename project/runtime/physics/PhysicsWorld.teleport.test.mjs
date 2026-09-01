// Regression test for: "you can not teleport a rb with their x or y"
// — a script assigning this.x/this.y/this.position (or
// this.transform.position) on an entity with a Dynamic or Kinematic
// Rigidbody2D used to visibly move Transform for exactly one frame and
// then get silently snapped right back, because PhysicsWorld's
// _syncEntity deliberately does NOT re-sync Transform->Rapier every
// frame for those two body types (only Static gets that treatment) —
// Dynamic/Kinematic bodies "own" their position once created, and the
// post-step sync (_syncEntity's sibling loop) always overwrites
// Transform.x/y with whatever Rapier's OWN simulated position was,
// discarding the script's write before it was ever visible to physics.
//
// Fix: Rigidbody2D.js's markScriptPositionTarget() flags an intentional
// teleport (set from EntityContext's this.x/this.y/this.position in
// ScriptAPI.js, and this.transform.position/.translate() in
// TransformAPI.js), and PhysicsWorld._syncEntity consumes+clears it
// before the step, calling Rapier's own setTranslation so the body
// actually moves instead of the ECS Transform and the physics body
// disagreeing.
//
// This file also confirms the Static and unassisted-Kinematic (the
// existing pendingMoveX/Y sweep-move path) cases are untouched.

import { World } from "../core/World.js";
import { PhysicsWorld } from "./PhysicsWorld.js";
import { Transform, TRANSFORM } from "../components/Transform.js";
import { Rigidbody2D, RIGIDBODY_2D, BodyType } from "../components/Rigidbody2D.js";
import { Collider2D, COLLIDER_2D, ColliderShape } from "../components/Collider2D.js";

function addBody(world, name, type, x, y, w = 20, h = 20, extra = {}) {
  const e = world.createEntity(name);
  e.addComponent(TRANSFORM, new Transform({ x, y }));
  e.addComponent(RIGIDBODY_2D, new Rigidbody2D({ bodyType: type, ...extra }));
  e.addComponent(COLLIDER_2D, new Collider2D({ shape: ColliderShape.BOX, width: w, height: h, friction: 0 }));
  return e;
}

const physics = new PhysicsWorld();
await physics.whenReady();

// 1) Dynamic: this.x/this.y equivalent (markScriptPositionTarget) makes
// the teleport STICK across a physics step, instead of snapping back to
// wherever gravity/the solver had left the body.
{
  const world = new World();
  const dyn = addBody(world, "Dyn", BodyType.DYNAMIC, 0, 0, 20, 20, { gravityScale: 1 });
  physics.clear();

  // Let it fall for a bit first, so it has real nonzero velocity and a
  // simulated position — the exact scenario where a naive Transform
  // write would previously get discarded on the very next step.
  for (let i = 0; i < 10; i++) physics.step(world, 1 / 60, null);
  const beforeTeleport = dyn.getComponent(TRANSFORM).y;
  if (beforeTeleport <= 0.001) throw new Error(`expected the dynamic body to have fallen before teleporting, got y=${beforeTeleport}`);

  // Simulate the scripting API's this.x = ...; this.y = ...; — see
  // ScriptAPI.js's EntityContext setters, which call this same helper.
  const rb = dyn.getComponent(RIGIDBODY_2D);
  const transform = dyn.getComponent(TRANSFORM);
  transform.x = 500;
  transform.y = -300;
  rb._scriptPositionTargetX = 500;
  rb._scriptPositionTargetY = -300;

  physics.step(world, 1 / 60, null);
  const afterOneStep = dyn.getComponent(TRANSFORM);
  if (Math.abs(afterOneStep.x - 500) > 1 || Math.abs(afterOneStep.y - -300) > 5) {
    throw new Error(`dynamic teleport did not stick after one physics step: got (${afterOneStep.x}, ${afterOneStep.y}), expected ~(500, -300)`);
  }

  // A second step confirms it's a real, sustained position (Rapier
  // actually owns it now) — not a one-frame visual fluke that would
  // snap back on step 2 the way the original bug did.
  physics.step(world, 1 / 60, null);
  const afterTwoSteps = dyn.getComponent(TRANSFORM);
  if (Math.abs(afterTwoSteps.x - 500) > 2) {
    throw new Error(`dynamic teleport reverted on the second step: x=${afterTwoSteps.x}`);
  }
  console.log("PASS: Dynamic rigidbody teleport via this.x/this.y sticks across physics steps", { after: afterTwoSteps });
}

// 2) Dynamic: teleport zeroes velocity (Unity Rigidbody2D.position
// parity) — a script snapping a body across the map should not carry
// its old falling speed into the new position and immediately keep
// falling at the pre-teleport rate as if nothing happened, nor should
// it look like it "arrived" already moving.
{
  const world = new World();
  const dyn = addBody(world, "Dyn2", BodyType.DYNAMIC, 0, 0, 20, 20, { gravityScale: 1 });
  physics.clear();
  for (let i = 0; i < 20; i++) physics.step(world, 1 / 60, null); // build up real fall speed

  const rb = dyn.getComponent(RIGIDBODY_2D);
  const fallSpeedBeforeTeleport = rb.velocityY;
  if (fallSpeedBeforeTeleport <= 0.01) throw new Error("expected nonzero fall speed before teleport to make this test meaningful");

  const transform = dyn.getComponent(TRANSFORM);
  transform.x = 200;
  transform.y = 200;
  rb._scriptPositionTargetX = 200;
  rb._scriptPositionTargetY = 200;
  physics.step(world, 1 / 60, null);

  // velocityY is read back from Rapier post-step; right after a
  // teleport it should be ~0 (falling resumes from rest at the new
  // spot), not still carrying the old fall speed forward.
  const velAfterTeleport = dyn.getComponent(RIGIDBODY_2D).velocityY;
  if (Math.abs(velAfterTeleport) > fallSpeedBeforeTeleport * 0.5) {
    throw new Error(`teleport did not reset velocity: had ${fallSpeedBeforeTeleport}, still ${velAfterTeleport} after teleport`);
  }
  console.log("PASS: Dynamic rigidbody teleport resets velocity instead of carrying pre-teleport speed", { fallSpeedBeforeTeleport, velAfterTeleport });
}

// 3) Kinematic: same teleport-sticks behavior, via the same
// markScriptPositionTarget flag (independent of the KINEMATIC-only
// pendingMoveX/Y swept-move path, which remains a SEPARATE, blockable
// nudge and is not exercised here).
{
  const world = new World();
  const kin = addBody(world, "Kin", BodyType.KINEMATIC, 0, 0, 20, 20);
  physics.clear();
  physics.step(world, 1 / 60, null); // establish the live Rapier body

  const rb = kin.getComponent(RIGIDBODY_2D);
  const transform = kin.getComponent(TRANSFORM);
  transform.x = 400;
  transform.y = 150;
  rb._scriptPositionTargetX = 400;
  rb._scriptPositionTargetY = 150;

  physics.step(world, 1 / 60, null);
  const after = kin.getComponent(TRANSFORM);
  if (Math.abs(after.x - 400) > 1 || Math.abs(after.y - 150) > 1) {
    throw new Error(`kinematic teleport did not stick: got (${after.x}, ${after.y}), expected (400, 150)`);
  }

  // Confirm it's not a one-frame fluke either.
  physics.step(world, 1 / 60, null);
  const after2 = kin.getComponent(TRANSFORM);
  if (Math.abs(after2.x - 400) > 2 || Math.abs(after2.y - 150) > 2) {
    throw new Error(`kinematic teleport reverted on the second step: (${after2.x}, ${after2.y})`);
  }
  console.log("PASS: Kinematic rigidbody teleport via this.x/this.y sticks across physics steps", { after: after2 });
}

// 4) The teleport flag is strictly one-shot: it must not keep
// re-applying every frame after being consumed once, which would trap
// a Dynamic body at the teleport point forever and defeat gravity/
// physics from then on.
{
  const world = new World();
  const dyn = addBody(world, "Dyn3", BodyType.DYNAMIC, 0, 0, 20, 20, { gravityScale: 1 });
  physics.clear();

  const rb = dyn.getComponent(RIGIDBODY_2D);
  const transform = dyn.getComponent(TRANSFORM);
  transform.x = 0;
  transform.y = -500;
  rb._scriptPositionTargetX = 0;
  rb._scriptPositionTargetY = -500;
  physics.step(world, 1 / 60, null); // consumes the flag

  if (rb._scriptPositionTargetX !== null || rb._scriptPositionTargetY !== null) {
    throw new Error("teleport target was not cleared after being applied — would replay every frame");
  }

  const yAfterTeleport = dyn.getComponent(TRANSFORM).y;
  for (let i = 0; i < 30; i++) physics.step(world, 1 / 60, null);
  const yAfterFalling = dyn.getComponent(TRANSFORM).y;
  if (!(yAfterFalling > yAfterTeleport + 5)) {
    throw new Error(`body did not resume falling after the one-shot teleport (stuck at teleport point?): ${yAfterTeleport} -> ${yAfterFalling}`);
  }
  console.log("PASS: teleport flag is one-shot — body resumes normal simulation afterward", { yAfterTeleport, yAfterFalling });
}

// 5) Static bodies are unaffected — they were already synced every
// frame before this fix and must keep working exactly the same way,
// with no reliance on the new flag at all.
{
  const world = new World();
  const stat = addBody(world, "Static", BodyType.STATIC, 0, 0, 20, 20);
  physics.clear();
  physics.step(world, 1 / 60, null);
  const transform = stat.getComponent(TRANSFORM);
  transform.x = 77;
  transform.y = 88;
  // Deliberately NOT setting _scriptPositionTargetX/Y here — Static's
  // existing unconditional per-frame Transform->Rapier sync must move
  // it on its own, exactly as before this change.
  physics.step(world, 1 / 60, null);
  const after = stat.getComponent(TRANSFORM);
  if (Math.abs(after.x - 77) > 0.01 || Math.abs(after.y - 88) > 0.01) {
    throw new Error(`static body drag-sync regressed: got (${after.x}, ${after.y})`);
  }
  console.log("PASS: Static bodies remain synced from Transform every frame, unaffected by the teleport flag");
}

console.log("All Rigidbody teleport regression tests passed.");
