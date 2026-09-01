/**
 * runtime/components/NavAgent2D.js
 *
 * Plain data describing ONE agent's navigation settings against the
 * scene's shared NavWorld2D (see components/NavWorld2D.js). Add this
 * component to any entity that should move over the shared nav data —
 * many entities can each have their own NavAgent2D pointed at the SAME
 * NavWorld2D, with no per-agent navigation world and no per-agent bake
 * (see systems/NavWorldSystem.js's header for the full pipeline).
 *
 * Field groups mirror the requested Inspector layout, with one change
 * from the original spec — see the "Navigation" note below:
 *
 *   NAV AGENT 2D
 *   Agent
 *       Radius
 *   Movement
 *       Speed
 *       Acceleration
 *       Deceleration
 *       Stopping Distance
 *   Pathfinding
 *       Auto Repath
 *       Repath Interval
 *       Repath Distance
 *   Avoidance
 *       Enabled
 *       Priority
 *   Collaboration
 *       Enabled
 *       Group Radius
 *   Navigation
 *       Area Mask
 *
 * Deliberately 2D-only: no agent height, no 3D radius/slope/step-offset
 * fields — this is a 2D grid system, not a port of a 3D nav agent.
 *
 * IMPORTANT: this component does NOT implement movement or pathfinding
 * itself. All real path queries/erosion-by-radius go through
 * NavWorld2D's getAgentNavLayer() + pathfinding/AStar.js, wired via
 * NavWorldSystem.js — same "plain data only, systems do the work"
 * convention as Rigidbody2D/CharacterController.
 *
 * RUNTIME-ONLY FILE.
 */

export const NAV_AGENT_2D = "NavAgent2D";

export class NavAgent2D {
  constructor({
    // Agent
    radius = 16, // px clearance this agent needs from obstacles/other geometry.
                 // Belongs to the AGENT, not the shared NavWorld2D — see that
                 // component's header. Many agents with different radii can
                 // query the same baked world; a narrow passage can be
                 // walkable for a small agent and blocked for a large one.
                 //
                 // 16 is a placeholder, NOT a size this should be left at —
                 // it has no relationship to how big this entity actually
                 // is. It should be roughly this entity's own bounding
                 // radius (half-diagonal for a box), since that's the
                 // clearance the agent's own body needs from a same-sized
                 // obstacle to avoid clipping it — e.g. a 100x100 default
                 // box needs a radius of about 60-80 (half-diagonal ≈ 70.7),
                 // not the fixed default. The Inspector's "Match Collider"
                 // button on this component sets it from the entity's own
                 // Collider2D + Transform.scale automatically; see
                 // EditorEvents.js's "match-navagent-radius" action.

    // Movement
    speed = 120, // px/s top move speed
    acceleration = 800, // px/s^2 — how fast the agent speeds up toward `speed`
    deceleration = 1000, // px/s^2 — how fast the agent slows when arriving/stopping
    stoppingDistance = 1, // px from the final target that counts as arrived

    // Pathfinding
    autoRepath = true, // if true, the agent re-checks its path on a timer/on
                        // target movement automatically (see repathInterval/
                        // repathDistance below). If false, the path is only
                        // (re)computed when a script explicitly requests one.
    repathInterval = 0.35, // seconds between automatic path re-checks
    repathDistance = 4, // world units a moving target must shift before an
                         // immediate re-path is forced, independent of the timer

    // Avoidance — separate from pathfinding (see NavWorldSystem.js header:
    // "Pathfinding answers how do I get there, avoidance answers how do I
    // avoid this NPC directly in front of me"). Plain tuning data here;
    // the actual steering adjustment is applied by whichever movement
    // system reads it (e.g. ScriptAPI.navMoveToward), same division of
    // responsibility CharacterController has with ControllerSystem.
    avoidanceEnabled = true,
    avoidancePriority = 50, // 0-100. Higher-priority agents yield less to
                             // lower-priority ones when two agents' local
                             // avoidance disagrees about who moves aside.

    // Collaboration — separate from both pathfinding AND avoidance (see
    // #5 above: "how do I get there" vs "how do I avoid the NPC in front
    // of me"). This answers a third question: "when several of us are
    // converging on the SAME thing, how do we spread out around it
    // instead of stacking up on one side?" Like avoidance, this is pure
    // per-frame steering applied by whichever movement code calls
    // this.navMoveToward() — it never touches the NavWorld2D or
    // re-plans a path. See ScriptAPI.js's _applyNavCollab() for the
    // actual grouping/slotting logic and NavAgentAPI.js for the
    // script-facing this.navAgent.collabEnabled/collabGroupRadius knobs.
    collabEnabled = false, // opt-in: off by default so existing scenes/
                            // scripts behave exactly as before. Turn on
                            // per-agent for NPCs that should encircle a
                            // shared target (guards converging on an
                            // intruder, a pack surrounding prey) instead
                            // of independently pathing to the same point
                            // and shoving each other there.
    collabGroupRadius = 96, // px. Two collabEnabled agents heading toward
                             // targets within this distance of each other
                             // are treated as "going for the same thing"
                             // and are assigned separate slots around it.
                             // Larger = groups form across bigger gaps
                             // (good for open areas); smaller = only
                             // near-exact same-target convergence groups
                             // (good for tightly packed scenes).

    // Navigation — same model as Unity's NavMeshAgent.areaMask: a
    // bitmask of which NavWorld2D cell areas (Ground, Water, Mud, ...)
    // this agent is ALLOWED to path through at all — a route can never
    // cross a bit that's off here, no matter how short a shortcut it
    // would be. See components/NavWorld2D.js's NAV_AREA_COUNT and
    // editor/state/NavAreas.js for the name registry, and
    // NavWorld2D.js's `areaCosts` for the separate, SOFT per-area
    // preference (e.g. "prefer roads over mud") that applies only to
    // areas already allowed by this mask. There is deliberately no
    // separate `layer` field here — Unity's NavMeshAgent has no such
    // concept either; physics layers (Collider2D.layer/mask) and nav
    // areas are two unrelated systems, and folding one into the other
    // was the source of an earlier confusing design.
    area = 0xffff, // default: every area allowed

    // Set (transiently, for one movement step) by NavWorldSystem/ScriptAPI
    // path-following helpers to hand a fresh path to this agent without
    // NavAgent2D reaching back into the system itself — plain data, one-
    // shot per repath, same pattern as CharacterController's requestJump.
    currentPath = null,
    currentPathIndex = 0,
  } = {}) {
    this.radius = Math.max(0, radius);

    this.speed = Math.max(0, speed);
    this.acceleration = Math.max(0, acceleration);
    this.deceleration = Math.max(0, deceleration);
    this.stoppingDistance = Math.max(0, stoppingDistance);

    this.autoRepath = !!autoRepath;
    this.repathInterval = Math.max(0.05, repathInterval);
    this.repathDistance = Math.max(0, repathDistance);

    this.avoidanceEnabled = !!avoidanceEnabled;
    this.avoidancePriority = Math.max(0, Math.min(100, avoidancePriority));

    this.collabEnabled = !!collabEnabled;
    this.collabGroupRadius = Math.max(0, collabGroupRadius);

    this.area = area & 0xffff;

    this.currentPath = currentPath;
    this.currentPathIndex = currentPathIndex;
  }
}
