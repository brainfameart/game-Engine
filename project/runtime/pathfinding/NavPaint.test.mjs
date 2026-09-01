import assert from "node:assert/strict";
import { NavWorld2D, setNavCellOverride, clearNavCellOverride, setNavCellArea, clearNavCellArea, navCellArea } from "../components/NavWorld2D.js";

const nav = new NavWorld2D({ boundsWidth: 64, boundsHeight: 64, cellSize: 16, cells: { "1,1": true, "2,2": false } });
assert.equal(nav.bakedCells["1,1"], true);
assert.equal(nav.cells["1,1"], true);

assert.equal(setNavCellOverride(nav, 1, 1, false), true);
assert.equal(nav.cells["1,1"], false);
assert.equal(nav.paintOverrides["1,1"], false);

assert.equal(setNavCellOverride(nav, 2, 2, true), true);
assert.equal(nav.cells["2,2"], true);

assert.equal(clearNavCellOverride(nav, 1, 1), true);
assert.equal(nav.cells["1,1"], true);
assert.equal(clearNavCellOverride(nav, 2, 2), true);
assert.equal(nav.cells["2,2"], false);

assert.equal(setNavCellOverride(nav, 3, 3, true), true);
assert.equal(nav.cells["3,3"], true);
assert.equal(clearNavCellOverride(nav, 3, 3), true);
assert.equal(nav.cells["3,3"], undefined);

console.log("PASS NavWorld2D walkable/blocked/erase override semantics");

// Area tag paint/erase — orthogonal to walkable/blocked above: setting
// or clearing a cell's area must never touch its cells/paintOverrides,
// and clearing an untagged cell's area is a no-op (matches
// clearNavCellOverride's "no override present" no-op behavior).
const navArea = new NavWorld2D({ boundsWidth: 64, boundsHeight: 64, cellSize: 16 });
assert.equal(navCellArea(navArea, 1, 1), 0); // untagged defaults to Ground (0)

assert.equal(setNavCellArea(navArea, 1, 1, 3), true);
assert.equal(navCellArea(navArea, 1, 1), 3);

// Setting the same area again reports no change.
assert.equal(setNavCellArea(navArea, 1, 1, 3), false);

// Painting a walkable override on the same cell doesn't disturb its area.
assert.equal(setNavCellOverride(navArea, 1, 1, true), true);
assert.equal(navCellArea(navArea, 1, 1), 3);

// Erasing the area tag reverts to Ground and doesn't touch walkable state.
assert.equal(clearNavCellArea(navArea, 1, 1), true);
assert.equal(navCellArea(navArea, 1, 1), 0);
assert.equal(navArea.cells["1,1"], true);

// Erasing an already-untagged cell is a no-op.
assert.equal(clearNavCellArea(navArea, 5, 5), false);

console.log("PASS NavWorld2D area tag paint/erase semantics");
