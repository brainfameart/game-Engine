import assert from "node:assert/strict";
import { NAV_API_OPTION_FIELDS, resolveNavAreaIndex, resolveNavAreaMask, resolveNavAreaCosts } from "../../runtime/scripting/NavAPI.js";
import { _detectNavOptionsContext, _navOptionCompletionItems, _detectStringContext, _isInsideFunctionOptArg } from "./ScriptIntelliSense.js";

assert.deepEqual(Object.keys(NAV_API_OPTION_FIELDS).sort(), ["findPath", "navMoveToward", "navDriveToward"].sort());
assert.deepEqual(NAV_API_OPTION_FIELDS.findPath.map((x) => x.name), ["debug", "radius", "area", "areaCosts"]);
assert.deepEqual(NAV_API_OPTION_FIELDS.navMoveToward.map((x) => x.name), [
  "repathInterval",
  "arriveDist",
  "finalArriveDist",
  "targetChangeDistance",
  "debug",
]);
assert.deepEqual(NAV_API_OPTION_FIELDS.navDriveToward.map((x) => x.name), [
  "repathInterval",
  "arriveDist",
  "finalArriveDist",
  "targetChangeDistance",
  "debug",
]);

assert.equal(_detectNavOptionsContext('nav.findPath(0, 0, 20, 20, {'), "findPath");
assert.equal(_detectNavOptionsContext('nav.findPath(0, 0, 20, 20, { debug: true, '), "findPath");
assert.equal(_detectNavOptionsContext('this.navMoveToward(10, 10, 80, {'), "navMoveToward");
assert.equal(_detectNavOptionsContext('this.navMoveToward(10, 10, 80, { repathInterval: 0.2, '), "navMoveToward");
assert.equal(_detectNavOptionsContext('nav.findPath(0, 0, 20, 20)'), null);

assert.deepEqual(_navOptionCompletionItems(null, "findPath").map((x) => x.label), ["debug", "radius", "area", "areaCosts"]);
assert.deepEqual(_navOptionCompletionItems(null, "navMoveToward").map((x) => x.label), [
  "repathInterval",
  "arriveDist",
  "finalArriveDist",
  "targetChangeDistance",
  "debug",
]);

// nav.areaIndex(" / nav.areaMask(" -- string-literal area-name autocomplete
assert.equal(_detectStringContext('nav.areaIndex("', 'nav.areaIndex("'), "navAreaName");
assert.equal(_detectStringContext('nav.areaIndex("Wat', 'nav.areaIndex("Wat'), "navAreaName");
assert.equal(_detectStringContext('nav.areaMask("', 'nav.areaMask("'), "navAreaName");
assert.equal(_detectStringContext('nav.areaMask("Ground", "', 'nav.areaMask("Ground", "'), "navAreaName");
assert.equal(_detectStringContext('nav.areaMask("Ground", "Road", "', 'nav.areaMask("Ground", "Road", "'), "navAreaName");
assert.equal(_detectStringContext('nav.areaIndex()', 'nav.areaIndex()'), null);

// resolveNavAreaIndex / resolveNavAreaMask -- runtime name resolution
const AREA_NAMES = ["Ground", "Water", "", "Mud"]; // slot 2 intentionally unused/empty
assert.equal(resolveNavAreaIndex(AREA_NAMES, "Ground"), 0);
assert.equal(resolveNavAreaIndex(AREA_NAMES, "water"), 1); // case-insensitive
assert.equal(resolveNavAreaIndex(AREA_NAMES, "  Mud  "), 3); // trims whitespace
assert.equal(resolveNavAreaIndex(AREA_NAMES, "Lava"), -1); // unknown name
assert.equal(resolveNavAreaIndex(null, "Ground"), -1); // no name table wired through
assert.equal(resolveNavAreaIndex(AREA_NAMES, ""), -1);

assert.equal(resolveNavAreaMask(AREA_NAMES, ["Ground", "Mud"]), (1 << 0) | (1 << 3));
assert.equal(resolveNavAreaMask(AREA_NAMES, ["Ground", "Lava"]), 1 << 0); // unknown name skipped, not corrupting the rest
assert.equal(resolveNavAreaMask(AREA_NAMES, ["Lava"]), 0); // nothing resolved -> fails closed, not "allow everything"
assert.equal(resolveNavAreaMask(null, ["Ground"]), 0);

// resolveNavAreaCosts -- named cost map -> 16-entry indexed array
{
  const costs = resolveNavAreaCosts(AREA_NAMES, { Ground: 1, Mud: 5 });
  assert.equal(costs.length, 16);
  assert.equal(costs[0], 1);   // Ground
  assert.equal(costs[1], null); // Water untouched
  assert.equal(costs[3], 5);   // Mud
  assert.equal(costs[4], null);
}
assert.deepEqual(resolveNavAreaCosts(AREA_NAMES, { Lava: 3 }).every((v) => v === null), true); // unknown name -> skipped, not thrown
assert.deepEqual(resolveNavAreaCosts(AREA_NAMES, { Ground: 0 }).every((v) => v === null), true); // non-positive cost -> skipped, not clamped
assert.deepEqual(resolveNavAreaCosts(AREA_NAMES, { Ground: -1 }).every((v) => v === null), true);
assert.deepEqual(resolveNavAreaCosts(AREA_NAMES, { Ground: "not a number" }).every((v) => v === null), true);
assert.deepEqual(resolveNavAreaCosts(null, { Ground: 1 }).every((v) => v === null), true); // no name table wired through
assert.deepEqual(resolveNavAreaCosts(AREA_NAMES, null).every((v) => v === null), true);

// nav.areaCosts({ <partial> -- cursor-inside-object-literal detection
assert.equal(_isInsideFunctionOptArg('nav.areaCosts({ ', /\bnav\s*\.\s*areaCosts\s*\(/), true);
assert.equal(_isInsideFunctionOptArg('nav.areaCosts({ Ground: 1, ', /\bnav\s*\.\s*areaCosts\s*\(/), true);
assert.equal(_isInsideFunctionOptArg('nav.areaCosts({ Ground: 1 })', /\bnav\s*\.\s*areaCosts\s*\(/), false); // call already closed
assert.equal(_isInsideFunctionOptArg('nav.areaMask("Ground", ', /\bnav\s*\.\s*areaCosts\s*\(/), false); // different call entirely

console.log("PASS Nav API option schemas, {} autocomplete, and named-area (quoted-string + areaCosts object) autocomplete/resolution coverage");
