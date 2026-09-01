/**
 * Shared Nav API option metadata.
 *
 * This file is intentionally data-only so the runtime ScriptAPI and the
 * editor IntelliSense consume the exact same option definitions. Adding an
 * option here makes its existence visible to both the implementation docs
 * and `{ ... }` completion in the editor.
 */

export const NAV_API_OPTION_FIELDS = Object.freeze({
  findPath: Object.freeze([
    Object.freeze({
      name: "debug",
      type: "boolean",
      defaultValue: false,
      detail: "If true, draws the current path as green debug segments for one frame."
    }),
    Object.freeze({
      name: "radius",
      type: "number",
      defaultValue: 0,
      detail: "Agent clearance in world units against the shared NavWorld2D. 0 uses the base unpadded layer; a larger radius can block narrow passages a smaller agent could use."
    }),
    Object.freeze({
      name: "area",
      type: "number",
      defaultValue: 65535,
      detail: "Bitmask of allowed NavWorld2D area slots (default 0xffff, every area allowed) — same model as Unity's NavMeshAgent.areaMask. A route never crosses a cell outside this mask."
    }),
  ]),
  navMoveToward: Object.freeze([
    Object.freeze({
      name: "repathInterval",
      type: "number",
      defaultValue: 0.35,
      detail: "Seconds between path re-checks. Lower reacts faster to moving targets; higher is cheaper."
    }),
    Object.freeze({
      name: "arriveDist",
      type: "number",
      defaultValue: 4,
      detail: "Distance in world units at which an intermediate waypoint counts as reached."
    }),
    Object.freeze({
      name: "finalArriveDist",
      type: "number",
      defaultValue: 1,
      detail: "Distance from the exact final target that counts as arrived."
    }),
    Object.freeze({
      name: "targetChangeDistance",
      type: "number",
      defaultValue: 4,
      detail: "Minimum target movement that forces an immediate re-path. Default is max(4, arriveDist)."
    }),
    Object.freeze({
      name: "debug",
      type: "boolean",
      defaultValue: false,
      detail: "If true, draws the current path as green debug segments for one frame."
    }),
  ]),
});
