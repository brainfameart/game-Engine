import assert from "node:assert/strict";

import { ScriptSystem } from "./ScriptSystem.js";
import { stripCastSyntax } from "../scripting/CastSyntax.js";

// _compile() doesn't touch scriptApi at all (it only builds a factory
// out of the source string) — a dummy is enough to exercise it in
// isolation, same spirit as this repo's other narrow, single-unit tests.
const sys = new ScriptSystem(/* scriptApi stub */ {});

// A cast used in an assignment — the documented, common form — must
// compile and run without throwing. Before CastSyntax.js existed, this
// was a real SyntaxError at `new Function()` time, since `as` isn't
// valid JavaScript.
{
  const factory = sys._compile(
    "CastTest",
    'var egg = "bean" as RigidBody;\nfunction onStart() { this.eggValue = egg; }'
  );
  assert.equal(typeof factory, "function", "a script using `as` must still produce a callable factory");
}

// The multi-cast form `x as (A, B)` must also compile cleanly.
{
  const factory = sys._compile(
    "CastTestMulti",
    "function onStart() {\n  const obj = this as (DynamicBody, Animator);\n  this.ran = true;\n}"
  );
  assert.equal(typeof factory, "function", "multi-cast form must still produce a callable factory");
}

// A script with NO casts at all must be byte-identical in behavior
// (stripCastSyntax is a no-op on it) — guards against the fast-path
// check in CastSyntax.js accidentally mangling ordinary scripts.
{
  const plain = 'function onUpdate(dt) { this.transform.translate(dt, 0); }';
  assert.equal(stripCastSyntax(plain), plain, "scripts without `as` must pass through unchanged");
}

// A real syntax mistake (unrelated to casting) must still fail to
// compile — proving the strip doesn't accidentally swallow genuine
// errors along with cast syntax.
{
  const factory = sys._compile("BrokenTest", "function onStart() { this.x = ; }");
  assert.equal(factory, null, "a real syntax error must still fail to compile");
}

console.log("PASS ScriptSystem `as` cast syntax compiles instead of throwing a SyntaxError");
