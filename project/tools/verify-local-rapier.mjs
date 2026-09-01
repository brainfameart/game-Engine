import { loadRapier } from "../runtime/physics/RapierLoader.js";

const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("The local Rapier verification must not make a network request.");
};

try {
  const RAPIER = await loadRapier();

  const world = new RAPIER.World({ x: 0, y: 9.81 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  const collider = world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
  world.step();

  const result = {
    initialized: true,
    version: RAPIER.version(),
    bodyHandle: body.handle,
    colliderHandle: collider.handle,
    translationAfterStep: body.translation(),
  };

  if (result.version !== "0.20.0") {
    throw new Error(`Expected Rapier 0.20.0, received ${result.version}`);
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}