import assert from "node:assert/strict";
import {
  NavWorld2D,
  setNavCellArea,
  navCellArea,
  setNavAreaCost,
  getNavAreaCost,
} from "../components/NavWorld2D.js";
import { findGridPath } from "./AStar.js";

// --- navCellArea defaults to SLOT INDEX 0 (Ground), not a bitmask value ---
{
  const nav = new NavWorld2D({ boundsWidth: 64, boundsHeight: 64, cellSize: 16 });
  assert.equal(navCellArea(nav, 0, 0), 0, "an untouched cell must default to area slot 0 (Ground)");
  assert.equal(setNavCellArea(nav, 0, 0, 3), true);
  assert.equal(navCellArea(nav, 0, 0), 3);
  // Re-setting the same value is a no-op (returns false, matches
  // setNavCellOverride's own "no-op if unchanged" convention).
  assert.equal(setNavCellArea(nav, 0, 0, 3), false);
}

// --- Area MASK is a HARD block: a route must never cross a disallowed area ---
{
  // 5-wide x 3-tall grid, all walkable. Column 2 (the middle column) is
  // tagged as area slot 1 ("Water") for every row. An agent whose mask
  // excludes bit 1 must be forced to go around — impossible here since
  // the corridor is only 3 rows tall and area 1 spans the full height,
  // so with NO alternate route the path must fail outright, proving the
  // mask is a hard filter and not just a soft cost.
  const cellSize = 16;
  const cols = 5, rows = 3;
  const cells = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells[c + "," + r] = true;
  }
  const nav = new NavWorld2D({
    boundsWidth: cols * cellSize,
    boundsHeight: rows * cellSize,
    cellSize,
    cells,
  });
  for (let r = 0; r < rows; r++) setNavCellArea(nav, 2, r, 1); // area slot 1 = "Water"

  // Full mask (default 0xffff): path exists straight across.
  const openPath = findGridPath(nav, 0, 1, 4, 1, 0, 0xffff);
  assert.ok(openPath, "with every area allowed, a straight path must exist");

  // Mask with bit 1 excluded (agent cannot enter Water at all): no path,
  // since Water spans the full height and there is no way around it.
  const maskWithoutWater = 0xffff & ~(1 << 1);
  const blockedPath = findGridPath(nav, 0, 1, 4, 1, 0, maskWithoutWater);
  assert.equal(blockedPath, null, "excluding an area from the mask must make a route through it impossible, even with no alternate route");
}

// --- Area COST is a SOFT preference: a route may still cross a costly area if there's no cheaper way, but prefers a cheaper detour when one exists ---
{
  // 5-wide x 5-tall grid. Column 2 (rows 1-3) is tagged as area slot 2
  // ("Mud") and given a high cost. Rows 0 and 4 are open ground, so a
  // route from (0,2) to (4,2) has two options: straight through the
  // mud (3 cells of high cost) or a longer detour around the top/bottom
  // through cheap ground. With mud expensive enough, A* must prefer the
  // longer-but-cheaper detour — proving cost actually influences the
  // route rather than being stored but ignored.
  const cellSize = 16;
  const cols = 5, rows = 5;
  const cells = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells[c + "," + r] = true;
  }
  const nav = new NavWorld2D({
    boundsWidth: cols * cellSize,
    boundsHeight: rows * cellSize,
    cellSize,
    cells,
    allowDiagonal: true,
  });
  for (let r = 1; r <= 3; r++) setNavCellArea(nav, 2, r, 2); // area slot 2 = "Mud", column 2 only
  assert.equal(getNavAreaCost(nav, 2), 1, "an area's cost must default to 1.0 (no preference) until explicitly set");
  assert.equal(setNavAreaCost(nav, 2, 20), true);
  assert.equal(getNavAreaCost(nav, 2), 20);

  const path = findGridPath(nav, 0, 2, 4, 2, 0, 0xffff);
  assert.ok(path, "a route must still exist through/around the costly area");
  const crossesMudColumn = path.some((p) => p.col === 2 && p.row >= 1 && p.row <= 3);
  assert.equal(crossesMudColumn, false, "with mud expensive enough, the pathfinder must prefer the longer detour around it over the shorter route through it");

  // Sanity check the OPPOSITE direction: with cost reset to 1.0 (no
  // preference), the shortest route (straight through column 2) must
  // win again, confirming the detour above was really caused by cost
  // and not some other effect of tagging the area.
  setNavAreaCost(nav, 2, 1);
  const straightPath = findGridPath(nav, 0, 2, 4, 2, 0, 0xffff);
  const crossesMudColumnNow = straightPath.some((p) => p.col === 2 && p.row === 2);
  assert.equal(crossesMudColumnNow, true, "once cost is back to 1.0, the pathfinder must go back to preferring the shortest route");
}

// --- Brush-style area painting (same disc-radius loop the O / Nav Area
// tool's _paintNavCellAtClientPos uses) tags every cell in the disc,
// and setting a DIFFERENT area later only touches the cells re-painted
// -- proving painting is per-cell, not a whole-world property ---
{
  const cellSize = 16;
  const cols = 7, rows = 7;
  const cells = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[c + "," + r] = true;
  const nav = new NavWorld2D({ boundsWidth: cols * cellSize, boundsHeight: rows * cellSize, cellSize, cells });

  // Simulate a brush of radius 1, centered on (3,3), painting area slot
  // 4. This is a DISC, not a square: r2 = 1.8225 excludes the 4 diagonal
  // corners (distance^2 = 2), leaving the center plus its 4 orthogonal
  // neighbors — 5 cells, not 9. Matches SceneViewport's own brush
  // formula, which is deliberately disc-shaped so a large brush doesn't
  // look like an obvious square stamp in the Scene view.
  const centerCol = 3, centerRow = 3, brushRadius = 1;
  const r2 = (brushRadius + 0.35) * (brushRadius + 0.35);
  let paintedCount = 0;
  for (let dr = -brushRadius; dr <= brushRadius; dr++) {
    for (let dc = -brushRadius; dc <= brushRadius; dc++) {
      if (dc * dc + dr * dr > r2) continue;
      if (setNavCellArea(nav, centerCol + dc, centerRow + dr, 4)) paintedCount++;
    }
  }
  assert.equal(paintedCount, 5, "a radius-1 disc brush must paint the center plus its 4 orthogonal neighbors (diagonals excluded by r2=1.8225), matching SceneViewport's own disc formula at that radius");
  assert.equal(navCellArea(nav, 3, 3), 4);
  assert.equal(navCellArea(nav, 2, 3), 4, "an orthogonal neighbor must be inside a radius-1 disc");
  assert.equal(navCellArea(nav, 3, 4), 4, "an orthogonal neighbor must be inside a radius-1 disc");
  assert.equal(navCellArea(nav, 2, 2), 0, "a diagonal corner must be OUTSIDE a radius-1 disc brush and stay untouched (still Ground/0)");
  // A cell far outside the brush must also be untouched.
  assert.equal(navCellArea(nav, 0, 0), 0, "cells outside the brush radius must be untouched");

  // Re-painting the SAME center cell with a different area only changes
  // that one cell -- neighbors painted by the earlier brush stroke keep
  // their own area.
  setNavCellArea(nav, 3, 3, 7);
  assert.equal(navCellArea(nav, 3, 3), 7);
  assert.equal(navCellArea(nav, 2, 3), 4, "painting one cell must not affect a neighboring cell painted by an earlier stroke");
}

console.log("PASS Nav area mask (hard block) and area cost (soft preference)");
