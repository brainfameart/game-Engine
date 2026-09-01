/**
 * runtime/scripting/CastSyntax.js
 *
 * ZenEngine scripts support an editor-only type-cast hint so autocomplete
 * can narrow an Unknown variable's type:
 *
 *   const body = enemy as DynamicBody;
 *   const obj  = enemy as (DynamicBody, Animator, AudioSource);
 *
 * `as` is NOT valid JavaScript — it's TypeScript syntax that ZenEngine
 * borrows purely for IntelliSense (see editor/scripting/ScriptTypeInference.js's
 * CAST_TARGETS / parseCastVariables, which recognize the exact same two
 * forms this file strips). It carries no runtime meaning: the cast target
 * only ever affects which autocomplete suggestions the editor offers.
 *
 * Both the compiler and the editor need the SAME stripping behavior:
 *   - runtime/systems/ScriptSystem.js calls stripCastSyntax() before
 *     handing source to `new Function()`, so `as` never reaches the real
 *     JS parser at all (it would be a hard SyntaxError otherwise — `as`
 *     isn't a JS keyword).
 *   - editor/scripting/ScriptIntelliSense.js calls it before running
 *     Monaco's live syntax check, so a cast is never flagged as a
 *     mistake while typing (see refreshScriptDiagnostics).
 *
 * This lives under /runtime (not /editor) specifically so the runtime
 * compiler can depend on it without ever reaching into /editor — see
 * RULES.txt rule #1. The editor is free to import this file too, same
 * as it imports any other runtime module.
 *
 * ENGINE FILE — used by both runtime and editor.
 */

// Matches `<expr> as Ident` — the single-cast form. Captures everything
// up to (not including) ` as Ident` so the replacement can keep the
// left-hand expression and drop only the cast itself.
const CAST_SINGLE_RX = /\bas\s+[A-Za-z_]\w*\b/g;

// Matches `as (Ident, Ident, ...)` — the multi-cast form. Kept as a
// separate pattern (rather than folding into CAST_SINGLE_RX) because the
// parenthesized target list must be consumed as a whole, including any
// internal commas/whitespace, or a trailing `)` would be left dangling
// in the output and break the real parser.
const CAST_MULTI_RX = /\bas\s*\(\s*[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*\)/g;

/**
 * Replaces every `as Type` / `as (A, B)` cast with whitespace of the
 * exact same length. This is deliberately NOT a deletion — padding with
 * spaces instead of removing the text keeps every later character at
 * the same line/column it was at in the original source, so a real
 * syntax error elsewhere in the script still reports the line the
 * author actually sees in the editor. Newlines inside a cast (rare, but
 * legal since whitespace is flexible around `as`) are preserved as
 * newlines rather than spaces, for the same reason.
 * @param {string} source
 * @returns {string} source with cast syntax blanked out, same length/line count
 */
export function stripCastSyntax(source) {
  if (typeof source !== "string" || source.indexOf(" as") === -1 && source.indexOf("\tas") === -1 && source.indexOf("\nas") === -1) {
    // Fast path: no "as" substring at all (common case — most scripts
    // never use casts) means neither regex can possibly match, so skip
    // the two full-text scans entirely.
    if (!/\bas\b/.test(source || "")) return source;
  }

  return source
    .replace(CAST_MULTI_RX, _blank)
    .replace(CAST_SINGLE_RX, _blank);
}

function _blank(match) {
  // Preserve newlines so line numbers in the blanked-out span still
  // line up; every other character becomes a space.
  let out = "";
  for (let i = 0; i < match.length; i++) {
    out += match[i] === "\n" ? "\n" : " ";
  }
  return out;
}
