import assert from "node:assert/strict";
import {
  NavWorld2D,
  setNavCellArea,
  setNavAreaCost,
  getNavAreaCost,
} from "../components/NavWorld2D.js";
import { findGridPath } from "./AStar.js";
import { NavAgent2D, setNavAgentAreaCost } from "../components/NavAgent2D.js";

// --- getNavAreaCost: per-agent override wins over the world cost, per slot ---
{
  const nav = new NavWorld2D({ boundsWidth: 32, boundsHeight: 32, cellSize: 16 });
  setNavAreaCost(nav, 1, 5); // world: area 1 costs 5x
  assert.equal(getNavAreaCost(nav, 1), 5, "no agent override: world cost applies");
  assert.equal(getNavAreaCost(nav, 1, [null, 20]), 20, "agent override present: agent cost wins");
  assert.equal(getNavAreaCost(nav, 1, [null, null]), 5, "agent slot left null: falls back to world cost");
  assert.equal(getNavAreaCost(nav, 1, null), 5, "agent has no override array at all: falls back to world cost");
  assert.equal(getNavAreaCost(nav, 0, [null, 20]), 1, "an area with no world OR agent cost set stays at default 1.0");
}

// --- NavAgent2D.areaCosts constructor normalization ---
{
  const agent = new NavAgent2D({ areaCosts: [null, 3, 0, -1, "bad", 7] });
  assert.equal(agent.areaCosts.length, 16, "areaCosts is always normalized to 16 slots");
  assert.equal(agent.areaCosts[0], null);
  assert.equal(agent.areaCosts[1], 3);
  assert.equal(agent.areaCosts[2], null, "cost of 0 is invalid, normalized to null");
  assert.equal(agent.areaCosts[3], null, "negative cost is invalid, normalized to null");
  assert.equal(agent.areaCosts[4], null, "non-numeric cost is invalid, normalized to null");
  assert.equal(agent.areaCosts[5], 7);

  const agentNoOverrides = new NavAgent2D({});
  assert.equal(agentNoOverrides.areaCosts, null, "no areaCosts option at all: stays null, not an all-null array");
}

// --- setNavAgentAreaCost: lazy-allocates, clears, and collapses back to null ---
{
  const agent = new NavAgent2D({});
  assert.equal(agent.areaCosts, null);
  assert.equal(setNavAgentAreaCost(agent, 2, 5), true, "setting a cost allocates the override array");
  assert.deepEqual(agent.areaCosts[2], 5);
  assert.equal(setNavAgentAreaCost(agent, 2, 5), false, "re-setting the same value is a no-op");
  assert.equal(setNavAgentAreaCost(agent, 2, null), true, "clearing the only override");
  assert.equal(agent.areaCosts, null, "clearing the last override collapses the array back to null");
}

// --- findGridPath: two agents sharing a NavWorld2D route DIFFERENTLY when
//     one has a per-agent cost override and the other doesn't, proving the
//     override is genuinely per-agent and not silently promoted to global ---
{
  const cellSize = 16;
  // 5x5 grid, all walkable. Column 2, rows 0-3 are tagged area slot 1 (a
  // "toll road" straight across); row 4 of column 2 is left as Ground,
  // an open gap far out of the way. Crossing straight through row 0
  // (through area 1) is the shortest route; detouring down to the row-4
  // gap and back is much longer but avoids area 1 entirely.
  const nav = new NavWorld2D({
    boundsX: 0, boundsY: 0, boundsWidth: 5 * cellSize, boundsHeight: 5 * cellSize, cellSize,
  });
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      nav.cells[col + "," + row] = true;
    }
  }
  for (let row = 0; row < 4; row++) setNavCellArea(nav, 2, row, 1);
  setNavAreaCost(nav, 1, 1); // world default: area 1 is CHEAP (no reason to detour)

  const start = { col: 0, row: 0 };
  const goal = { col: 4, row: 0 };

  // Agent A: no override — uses the world's cheap cost for area 1, so it
  // should cut straight across row 0 through the middle.
  const pathNoOverride = findGridPath(nav, start.col, start.row, goal.col, goal.row, 0, 0xffff, null);
  assert.ok(pathNoOverride, "path must exist");
  const crossesArea1AtRow0 = pathNoOverride.some((p) => p.col === 2 && p.row === 0);
  assert.ok(crossesArea1AtRow0, "with no override, the agent takes the short straight route through area 1");

  // Agent B: expensive per-agent override on area 1 (cost 50) — should
  // detour around via the row-4 gap rather than cross the now-very-
  // expensive middle column, even though the WORLD's cost for area 1 is
  // still 1 (cheap) — proving the override only affects THIS agent.
  const agentCosts = new Array(16).fill(null);
  agentCosts[1] = 50;
  const pathWithOverride = findGridPath(nav, start.col, start.row, goal.col, goal.row, 0, 0xffff, agentCosts);
  assert.ok(pathWithOverride, "detour path must exist");
  const crossesArea1WithOverride = pathWithOverride.some((p) => p.col === 2 && p.row < 4);
  assert.ok(!crossesArea1WithOverride, "agent with an expensive per-agent override must detour around area 1 instead of crossing it");
  assert.ok(
    pathWithOverride.length > pathNoOverride.length,
    "the detour route must be longer (in waypoints) than the direct route"
  );

  // Confirm the world's own cost truly never changed — this is the crux
  // of "per-agent, not global": the shared NavWorld2D.areaCosts array is
  // untouched by agent B's override.
  assert.equal(getNavAreaCost(nav, 1), 1, "the shared world cost for area 1 must remain unaffected by agent B's override");
}

console.log("NavAgentAreaCostOverride.test.mjs: all assertions passed");
