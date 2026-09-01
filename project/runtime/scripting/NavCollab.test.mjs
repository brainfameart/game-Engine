// NavAgent2D "collab" group-surround steering — see ScriptAPI.js's
// EntityContext._applyNavCollab() and components/NavAgent2D.js's
// collabEnabled/collabGroupRadius doc comments.
//
// Verifies:
// 1. Two collabEnabled agents converging on the SAME point are each
//    redirected to a distinct slot around it (not the identical point).
// 2. A lone collabEnabled agent (no one else converging) is left
//    pathing straight at the real target — collab is a no-op when
//    there's nothing to coordinate with.
// 3. collabEnabled=false agents are never grouped, even if their
//    targets coincide exactly with a collab agent's.
// 4. Two agents converging on merely NEARBY (not identical) points
//    within collabGroupRadius still group together.

import assert from "node:assert/strict";

globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
};

const { World } = await import("../core/World.js");
const { TRANSFORM, Transform } = await import("../components/Transform.js");
const { NAV_AGENT_2D, NavAgent2D } = await import("../components/NavAgent2D.js");
const { ScriptAPI } = await import("./ScriptAPI.js");

function makeAgent(world, api, { x = 0, y = 0, radius = 16, collabEnabled = false, collabGroupRadius = 96 } = {}) {
  const entity = world.createEntity("Agent");
  entity.addComponent(TRANSFORM, new Transform({ x, y }));
  entity.addComponent(NAV_AGENT_2D, new NavAgent2D({ radius, collabEnabled, collabGroupRadius }));
  return api.createEntityContext(entity);
}

// --- Test 1: two collab agents converging on the identical point get
// distinct slots, both offset from the raw target. ---
{
  const world = new World();
  const api = new ScriptAPI(world);
  api.time.elapsed = 10;

  const a = makeAgent(world, api, { x: -50, y: 0, collabEnabled: true });
  const b = makeAgent(world, api, { x: 50, y: 0, collabEnabled: true });
  const navA = a._entity.getComponent(NAV_AGENT_2D);
  const navB = b._entity.getComponent(NAV_AGENT_2D);

  // Frame 1: neither has published yet, so each briefly sees itself as
  // alone (one-tick lag is expected — see _applyNavCollab's doc
  // comment: grouping is based on the OTHER agent's last-published
  // goal, not omniscient same-frame knowledge).
  a._applyNavCollab(navA, 0, 0);
  b._applyNavCollab(navB, 0, 0);

  // Frame 2: both goals are now published from frame 1, so each agent
  // discovers the other and gets assigned a distinct ring slot.
  const slotA = a._applyNavCollab(navA, 0, 0);
  const slotB = b._applyNavCollab(navB, 0, 0);

  const distA = Math.hypot(slotA.x - 0, slotA.y - 0);
  const distB = Math.hypot(slotB.x - 0, slotB.y - 0);
  assert.ok(distA > 0.001, "grouped agent A should be offset from the raw target");
  assert.ok(distB > 0.001, "grouped agent B should be offset from the raw target");
  assert.ok(
    Math.hypot(slotA.x - slotB.x, slotA.y - slotB.y) > 1,
    "two grouped agents converging on the same point must get DIFFERENT slots"
  );
  console.log("PASS: two collab agents converging on the same point get distinct ring slots");
}

// --- Test 2: a lone collab agent (nobody else converging) is left
// pathing straight at the real target. ---
{
  const world = new World();
  const api = new ScriptAPI(world);
  api.time.elapsed = 10;

  const a = makeAgent(world, api, { x: 0, y: 0, collabEnabled: true });
  const navA = a._entity.getComponent(NAV_AGENT_2D);
  const slot = a._applyNavCollab(navA, 200, 300);
  assert.equal(slot.x, 200, "ungrouped collab agent keeps the raw target x");
  assert.equal(slot.y, 300, "ungrouped collab agent keeps the raw target y");
  console.log("PASS: lone collab agent with nothing to converge with is a no-op");
}

// --- Test 3: a non-collab agent never joins a group, even at the exact
// same target as a collab agent. ---
{
  const world = new World();
  const api = new ScriptAPI(world);
  api.time.elapsed = 10;

  const collabAgent = makeAgent(world, api, { x: -50, y: 0, collabEnabled: true });
  const plainAgent = makeAgent(world, api, { x: 50, y: 0, collabEnabled: false });
  const navCollab = collabAgent._entity.getComponent(NAV_AGENT_2D);
  const navPlain = plainAgent._entity.getComponent(NAV_AGENT_2D);

  collabAgent._applyNavCollab(navCollab, 0, 0);
  // plainAgent is never fed through _applyNavCollab in real usage
  // (navMoveToward only calls it when navAgent.collabEnabled is true),
  // so it never publishes a goal at all. A second tick confirms the
  // collab agent still finds no OTHER collab-enabled member and stays
  // solo, rather than silently pairing with the plain agent's position.
  const soloSlot = collabAgent._applyNavCollab(navCollab, 0, 0);
  assert.equal(soloSlot.x, 0, "collab agent with no OTHER collab-enabled member stays on the raw target");
  assert.equal(soloSlot.y, 0);
  void navPlain;
  console.log("PASS: non-collab agents never join a collab group");
}

// --- Test 4: nearby (not identical) targets within collabGroupRadius
// still group. ---
{
  const world = new World();
  const api = new ScriptAPI(world);
  api.time.elapsed = 10;

  const a = makeAgent(world, api, { x: -50, y: 0, collabEnabled: true, collabGroupRadius: 40 });
  const b = makeAgent(world, api, { x: 50, y: 0, collabEnabled: true, collabGroupRadius: 40 });
  const navA = a._entity.getComponent(NAV_AGENT_2D);
  const navB = b._entity.getComponent(NAV_AGENT_2D);

  a._applyNavCollab(navA, 0, 0);
  b._applyNavCollab(navB, 10, 0);
  // Second tick: both goals published from tick 1, now they discover
  // each other.
  a._applyNavCollab(navA, 0, 0);
  const slotB = b._applyNavCollab(navB, 10, 0); // 10px away — within the 40px group radius

  const rawDist = Math.hypot(slotB.x - 10, slotB.y - 0);
  assert.ok(rawDist > 0.001, "agent converging on a NEARBY (not identical) point still gets grouped/offset");
  console.log("PASS: agents converging on nearby (not identical) targets still group");
}

console.log("All NavAgent2D collab tests passed.");
