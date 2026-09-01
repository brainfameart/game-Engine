import assert from "node:assert/strict";
import { NAV_API_OPTION_FIELDS } from "../../runtime/scripting/NavAPI.js";
import { _detectNavOptionsContext, _navOptionCompletionItems } from "./ScriptIntelliSense.js";

assert.deepEqual(Object.keys(NAV_API_OPTION_FIELDS).sort(), ["findPath", "navMoveToward"].sort());
assert.deepEqual(NAV_API_OPTION_FIELDS.findPath.map((x) => x.name), ["debug", "radius", "area"]);
assert.deepEqual(NAV_API_OPTION_FIELDS.navMoveToward.map((x) => x.name), [
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

assert.deepEqual(_navOptionCompletionItems(null, "findPath").map((x) => x.label), ["debug", "radius", "area"]);
assert.deepEqual(_navOptionCompletionItems(null, "navMoveToward").map((x) => x.label), [
  "repathInterval",
  "arriveDist",
  "finalArriveDist",
  "targetChangeDistance",
  "debug",
]);

console.log("PASS Nav API option schemas and {} autocomplete coverage");
