/**
 * runtime/scripting/ScriptAPI.js
 *
 * The safe sandbox API exposed to user game scripts. Scripts NEVER touch
 * World/Entity classes, browser globals (document, window, localStorage),
 * or any unrestricted object — they go through this API only.
 *
 * Two layers:
 *  1. Globals passed as function parameters to each compiled script:
 *     find(), scene, physics, input, time, random, mathx, global
 *  2. EntityContext — the `this` binding inside lifecycle functions:
 *     this.x, this.y, this.transform, this.sprite, this.rigidbody, etc.
 *
 * Property access uses getters/setters that read/write LIVE component
 * data, so a script doing `this.x = 100` immediately moves the entity
 * and `this.rigidbody.velocity` always reflects the physics body's
 * real velocity.
 *
 * ONE API PER CAPABILITY: this.x/y/position/rotation/scaleX/scaleY/
 * translate/visible/enabled are flat shortcuts (Transform has only one
 * shape, and other.x/other.y is the documented pattern inside
 * onCollision(other)/onTriggerEnter(other)). Everything else —
 * velocity, physics forces, sprite properties, animation, camera,
 * audio, movement-type tunables (jump/car/follow settings) — is
 * reached ONLY through its sub-object (this.rigidbody.*, this.sprite.*,
 * this.shape.*, this.animator.*, this.camera.*, this.audio.*, this.controller.*).
 * There is deliberately no this.velocityX / this.addForce() / this.
 * texture / this.isOnGround flat-shortcut duplicate of these:
 * RigidbodyAPI.js exposes a DIFFERENT shape per Rigidbody2D.bodyType
 * (Dynamic/Kinematic/Static), and ControllerAPI.js exposes a DIFFERENT
 * shape per CharacterController.controllerType (Character/Platformer/
 * Top-Down/Car/Follow/Free) — a second flat copy of either would have
 * to duplicate that per-type logic or drift out of sync with it, two
 * ways to do the same thing that could behave differently from each
 * other. See scripting/components/RigidbodyAPI.js and ControllerAPI.js.
 *
 * Each `this.<subobject>` (transform, sprite, rigidbody, animator,
 * camera, audio, controller) is built by its OWN file under
 * scripting/components/, not inlined here — that folder is where new
 * scripting components get added as the API grows (RULES.txt
 * scripting/ folder convention), keeping this file focused on wiring
 * rather than growing without bound.
 *
 * RUNTIME-ONLY FILE.
 */

import { TRANSFORM } from "../components/Transform.js";
import { SCRIPT } from "../components/Script.js";
import { COLLIDER_2D } from "../components/Collider2D.js";
import { SPRITE_RENDERER } from "../components/SpriteRenderer.js";
import { SHAPE_RENDERER } from "../components/ShapeRenderer.js";
import { TEXT_RENDERER } from "../components/TextRenderer.js";
import { SPEECH_BUBBLE } from "../components/SpeechBubble.js";
import { CHAT_LOG } from "../components/ChatLog.js";
import { TEXT_INPUT } from "../components/TextInput.js";
import { JOYSTICK } from "../components/Joystick.js";
import { RIGIDBODY_2D, markScriptPositionTarget } from "../components/Rigidbody2D.js";
import { SPRITE_ANIMATION } from "../components/SpriteAnimation.js";
import { CAMERA } from "../components/Camera.js";
import { AUDIO_SOURCE } from "../components/AudioSource.js";
import { AUDIO_LISTENER } from "../components/AudioListener.js";
import { NAV_AGENT_2D } from "../components/NavAgent2D.js";
import { CHARACTER_CONTROLLER } from "../components/CharacterController.js";
import { cloneEntity } from "../scene/SceneSerializer.js";
import { createTransformAPI } from "./components/TransformAPI.js";
import { createSpriteAPI } from "./components/SpriteAPI.js";
import { createShapeAPI } from "./components/ShapeAPI.js";
import { createTextAPI } from "./components/TextAPI.js";
import { createSpeechBubbleAPI } from "./components/SpeechBubbleAPI.js";
import { createChatLogAPI } from "./components/ChatLogAPI.js";
import { createTextInputAPI } from "./components/TextInputAPI.js";
import { createJoystickAPI } from "./components/JoystickAPI.js";
import { createRigidbodyAPI } from "./components/RigidbodyAPI.js";
import { createAnimatorAPI } from "./components/AnimatorAPI.js";
import { createCameraAPI } from "./components/CameraAPI.js";
import { createAudioAPI } from "./components/AudioAPI.js";
import { createAudioListenerAPI } from "./components/AudioListenerAPI.js";
import { createControllerAPI } from "./components/ControllerAPI.js";
import { createColliderAPI } from "./components/ColliderAPI.js";
import { createNavAgentAPI } from "./components/NavAgentAPI.js";
import { LIGHT } from "../components/Light.js";
import { createLightAPI } from "./components/LightAPI.js";
import { createStateAPI } from "./components/StateAPI.js";
import { createTouchTrackAPI } from "./components/TouchTrackAPI.js";
import { createSaveAPI } from "./components/SaveAPI.js";
import { SaveStore } from "./SaveStore.js";

import { NAV_API_OPTION_FIELDS } from "./NavAPI.js";
/**
 * The `this` context inside a user script. All property access reads
 * from / writes to the entity's live components.
 */
class EntityContext {
  constructor(entity, world, scriptApi) {
    this._entity = entity;
    this._world = world;
    this._scriptApi = scriptApi;
    // Set to true ONLY on the context handed to a freshly-spawned
    // entity's OWN script instances (see ScriptSystem
    // ._initEntityScripts()) — false for every entity that came from
    // the scene file itself, and false for every OTHER context this same
    // clone hands out later (e.g. `other` inside onCollision) even
    // though contexts are cached per-entity-id, since this flag is set
    // once right after creation and never toggled again. Mirrors
    // Unity's own convention of tagging runtime-Instantiate()'d copies.
    this._isClone = false;
    this._buildSubObjects();
  }

  // Raycasting is handled entirely by Rapier now (PhysicsWorld.castRay,
  // wired through _physicsRaycastFn — see runtime/index.js and _raycast()
  // below). The old _getColliderAABB() box-fit approximation used to back
  // a manual raycast path here; it's gone because Rapier's real shape
  // query is both more accurate (correct on circle/capsule/triangle/
  // polygon colliders, not just their bounding boxes) and cheaper (no
  // extra object allocated/discarded per raycast call, no redundant
  // shape math duplicating what Rapier already computes internally).

  // --- Shortcut aliases (read/write live Transform data) ---

  get x() { const t = this._entity.getComponent(TRANSFORM); return t ? t.x : 0; }
  set x(v) {
    const t = this._entity.getComponent(TRANSFORM);
    if (!t) return;
    t.x = v;
    // See Rigidbody2D.js's markScriptPositionTarget doc comment: a
    // Dynamic/Kinematic body owns its own position once created, so a
    // bare Transform write here would otherwise get silently
    // overwritten by PhysicsWorld's next post-step sync instead of
    // actually teleporting the body.
    markScriptPositionTarget(this._entity, t.x, t.y);
  }

  get y() { const t = this._entity.getComponent(TRANSFORM); return t ? t.y : 0; }
  set y(v) {
    const t = this._entity.getComponent(TRANSFORM);
    if (!t) return;
    t.y = v;
    markScriptPositionTarget(this._entity, t.x, t.y);
  }

  // position as an { x, y } object — mirrors this.transform.position
  get position() { const t = this._entity.getComponent(TRANSFORM); return t ? { x: t.x, y: t.y } : { x: 0, y: 0 }; }
  set position(v) {
    const t = this._entity.getComponent(TRANSFORM);
    if (!t) return;
    // NOTE: was previously `t.position = v`, which did nothing —
    // Transform (components/Transform.js) has no `position` field at
    // all, only x/y, so that write silently created an unused ad-hoc
    // property instead of actually moving the entity. this.position =
    // {...} was a no-op bug before this fix, independent of the
    // Rigidbody teleport issue markScriptPositionTarget addresses below.
    t.x = v.x;
    t.y = v.y;
    markScriptPositionTarget(this._entity, t.x, t.y);
  }

  // translate — move by a delta amount this frame
  translate(dx, dy) {
    const t = this._entity.getComponent(TRANSFORM);
    if (!t) return;
    t.translate(dx, dy);
    // A relative nudge is just as much an intentional teleport as an
    // absolute assignment from the physics body's point of view — both
    // need Rapier's translation moved to match, or the same
    // next-step-overwrite bug applies.
    markScriptPositionTarget(this._entity, t.x, t.y);
  }

  /**
   * One-line NavWorld2D-following movement: paths to (targetX,targetY)
   * via nav.findPath() and advances this entity ONE STEP along that
   * path every call — call it once per onUpdate() and it does
   * everything SmartChaseNPC.js used to hand-roll manually (caching the
   * path, re-pathing on a timer, walking waypoint by waypoint, picking
   * rigidbody-vs-direct-transform movement):
   *
   *   this.navMoveToward(target.x, target.y, 120);
   *
   * If this entity has a NavAgent2D component (Add Component > Nav
   * Agent 2D), its Radius, Speed, Auto Repath, Repath Interval, Repath
   * Distance, and Stopping Distance settings are used as the defaults
   * for every argument/opts field below — Radius in particular is what
   * makes the path actually respect THIS agent's size against the
   * scene's shared NavWorld2D (see components/NavAgent2D.js and the
   * architecture doc atop systems/NavWorldSystem.js). An explicit
   * `speed` argument or `opts` field always overrides the component's
   * value for that one call. An entity with no NavAgent2D still works
   * exactly as before, using radius 0 (the base unpadded layer) and the
   * literal defaults listed below.
   *
   * DELIBERATELY HAS NO "no path found" straight-line fallback — that
   * fallback is exactly what let an agent visibly walk straight through
   * a blocked NavWorld2D cell (a direct line ignores the world
   * entirely). If no route exists yet (NavWorld2D not baked, or the
   * goal truly unreachable), this holds position and returns false
   * rather than cutting through geometry, so "respects the not-walkable
   * zone" is true by construction, not just by convention.
   *
   * @param {number} targetX @param {number} targetY world-space goal
   * @param {number} [speed] px/sec — defaults to this entity's
   *   NavAgent2D.speed if present, otherwise 120.
   * @param {{ repathInterval?: number, arriveDist?: number, finalArriveDist?: number, targetChangeDistance?: number, debug?: boolean }} [opts]
   *   repathInterval: seconds between path re-checks (default:
   *     NavAgent2D.repathInterval if present, else 0.35). A shorter
   *     interval reacts faster to moving targets; a longer one is
   *     cheaper for a stable target. Ignored (no automatic re-path)
   *     when NavAgent2D.autoRepath is explicitly false.
   *   arriveDist: px distance from an intermediate waypoint that counts
   *     as reached (default 4). The final target uses finalArriveDist.
   *   finalArriveDist: px distance from the actual target that counts as
   *     arrived (default: NavAgent2D.stoppingDistance if present, else 1).
   *   targetChangeDistance: re-path immediately when a moving target
   *     shifts this far (default: NavAgent2D.repathDistance if present,
   *     else max(4, arriveDist)).
   *   debug: draws the current path as green segments, same visual
   *     language as nav.findPath(...,{debug:true}).
   * The options are defined by NAV_API_OPTION_FIELDS.navMoveToward, which
   * is also consumed by editor IntelliSense for `{ ... }` completion.
   * @returns {boolean} true if it moved this call, false if no path to
   *   the target exists right now (already-arrived also returns true).
   */
  navMoveToward(targetX, targetY, speed, opts) {
    opts = opts || {};
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;
    var navAgent = this._entity.getComponent(NAV_AGENT_2D);

    // Collaboration: when several collabEnabled agents are all heading
    // toward roughly the same point, redirect EACH agent to its own
    // slot on a ring around that point instead of all of them pathing
    // straight to the identical (targetX,targetY) — see
    // _applyNavCollab()'s doc comment for the full "smart NPC surround"
    // rationale. Done here, BEFORE any path is planned, deliberately —
    // unlike avoidance (which only bends the per-frame move direction),
    // this changes the actual PATHING GOAL, so A* routes each agent
    // around obstacles toward ITS OWN side of the target rather than
    // toward the same point and then fighting over the last few pixels.
    if (navAgent && navAgent.collabEnabled) {
      var slot = this._applyNavCollab(navAgent, targetX, targetY);
      targetX = slot.x;
      targetY = slot.y;
    }

    speed = Number.isFinite(speed) ? Math.max(0, speed) : (navAgent ? navAgent.speed : 120);
    var dt = Math.max(0, this._scriptApi.time.deltaTime || 0);
    var autoRepath = navAgent ? navAgent.autoRepath : true;
    var repathInterval = opts.repathInterval !== undefined
      ? Math.max(0.05, opts.repathInterval)
      : Math.max(0.05, navAgent ? navAgent.repathInterval : 0.35);
    var arriveDist = opts.arriveDist === undefined ? 4 : Math.max(0.01, opts.arriveDist);
    var finalArriveDist = opts.finalArriveDist !== undefined
      ? Math.max(0.01, opts.finalArriveDist)
      : Math.max(0.01, navAgent ? navAgent.stoppingDistance : 1);
    var targetChangeDistance = opts.targetChangeDistance !== undefined
      ? Math.max(0.01, opts.targetChangeDistance)
      : Math.max(navAgent ? navAgent.repathDistance : 4, arriveDist);
    var agentRadius = navAgent ? navAgent.radius : 0;
    var agentArea = navAgent ? navAgent.area : 0xffff;
    var body = this.rigidbody;
    var canUseBody = body && body.type !== "Static";

    if (!this._navMoveState) {
      this._navMoveState = { path: null, index: 0, repathTimer: 0, goalX: 0, goalY: 0 };
    }
    var state = this._navMoveState;
    state.repathTimer -= dt;
    var targetMoved = state.path && Math.hypot(targetX - state.goalX, targetY - state.goalY) > targetChangeDistance;

    // With autoRepath off, only (re)plan once (no path yet) or when the
    // target itself moved far enough to invalidate the current route —
    // never on the timer. A script can still force a fresh plan any
    // time by clearing state.path indirectly (calling with a new
    // target far enough away counts) or via nav.findPath() directly.
    var shouldRepath = !state.path || targetMoved || (autoRepath && state.repathTimer <= 0);

    if (shouldRepath) {
      state.repathTimer = repathInterval;
      var freshPath = this._scriptApi._findNavPath(this.x, this.y, targetX, targetY, { debug: opts.debug, radius: agentRadius, area: agentArea });
      if (!freshPath || freshPath.length === 0) {
        state.path = null;
        state.index = 0;
        if (canUseBody) body.velocity = { x: 0, y: 0 };
        return false;
      }
      state.path = freshPath;
      state.index = 0;
      state.goalX = targetX;
      state.goalY = targetY;
    }

    var path = state.path;
    var lastIndex = path.length - 1;
    var waypoint = path[state.index];
    var distance = Math.hypot(waypoint.x - this.x, waypoint.y - this.y);

    // Consume already-reached points in one call. Rigidbody movement can
    // land a little past a point between script updates; without this the
    // next frame briefly steers backwards and produces corner jitter.
    var waypointThreshold = canUseBody ? Math.max(arriveDist, speed * dt + 0.25) : 0.001;
    while (state.index < lastIndex && distance <= waypointThreshold) {
      state.index++;
      waypoint = path[state.index];
      distance = Math.hypot(waypoint.x - this.x, waypoint.y - this.y);
    }

    if (state.index === lastIndex && distance <= finalArriveDist) {
      if (!canUseBody) {
        // Direct-transform agents can finish exactly; this fixes the old
        // "same NavWorld2D cell means already there" inaccuracy.
        this.x = waypoint.x;
        this.y = waypoint.y;
      } else {
        body.velocity = { x: 0, y: 0 };
      }
      return true;
    }

    if (canUseBody) {
      if (speed <= 0 || distance <= 0.000001) {
        body.velocity = { x: 0, y: 0 };
        return false;
      }
      var dirX = (waypoint.x - this.x) / distance;
      var dirY = (waypoint.y - this.y) / distance;
      var steered = this._applyNavAvoidance(navAgent, agentRadius, dirX, dirY);
      body.velocity = { x: steered.x * speed, y: steered.y * speed };
      return true;
    }

    if (body && body.type === "Static") return false;
    if (speed <= 0 || dt <= 0) return false;

    // A direct-transform agent uses its entire frame budget without ever
    // stepping beyond a waypoint. This prevents high-speed agents from
    // oscillating on opposite sides of a turn, and lets them cross more
    // than one tiny path segment in a slow frame without pausing.
    var remaining = speed * dt;
    var moved = false;
    while (remaining > 0) {
      waypoint = path[state.index];
      var dx = waypoint.x - this.x;
      var dy = waypoint.y - this.y;
      distance = Math.hypot(dx, dy);
      var threshold = state.index === lastIndex ? finalArriveDist : 0.001;

      if (distance <= threshold) {
        if (state.index === lastIndex) {
          this.x = waypoint.x;
          this.y = waypoint.y;
          return true;
        }
        state.index++;
        continue;
      }

      var step = Math.min(remaining, distance);
      var stepDir = this._applyNavAvoidance(navAgent, agentRadius, dx / distance, dy / distance);
      this.x += stepDir.x * step;
      this.y += stepDir.y * step;
      remaining -= step;
      moved = true;

      if (step >= distance - 0.000001) {
        if (state.index === lastIndex) {
          this.x = waypoint.x;
          this.y = waypoint.y;
          return true;
        }
        state.index++;
      }
    }
    return moved;
  }

  /**
   * Local avoidance steering consumed ONLY by navMoveToward() — see the
   * "Pathfinding and local avoidance are SEPARATE concerns" note atop
   * systems/NavWorldSystem.js. This never re-plans a path or touches
   * NavWorld2D; it just bends the per-frame move direction away from
   * other nearby NavAgent2D entities so two agents crossing paths slide
   * past each other instead of overlapping.
   *
   * Skipped entirely (returns dirX/dirY unchanged) when this agent has
   * no NavAgent2D, or when navAgent.avoidanceEnabled is false — that's
   * the documented way to turn avoidance off per-agent, e.g.
   * `this.navAgent.avoidanceEnabled = false` to let an agent shove
   * through a crowd during a scripted moment.
   *
   * For every OTHER active NavAgent2D within combined-radius range,
   * this agent yields ground in proportion to the OTHER agent's
   * avoidancePriority relative to the sum of both priorities — a
   * higher-priority agent barely bends off course, a lower-priority one
   * bends hard, and two equal-priority agents split the difference
   * (each nudges ~50%), which is what NavAgent2D.js's field comment
   * ("higher-priority agents yield less... than lower-priority ones")
   * describes. If the other agent has avoidance disabled it's still
   * treated as an obstacle to steer around (it won't reciprocate, but
   * this agent still shouldn't walk through it).
   *
   * @param {import("../components/NavAgent2D.js").NavAgent2D|null} navAgent
   * @param {number} agentRadius this agent's NavAgent2D.radius (0 if none)
   * @param {number} dirX @param {number} dirY unit-length desired direction
   * @returns {{x:number,y:number}} unit-length (or zero) steered direction
   */
  _applyNavAvoidance(navAgent, agentRadius, dirX, dirY) {
    if (!navAgent || !navAgent.avoidanceEnabled) return { x: dirX, y: dirY };

    var world = this._world;
    if (!world || typeof world.query !== "function") return { x: dirX, y: dirY };

    var selfId = this._entity.id;
    var selfX = this.x;
    var selfY = this.y;
    var selfPriority = navAgent.avoidancePriority;

    var pushX = 0;
    var pushY = 0;

    var others = world.query(NAV_AGENT_2D, TRANSFORM);
    for (var i = 0; i < others.length; i++) {
      var other = others[i];
      if (other.id === selfId) continue;
      var otherAgent = other.getComponent(NAV_AGENT_2D);
      var otherTransform = other.getComponent(TRANSFORM);
      if (!otherAgent || !otherTransform) continue;

      var offX = selfX - otherTransform.x;
      var offY = selfY - otherTransform.y;
      var dist = Math.hypot(offX, offY);

      // Combined clearance both agents need to not overlap, plus a
      // little headroom so agents start sliding apart just BEFORE they
      // touch rather than after — same spirit as physics contact margins.
      var minDist = agentRadius + otherAgent.radius;
      if (minDist <= 0) minDist = Math.max(agentRadius, otherAgent.radius, 8);
      var avoidRange = minDist * 1.5;
      if (dist >= avoidRange || dist <= 0.000001) continue;

      // How much of the yielding falls on THIS agent vs the other one.
      // Equal priorities split 50/50; a much higher-priority neighbor
      // makes this agent yield almost entirely, and vice versa.
      var otherPriority = otherAgent.avoidancePriority;
      var totalPriority = selfPriority + otherPriority;
      var yieldShare = totalPriority > 0 ? otherPriority / totalPriority : 0.5;

      // Push away from the other agent, stronger the closer they are
      // (falls off linearly to 0 at avoidRange), scaled by this agent's
      // yield share.
      var closeness = 1 - dist / avoidRange;
      var weight = closeness * yieldShare;
      pushX += (offX / dist) * weight;
      pushY += (offY / dist) * weight;
    }

    if (pushX === 0 && pushY === 0) return { x: dirX, y: dirY };

    // Blend the original heading with the avoidance push rather than
    // fully replacing it, so an agent still makes progress toward its
    // waypoint while sliding around a neighbor instead of stopping
    // dead or spinning in place when two pushes briefly cancel out.
    var blendedX = dirX + pushX;
    var blendedY = dirY + pushY;
    var blendedLen = Math.hypot(blendedX, blendedY);
    if (blendedLen <= 0.000001) return { x: dirX, y: dirY };
    return { x: blendedX / blendedLen, y: blendedY / blendedLen };
  }

  /**
   * "Smart NPC" group-surround steering: when two or more collabEnabled
   * NavAgent2D entities are heading toward the SAME (or nearly the same)
   * point — e.g. several guards all given the intruder's position, or a
   * pack all chasing the same prey — this spreads them into distinct
   * slots on a ring around that point instead of every agent pathing to
   * the identical pixel and shoving each other for the last approach,
   * so the group visually traps/encircles the target the way coordinated
   * NPCs do, rather than forming a single-file jam on one side of it.
   *
   * Grouping rule: this agent joins every OTHER active, collabEnabled
   * NavAgent2D whose own current goal is within
   * min(this.collabGroupRadius, other.collabGroupRadius) of THIS call's
   * (targetX,targetY) — the smaller of the two radii wins so one agent
   * can't unilaterally force a huge group. Agents already grouped from a
   * PREVIOUS call (i.e. still converging on the same target) keep the
   * same stable slot index across frames — indices are assigned by
   * entity id order, not recomputed from scratch each call, so a group
   * doesn't visibly reshuffle which agent takes which side every frame.
   *
   * Ring radius is this agent's own NavAgent2D.radius plus the group's
   * largest member radius, so slots are spaced far enough apart that
   * two different-sized agents both fit their own clearance without
   * overlapping each other at the target.
   *
   * Falls back to the plain (targetX,targetY) — no ring offset — when
   * this agent is the only collab member converging on this target, so
   * a lone collabEnabled agent behaves exactly like collabEnabled=false.
   *
   * @param {import("../components/NavAgent2D.js").NavAgent2D} navAgent
   * @param {number} targetX @param {number} targetY the RAW target this
   *   call's navMoveToward() was given, before any collab adjustment
   * @returns {{x:number,y:number}} this agent's assigned goal point —
   *   either the ring slot, or the original target if ungrouped
   */
  _applyNavCollab(navAgent, targetX, targetY) {
    var world = this._world;
    if (!world || typeof world.query !== "function") return { x: targetX, y: targetY };

    var selfId = this._entity.id;
    var groupRadius = navAgent.collabGroupRadius;
    var members = [{ id: selfId, radius: navAgent.radius }]; // self always included

    var others = world.query(NAV_AGENT_2D);
    for (var i = 0; i < others.length; i++) {
      var other = others[i];
      if (other.id === selfId) continue;
      var otherAgent = other.getComponent(NAV_AGENT_2D);
      if (!otherAgent || !otherAgent.collabEnabled) continue;

      // Compare against the OTHER agent's own current nav-move goal
      // (its _navMoveState.goalX/Y, set by its own navMoveToward() call
      // this frame or a prior one) — not its live position — since
      // "heading toward the same thing" is about shared INTENT, not
      // proximity to each other, which is exactly what avoidance
      // already handles.
      var otherGoal = this._scriptApi._peekNavGoal(other.id);
      if (!otherGoal) continue;

      var maxJoinDist = Math.min(groupRadius, otherAgent.collabGroupRadius);
      if (maxJoinDist <= 0) continue;
      if (Math.hypot(otherGoal.x - targetX, otherGoal.y - targetY) > maxJoinDist) continue;

      members.push({ id: other.id, radius: otherAgent.radius });
    }

    // Publish this call's goal so OTHER agents evaluating collab this
    // same frame (or next frame, before this one repaths) can find it —
    // see _peekNavGoal()/_publishNavGoal() below. Must happen even when
    // ungrouped (members.length === 1) so a second agent that starts
    // converging on this target a moment later can still find this one.
    this._scriptApi._publishNavGoal(selfId, targetX, targetY);

    if (members.length < 2) return { x: targetX, y: targetY };

    // Stable slot assignment: sort by entity id (entity ids are strings
    // like "e1", "e2", ... — see core/Entity.js's id counter — so this
    // is a STRING sort, not numeric subtraction, which would silently
    // NaN-compare and produce an unstable/duplicate order) so every
    // member of the group independently computes the SAME order and
    // therefore the SAME ring layout, with no coordination needed
    // beyond each agent seeing the same member list.
    members.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var slotIndex = 0;
    var maxMemberRadius = 0;
    for (var m = 0; m < members.length; m++) {
      if (members[m].id === selfId) slotIndex = m;
      if (members[m].radius > maxMemberRadius) maxMemberRadius = members[m].radius;
    }

    var ringRadius = Math.max(navAgent.radius, 8) + Math.max(maxMemberRadius, 8);
    var angle = (slotIndex / members.length) * Math.PI * 2;
    return {
      x: targetX + Math.cos(angle) * ringRadius,
      y: targetY + Math.sin(angle) * ringRadius,
    };
  }

  get rotation() { const t = this._entity.getComponent(TRANSFORM); return t ? t.rotation : 0; }
  set rotation(v) {
    const t = this._entity.getComponent(TRANSFORM);
    if (!t) return;
    const nextRotation = Number(v);
    if (!Number.isFinite(nextRotation)) return;
    t.rotation = nextRotation;

    // Kinematic rotation is driven by the script/Transform. Remember this
    // exact assignment for the next physics sync so a contact transition
    // cannot blend the body toward another angle. Airborne calls such as
    // `rotation += 2` remain fully supported because every assignment is
    // simply made the exact target for that frame.
    const rb = this._entity.getComponent('Rigidbody2D');
    if (rb && rb.bodyType === 'Kinematic') {
      rb._scriptRotationTarget = nextRotation;
      if (typeof this._scriptApi._kinematicRotationFn === 'function') {
        try {
          this._scriptApi._kinematicRotationFn(this._entity, nextRotation);
        } catch (_) {}
      }
    }
  }

  get scaleX() { const t = this._entity.getComponent(TRANSFORM); return t ? t.scaleX : 1; }
  set scaleX(v) { const t = this._entity.getComponent(TRANSFORM); if (t) t.scaleX = v; }

  get scaleY() { const t = this._entity.getComponent(TRANSFORM); return t ? t.scaleY : 1; }
  set scaleY(v) { const t = this._entity.getComponent(TRANSFORM); if (t) t.scaleY = v; }

  get visible() { return this._entity.active; }
  set visible(v) { this._entity.active = !!v; }

  get enabled() { const s = this._entity.getComponent(SCRIPT); return s ? s.enabled : true; }
  set enabled(v) { const s = this._entity.getComponent(SCRIPT); if (s) s.enabled = !!v; }

  // Identity shortcuts — read the underlying Entity's name/tag (set in
  // the Hierarchy/Inspector, or via new Entity(name, tag)). Added so
  // onCollisionEnter(other)/onTriggerEnter(other) handlers can tell
  // WHAT they just touched ("if (other.tag === 'Obstacle') ...") —
  // previously EntityContext exposed no way at all to read an entity's
  // name or tag, even though Entity itself has always carried both.
  // name is read-only (an entity's identity isn't meant to be
  // rewritten at runtime); tag is read/write since re-tagging at
  // runtime is a normal gameplay pattern (e.g. marking a picked-up
  // item's tag as "Collected" so it's skipped by later checks).
  get name() { return this._entity.name; }
  get tag() { return this._entity.tag; }
  set tag(v) { this._entity.tag = v; }

  /**
   * Stable unique identifier for this entity — unlike name/tag, which
   * many entities can share (e.g. a dozen "Enemy"-named/tagged clones),
   * id is assigned once per entity when it's created and never reused,
   * even after the entity is destroyed (see Entity.js's _nextEntityId
   * counter — it only ever increments). This is what makes findById()
   * a RELIABLE way to re-locate one specific entity later — e.g. save
   * the id of an entity you spawn() so you can findById() that EXACT
   * clone afterward, instead of findFirst(name)/findFirstWithTag(tag)
   * which can silently return a different entity if more than one
   * shares that name or tag.
   *   var e = spawn("Enemy", { x: 100, y: 50 });
   *   var savedId = e.id;
   *   // ...later, maybe in a different script...
   *   var sameEnemy = findById(savedId); // always this exact clone, or null if it was destroyed
   * Read-only — an entity's id is fixed for its entire lifetime.
   */
  get id() { return this._entity.id; }

  /**
   * Destroys this entity — removes it from the scene, exactly like
   * Unity's Destroy(gameObject). Safe to call from ANY lifecycle
   * method (onUpdate, onCollision, onTriggerEnter, even onStart) and
   * safe to call more than once (later calls are harmless no-ops).
   *
   * DEFERRED, not immediate — matches Unity's own Destroy() semantics
   * exactly: the entity is only actually removed at the END of this
   * frame (see World.js's queueDestroy()/flushDestroyed() and
   * ScriptSystem.js's update(), which calls flushDestroyed() after
   * every system has finished its pass for the frame). That means:
   *   - this.x, this.rigidbody.velocity, etc. all keep working
   *     normally for the REST of this frame after calling destroy() —
   *     the entity isn't half-torn-down mid-callback.
   *   - Other scripts' onCollision(other) firing later THIS SAME
   *     frame for this entity still receive a valid `other` context.
   *   - Starting next frame, the entity is gone: it won't appear in
   *     find()/scene.query(), its onUpdate/onFixedUpdate won't run,
   *     its Rapier physics body is removed, its Pixi sprite is
   *     removed, and onDestroy() fires on it exactly once right
   *     before it's actually removed.
   * If you need to know synchronously whether an entity is already
   * queued for removal (e.g. to avoid double-scoring a pickup two
   * scripts both collided with this same frame), check this.destroyed.
   */
  destroy() {
    this._world.queueDestroy(this._entity.id);
  }

  /**
   * True if this entity currently has the given component attached —
   * the runtime backing for editor autocomplete's type-narrowing
   * feature ("if (enemy.hasComponent(\"Rigidbody2D\")) { ... }").
   * Accepts the same component key strings used elsewhere in the
   * engine (see runtime/components/*.js's exported KEY constants,
   * e.g. "Rigidbody2D", "CharacterController", "Collider2D",
   * "SpriteRenderer", "AudioSource", "Light", "Camera",
   * "SpriteAnimation", "TextRenderer", "SpeechBubble", "ChatLog",
   * "TextInput"). "Transform" always returns true — every entity has
   * one. Safe to call on any entity context, including ones from
   * find()/findFirst()/onCollision's `other` — not just `this`.
   *   function onUpdate() {
   *     if (this.hasComponent("Rigidbody2D")) {
   *       this.rigidbody.addForce(0, -500);
   *     }
   *   }
   * @param {string} componentKey
   * @returns {boolean}
   */
  hasComponent(componentKey) {
    return this._entity.hasComponent(componentKey);
  }

  /** True once destroy() has been called on this entity (this frame or
   *  a callback later this same frame) but before it's actually been
   *  removed — see destroy()'s doc comment for the full deferred-
   *  removal timeline. Never true again after the entity is gone
   *  (there's no context left to read it from at that point). */
  get destroyed() {
    return this._world.isPendingDestroy(this._entity.id);
  }

  /**
   * True if THIS entity was itself created via spawn() (a runtime
   * clone) rather than loaded from the scene file. Read-only — an
   * entity's origin isn't meant to be reassigned at runtime, same as
   * Unity's own gameObject identity. Typical use inside onStart():
   *   function onStart() {
   *     if (this.isClone) { this.hp = 50; } // clones start weaker, say
   *   }
   */
  get isClone() {
    return this._isClone;
  }

  /**
   * True while the mouse cursor is currently over THIS entity's own
   * collider shape — real shape-accurate hit-testing, same as
   * mouse.isOver("Name") but without needing to look this entity up by
   * name/tag since you're already inside its own script:
   *   function onUpdate() {
   *     this.sprite.opacity = this.isPointerOver ? 1 : 0.6; // hover highlight
   *   }
   * Requires this entity to have a Collider2D — an entity with no
   * collider can never register as "under" the pointer.
   * MOUSE ONLY — a finger on a touchscreen does not move the mouse
   * cursor, so this never sees touches. For finger input use
   * this.isTouchOver below instead (or check both if you support mouse
   * AND touch: this.isPointerOver || this.isTouchOver).
   */
  get isPointerOver() {
    var hits = this._scriptApi._entitiesAtPoint(this._scriptApi._mouse.x, this._scriptApi._mouse.y);
    for (var i = 0; i < hits.length; i++) {
      if (hits[i]._entity.id === this._entity.id) return true;
    }
    return false;
  }

  /**
   * True for exactly the one frame the left mouse button was pressed
   * while over THIS entity — the beginner-friendly "was I just
   * clicked" check, meant to be read inside onUpdate():
   *   function onUpdate() {
   *     if (this.isClicked) { this.destroy(); } // click to pop
   *   }
   * Same underlying hit-test as mouse.clickedOn("Name"), just phrased
   * as "did it happen to ME" instead of a name/tag lookup. For a
   * button other than left-click, use mouse.clickedOn(this.name, button)
   * instead.
   * MOUSE ONLY — see this.isTapped below for the finger/touchscreen
   * equivalent (or use this.isClicked || this.isTapped to support both
   * a mouse and a touchscreen with one check).
   */
  get isClicked() {
    if (!this._scriptApi._mouse.buttonsPressed.has(0)) return false;
    return this.isPointerOver;
  }

  /**
   * True while ANY active finger is currently over THIS entity's own
   * collider shape — the touch equivalent of this.isPointerOver above,
   * same real shape-accurate hit-test, just checked against every
   * finger on screen instead of a mouse cursor position:
   *   function onUpdate() {
   *     this.sprite.opacity = this.isTouchOver ? 1 : 0.6; // touch hover highlight
   *   }
   * Requires this entity to have a Collider2D. See touch.isOver("Name")
   * for the name/tag-lookup version of this same check.
   */
  get isTouchOver() {
    return this._touchIsOverSelf();
  }

  /** Internal — isTouchOver needs to confirm the hit is THIS entity
   *  specifically (not just any entity sharing its name), same way
   *  isPointerOver compares by id rather than by name/tag lookup. */
  _touchIsOverSelf() {
    for (var t of this._scriptApi._touches.values()) {
      var hits = this._scriptApi._entitiesAtPoint(t.x, t.y);
      for (var i = 0; i < hits.length; i++) {
        if (hits[i]._entity.id === this._entity.id) return true;
      }
    }
    return false;
  }

  /**
   * True for exactly the one frame a finger FIRST touched down while
   * over THIS entity — the touch equivalent of this.isClicked above,
   * the beginner-friendly "was I just tapped" check for mobile:
   *   function onUpdate() {
   *     if (this.isTapped) { this.destroy(); } // tap to pop
   *   }
   * Only counts the frame a finger STARTS on the entity (like a mouse
   * click), not every frame a finger happens to be resting on it — see
   * touch.tappedOn("Name") for the name/tag-lookup version.
   */
  get isTapped() {
    for (var t of this._scriptApi._touches.values()) {
      if (!this._scriptApi._touchesStarted.has(t.id)) continue;
      var hits = this._scriptApi._entitiesAtPoint(t.x, t.y);
      for (var i = 0; i < hits.length; i++) {
        if (hits[i]._entity.id === this._entity.id) return true;
      }
    }
    return false;
  }

  /**
   * Spawns a runtime copy of ANOTHER entity, positioned at (x, y) if
   * given (otherwise at the source's own position) — Unity's
   * Object.Instantiate(original, position) as an instance method, so
   * scripts can do this.spawn("Bullet", { x: this.x, y: this.y })
   * without needing the free global. Accepts a name/tag string (looked
   * up) OR an EntityContext directly — e.g. this.spawn(this) clones
   * THIS exact entity, no name involved at all, so there's never any
   * ambiguity from other entities sharing this one's name. See
   * ScriptAPI.spawn() for full behavior (source lookup, onClone/
   * onStart timing, isClone).
   * @param {string|EntityContext} nameOrTagOrEntity
   * @param {{x?:number, y?:number, name?:string, byTag?:boolean}} [opts]
   */
  spawn(nameOrTagOrEntity, opts) {
    return this._scriptApi.spawn(nameOrTagOrEntity, opts);
  }

  /**
   * Runs `callback` once, after `seconds` of game time, with `this`
   * bound back to THIS entity — the instance-method form of the global
   * wait(), for scripts that prefer this.wait(...) to the bare global:
   *   this.wait(2, function () { this.visible = false; });
   * Same auto-cancel-on-destroy/restart/scene-switch behavior as the
   * global. See ScriptAPI.wait() for full details.
   * @param {number} seconds
   * @param {function} callback
   * @returns {number} timer id usable with cancelWait()/this.cancelWait()
   */
  wait(seconds, callback) {
    return this._scriptApi.wait(seconds, callback);
  }

  /**
   * Cancels a pending timer started by wait()/this.wait(). No-op if it
   * already fired or was already cancelled.
   * @param {number} timerId
   */
  cancelWait(timerId) {
    this._scriptApi.cancelWait(timerId);
  }

  /**
   * Runs `callback` every `seconds`, forever, starting `seconds` from
   * now — the instance-method form of the global repeat():
   *   this.repeat(2, function () { this.hp += 1; }); // regen over time
   * Same auto-cancel-on-destroy/restart/scene-switch behavior as
   * wait(). See ScriptAPI.repeat() for full details, and cancelRepeat()/
   * this.cancelRepeat() to stop it early.
   * @param {number} seconds
   * @param {function} callback
   * @returns {number} timer id usable with cancelRepeat()/this.cancelRepeat()
   */
  repeat(seconds, callback) {
    return this._scriptApi.repeat(seconds, callback);
  }

  /**
   * Stops a repeat() started by this entity. No-op if it was already
   * cancelled. Commonly called from inside the repeat's OWN callback
   * once some condition is met:
   *   var id = this.repeat(1, function () {
   *     this.hp -= 1;
   *     if (this.hp <= 0) this.cancelRepeat(id);
   *   });
   * @param {number} timerId
   */
  cancelRepeat(timerId) {
    this._scriptApi.cancelRepeat(timerId);
  }

  // NOTE: velocity, sprite (texture/color/flip/opacity), and rigidbody
  // physics (isGrounded, addForce, move, etc.) are intentionally NOT
  // duplicated here as this.<x> shortcuts. Each lives in exactly ONE
  // place: this.rigidbody.* (scripting/components/RigidbodyAPI.js) and
  // this.sprite.* (scripting/components/SpriteAPI.js). Rigidbody in
  // particular exposes a DIFFERENT shape per body type (Dynamic/
  // Kinematic/Static) — a flat this.addForce() shortcut here would
  // either have to duplicate that per-body-type logic or risk
  // diverging from it, giving scripts two ways to do the same thing
  // that could behave differently from one another. Use
  // this.rigidbody.addForce(), this.rigidbody.velocity,
  // this.sprite.texture, etc. instead. (this.x/y/position and friends
  // above stay as shortcuts because Transform has only one shape
  // regardless of entity state, and other.x/other.y in
  // onCollision(other) depends on them.)

  // --- Sub-objects (built once, read live data via closures) ---

  _buildSubObjects() {
    var entity = this._entity;

    // Transform is always present on every entity — always attach it.
    this.transform = createTransformAPI(entity);

    // Every other sub-object is attached ONLY when the entity actually has that
    // component. Absent sub-objects are undefined, so scripts can safely branch:
    //   if (this.rigidbody) { this.rigidbody.addForce(0, -500); }
    // This also means autocomplete correctly reflects what the object can do:
    // a Static-body entity won't offer addForce(), a sprite-less entity won't
    // offer this.sprite.texture, and so on — matching the Inspector exactly.
    this.sprite      = entity.hasComponent(SPRITE_RENDERER)     ? createSpriteAPI(entity)      : undefined;
    this.shape       = entity.hasComponent(SHAPE_RENDERER)      ? createShapeAPI(entity)       : undefined;
    this.text        = entity.hasComponent(TEXT_RENDERER)       ? createTextAPI(entity)        : undefined;
    this.speechBubble = entity.hasComponent(SPEECH_BUBBLE)      ? createSpeechBubbleAPI(entity) : undefined;
    this.chat        = entity.hasComponent(CHAT_LOG)            ? createChatLogAPI(entity)     : undefined;
    this.textInput   = entity.hasComponent(TEXT_INPUT)          ? createTextInputAPI(entity)   : undefined;
    this.joystick    = entity.hasComponent(JOYSTICK)             ? createJoystickAPI(entity)    : undefined;
    this.rigidbody   = entity.hasComponent(RIGIDBODY_2D)        ? createRigidbodyAPI(entity)   : undefined;
    this.animator    = entity.hasComponent(SPRITE_ANIMATION)    ? createAnimatorAPI(entity)    : undefined;
    this.camera      = entity.hasComponent(CAMERA)              ? createCameraAPI(entity)      : undefined;
    this.audio       = entity.hasComponent(AUDIO_SOURCE)        ? createAudioAPI(entity)       : undefined;
    // Movement-type-aware — ControllerAPI.js exposes isGrounded/simulateJump
    // ONLY for Character Controller/Platformer, car tunables ONLY for Car, etc.
    this.controller  = entity.hasComponent(CHARACTER_CONTROLLER)? createControllerAPI(entity)  : undefined;
    this.collider    = entity.hasComponent(COLLIDER_2D)          ? createColliderAPI(entity, this._scriptApi) : undefined;
    // this.navAgent — component-gated like everything else above. See
    // NavAgentAPI.js for why every field here is read/write (unlike
    // this.collider, which is read-only).
    this.navAgent    = entity.hasComponent(NAV_AGENT_2D)         ? createNavAgentAPI(entity)    : undefined;
    this.light       = entity.hasComponent(LIGHT)                ? createLightAPI(entity)       : undefined;
    // this.ear — component-gated like everything else above.
    this.ear         = entity.hasComponent(AUDIO_LISTENER)       ? createAudioListenerAPI(entity, this._scriptApi) : undefined;

    // this.state — deliberately UNCONDITIONAL, unlike every sub-object
    // above: state needs no component, it works on every entity (see
    // StateAPI.js's header comment). changeFn is bound here (not left
    // for StateAPI to look up itself) so StateAPI never needs to import
    // ScriptSystem — same decoupling every other _xFn closure in this
    // file already keeps (see _sendMessageFn/_waitFn wiring in
    // ScriptSystem's constructor for the general pattern). Guarded with
    // a fallback no-op in case a script is compiled before ScriptSystem
    // has finished wiring _fireStateChangeFn (mirrors wait()'s identical
    // this._waitFn ? ... : -1 guard below).
    const self = this;
    this.state = createStateAPI(this, function (name) {
      if (self._scriptApi._fireStateChangeFn) {
        self._scriptApi._fireStateChangeFn(self._entity.id, name, self);
      }
    });

    // this.myTouch — also deliberately UNCONDITIONAL, same reasoning as
    // this.state above: no component needed, works on every entity.
    // Locks onto one finger by id and tracks it — see
    // TouchTrackAPI.js's header comment.
    this.myTouch = createTouchTrackAPI(this);
  }

  /**
   * Straight-line distance from this entity's Transform to a given
   * world-space point — the flat-shortcut companion to this.x/this.y
   * (Transform has only one shape, same reasoning as every other
   * Transform shortcut in this class — see the "ONE API PER
   * CAPABILITY" note at the top of this file for why sub-objects like
   * this.rigidbody don't get a similar flat duplicate).
   *   if (this.distanceTo(player.x, player.y) < 100) { this.state.change("chasing"); }
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  distanceTo(x, y) {
    const dx = this.x - x;
    const dy = this.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

export class ScriptAPI {
  /**
   * @param {import('../core/World.js').World} world
   */
  constructor(world) {
    this.world = world;
    this._globals = new Map();
    /** @type {Map<string, EntityContext>} cached per-entity contexts */
    this._contexts = new Map();

    /**
     * Backs NavAgent2D "collab" surround steering (see EntityContext.
     * _applyNavCollab() in this file) — a tiny per-entity-id map of
     * "where is this agent CURRENTLY trying to go", published by every
     * navMoveToward() call so OTHER collabEnabled agents evaluating
     * their own group this same tick can see it, without agents needing
     * any direct reference to each other. Keyed by entity id (not the
     * EntityContext itself — ids are stable and cheap to compare, see
     * EntityContext.id's doc comment). Each entry is
     * { x, y, time } — `time` is this.time.elapsed at publish, used by
     * _peekNavGoal() to ignore stale entries from an agent that stopped
     * calling navMoveToward (destroyed, script disabled, target lost)
     * instead of letting it keep "holding" a group slot forever.
     * Cleared on scene restart/switch by clearContexts() below, same as
     * every other per-scene script state on this class.
     * @type {Map<string, {x:number,y:number,time:number}>}
     */
    this._navGoals = new Map();

    /**
     * Backs the `save` global (see components/SaveAPI.js and
     * SaveStore.js) — persistent, per-slot key/value storage in
     * IndexedDB, as opposed to `global` above which is memory-only
     * for the current session. gameId is set via
     * scriptApi.saveStore.gameId = ... by createGame() in
     * runtime/index.js (which receives it as an option), BEFORE
     * save.load("default") is kicked off there — see that file for
     * the exact boot order. Defaulting to "default" here just means
     * a caller who skips the option still gets a working, if
     * unnamespaced, save database instead of a crash.
     */
    this.saveStore = new SaveStore("default");

    // Input state
    this._keysDown = new Set();
    this._keysPressed = new Set();

    /**
     * Mouse/pointer state. World-space x/y are recomputed every time the
     * pointer moves (see attachPointerInput below) by inverting
     * worldContainer's live transform — so they stay correct through
     * camera pan/zoom/rotation and window resizing without this class
     * needing to know anything about cameras itself.
     * buttonsDown/buttonsPressed/buttonsReleased mirror the
     * keysDown/keysPressed pattern: "Pressed"/"Released" are one-frame
     * pulses, cleared at the end of every frame by _clearFrameKeys().
     * Button numbers match the DOM's e.button (0=left, 1=middle, 2=right).
     */
    this._mouse = {
      x: 0, y: 0,               // world-space, updated live as the pointer moves
      screenX: 0, screenY: 0,   // canvas-pixel space (0,0 = top-left of the game view)
      buttonsDown: new Set(),
      buttonsPressed: new Set(),
      buttonsReleased: new Set(),
      /** True while the pointer is anywhere over the game canvas at all. */
      over: false,
    };

    /**
     * Active touches, keyed by the browser's own pointerId/identifier so
     * a specific finger can be tracked across move events even with
     * several fingers down at once. Each entry:
     *   { id, x, y, screenX, screenY, startX, startY }
     * world x/y computed the same way mouse.x/y are. startX/startY are
     * WORLD-space too, captured once at touchstart, so scripts can
     * measure a swipe/drag distance without storing anything themselves:
     *   touch.x - touch.startX
     * @type {Map<number, object>}
     */
    this._touches = new Map();
    /** Touch ids that just went down this frame (one-frame pulse, like
     *  buttonsPressed) — lets `touch.justStarted` work without the
     *  script tracking previous-frame state itself. */
    this._touchesStarted = new Set();
    /** Touch ids that were just lifted/cancelled this frame. Kept ONE
     *  frame after removal from _touches so a script reading
     *  touch.justEnded during onUpdate still sees it — cleared at the
     *  same point buttonsPressed/keysPressed are. */
    this._touchesEnded = new Set();
    /** Snapshot of each ended touch's last-known data (position, startX/Y,
     *  etc.) so touch.justEnded entries still have valid coords the frame
     *  they end — they've already been removed from _touches by then. */
    this._touchesEndedData = new Map();

    /**
     * BUG FIX — THE `touch` GLOBAL WAS FROZEN FOREVER AT SCRIPT START:
     * getGlobals() is only called ONCE per entity, when its script is
     * compiled (see ScriptSystem._initEntityScripts) — the values it
     * returns are passed as plain parameters into `new Function(...)`,
     * so whatever a parameter's value IS at that single call becomes
     * the script's permanent local binding for the whole life of the
     * scene. That's fine for `mouse`/`input`, because those are STABLE
     * objects whose individual properties are getters reading live
     * `self._mouse`/`self._keysDown` state on every access — the outer
     * object reference never changes, only what its getters return.
     * `touch` used to break that pattern: it was itself a top-level
     * `get touch()` that built and returned a BRAND NEW plain array
     * every time it was read. Read once at script-start (before any
     * finger had ever touched the screen), it produced one empty,
     * inert snapshot array — with plain (non-getter) `.count`/`.first`/
     * etc. properties baked in — that got handed to the script and
     * then NEVER recomputed again. Every onUpdate() after that read
     * the exact same dead object: `touch.count` was always 0,
     * `touch.first` was always null, no matter how many fingers were
     * actually on the glass. This is what made mobile touch look
     * completely non-functional from script code.
     *
     * The fix mirrors `mouse`: keep ONE persistent array instance for
     * the whole scene (this field) and mutate it IN PLACE every frame
     * (see _recomputeTouchGlobal(), called by ScriptSystem.update()
     * before scripts run) instead of allocating a new array each read.
     * getGlobals() below now hands out a direct reference to THIS
     * array rather than a getter — since the array's contents are
     * refreshed in place, the script's one-time-bound `touch` variable
     * still sees current data on every frame, exactly like `mouse`.
     */
    this._touchGlobal = [];

    // touch.isOver()/touch.tappedOn() — the name/tag-lookup touch
    // equivalents of mouse.isOver()/mouse.clickedOn(), set ONCE (not
    // inside _recomputeTouchGlobal()'s per-frame refresh — these are
    // functions, not per-frame data, and they already read live state
    // through the `self` closure on every CALL, exactly like
    // mouse.isOver/mouse.clickedOn do). Safe to attach once: the
    // per-frame refresh only clears the array's indexed entries
    // (list.length = 0) and re-sets its data properties — it never
    // touches unrelated named properties like these.
    var touchApiSelf = this;
    /**
     * True if ANY currently active finger is over the given entity —
     * the touch equivalent of mouse.isOver(). Accepts a name/tag
     * string (matches the FIRST entity with that name/tag) OR an
     * EntityContext directly, for an exact, unambiguous check:
     *   if (touch.isOver("Button")) { ... }
     *   if (touch.isOver(door)) { ... }
     */
    this._touchGlobal.isOver = function (nameOrTagOrEntity, opts) {
      return touchApiSelf._entityUnderTouch(nameOrTagOrEntity, opts) !== null;
    };
    /**
     * True the SAME FRAME a finger FIRST touched down over the given
     * entity — the touch equivalent of mouse.clickedOn(), the "I
     * tapped this specific thing" check. Accepts a name/tag string OR
     * an EntityContext directly, same as isOver() above:
     *   if (touch.tappedOn("Button")) { scene.load("Level1"); }
     *   if (touch.tappedOn(door)) { ... }
     * Only counts the frame a finger starts on the entity (like a
     * click), not every frame a finger happens to be resting on it.
     */
    this._touchGlobal.tappedOn = function (nameOrTagOrEntity, opts) {
      opts = Object.assign({}, opts, { justStarted: true });
      return touchApiSelf._entityUnderTouch(nameOrTagOrEntity, opts) !== null;
    };

    // Seed count/first/swipe/pinch etc. right away — see
    // _recomputeTouchGlobal() — so a read before the first frame's
    // refresh (defensive; ScriptSystem.update() always refreshes before
    // any script code runs in the normal path) still sees a real
    // 0/null baseline instead of undefined fields on a bare array.
    this._recomputeTouchGlobal();

    /** Updated by ScriptSystem each frame */
    this.time = { deltaTime: 0, elapsed: 0 };

    /**
     * Debug overlay state, driven by the `debug` global exposed to
     * scripts (see getGlobals() below). The play popup (play-popup.js)
     * polls `scriptApi.debugState` every frame to render/hide the HUD —
     * this class only tracks the data, it never touches the DOM itself
     * (ScriptAPI is shared by the editor too, which has no game HUD).
     */
    this.debugState = {
      enabled: false,
      showFps: true,
      stats: new Map(), // custom key -> value pairs from debug.log()
      /** Debug line segments drawn this frame (cleared each frame).
       *  Each entry: { x1,y1,x2,y2, color, hitPoint:{x,y}|null }
       *  Populated by physics.raycast(…,{debug:true}) and rendered by
       *  the player/popup's onTick using PIXI.Graphics in world space. */
      debugLines: [],
    };

    /** Set by createGame to enable scene.restart() */
    this._restartFn = null;
    /** Set by createGame to enable scene.load() */
    this._loadSceneFn = null;
    /** Set by createGame to enable scene.pause() — see GameLoop.pause() */
    this._pauseFn = null;
    /** Set by createGame to enable scene.resume() — see GameLoop.resume() */
    this._resumeFn = null;
    /** Set by createGame to enable scene.isPaused — see GameLoop.isPaused */
    this._isPausedFn = null;
    /** Set by ScriptSystem constructor to enable sendMessage(tag, msg, data) */
    this._sendMessageFn = null;
    /** Set by ScriptSystem constructor to enable broadcastMessage(msg, data) */
    this._broadcastMessageFn = null;
    /** Set by ScriptSystem constructor to enable wait(seconds, callback) */
    this._waitFn = null;
    /** Set by ScriptSystem constructor to enable cancelWait(timerId) */
    this._cancelWaitFn = null;
    /** Set by ScriptSystem constructor to enable repeat(seconds, callback) */
    this._repeatFn = null;
    /** Set by ScriptSystem constructor to enable cancelRepeat(timerId) */
    this._cancelRepeatFn = null;
    /** Set by ScriptSystem constructor (bound fireStateChange) to back
     *  every entity's this.state.change(name) — see StateAPI.js and
     *  EntityContext's constructor above. */
    this._fireStateChangeFn = null;
    /** Set by createGame (bound AudioListenerSystem.getInRange) to back
     *  this.ear.sourcesInRange/canHear() — see AudioListenerAPI.js. */
    this._audioListenerRangeFn = null;
    /** Set by createGame to enable mouse.clickedOn()/isOver() and
     *  this.isClicked/this.isPointerOver — a (x, y) -> entityId[]
     *  function backed by PhysicsWorld.entityAtPoint (real Rapier
     *  shape queries, not a bounding-box guess). null until physics
     *  finishes loading OR outside a play/editor context that wires it
     *  (e.g. running scripts isn't possible at all without this, so in
     *  practice this is always set before any script runs — kept
     *  nullable defensively, same as every other _*Fn hook here). */
    this._physicsHitTestFn = null;
    /** Set by createGame to enable physics.raycast() with real Rapier
     *  shape queries. (x1,y1,x2,y2,opts) -> { entityId, point, normal, distance } | null */
    this._physicsRaycastFn = null;
    /** Optional PhysicsWorld hook for immediate grounded Kinematic rotation
     *  support preservation. */
    this._kinematicRotationFn = null;
    /** Set by createGame to enable this.collider.isColliding()/isColliding
     *  (other) — see ColliderAPI.js. (entityId, otherEntityId?) -> boolean,
     *  backed by PhysicsWorld.isColliding (reads the same solid-contact
     *  tracking onCollisionStay's per-frame dispatch already reads). */
    this._isCollidingFn = null;
    /** Set by createGame to enable nav.findPath() — see
     *  systems/NavWorldSystem.js for the real implementation this
     *  forwards to. (startX,startY,goalX,goalY,radius?,area?) -> {x,y}[]
     *  | null. Uses the FIRST NavWorld2D entity in the scene (see
     *  NavWorldSystem._firstNavWorld's doc comment on the one-per-scene
     *  convention) — same "no entity argument needed" shape as
     *  physics.raycast(), which likewise never asks a script to name
     *  which PhysicsWorld to use. `radius` defaults to 0 (the base
     *  unpadded layer), `area` defaults to 0xffff (every area allowed);
     *  this.navMoveToward() passes its NavAgent2D's radius and area
     *  automatically — see that method. */
    this._navFindPathFn = null;
    /** Set by createGame to enable nav.isWalkable(x,y) -> boolean. */
    this._navIsWalkableFn = null;
    /** Set by createGame to enable nav.bake() -> {walkable,blocked}|null.
     *  Exposed to scripts mainly for a procedurally-generated level that
     *  needs to re-bake after spawning its own obstacles at runtime —
     *  most games bake once in the editor and never call this. */
    this._navBakeFn = null;

    this._setupInput();
  }

  _setupInput() {
    if (typeof window === "undefined") return;
    var self = this;
    window.addEventListener("keydown", function (e) {
      // Track both e.key (e.g. " ", "a", "ArrowLeft") and e.code (e.g. "Space", "KeyA")
      if (!self._keysDown.has(e.code)) {
        self._keysPressed.add(e.code);
      }
      if (!self._keysDown.has(e.key)) {
        self._keysPressed.add(e.key);
      }
      self._keysDown.add(e.key);
      self._keysDown.add(e.code);
    });
    window.addEventListener("keyup", function (e) {
      self._keysDown.delete(e.key);
      self._keysDown.delete(e.code);
    });
    window.addEventListener("blur", function () {
      self._keysDown.clear();
      // A window losing focus mid-drag/click is exactly like alt-tabbing
      // mid-keypress — the browser will never send the matching
      // mouseup/touchend, so without this a button/finger could get
      // stuck "down" forever from the game's point of view.
      self._mouse.buttonsDown.clear();
      self._touches.clear();
    });
  }

  /**
   * Wires up mouse + touch input against the actual game canvas. Called
   * once by createGame() (runtime/index.js) — NOT from the constructor,
   * because unlike keyboard input (which listens on `window` and needs
   * nothing else) pointer input needs to know both WHICH canvas is the
   * game view and how to convert a screen pixel into a world position,
   * and neither of those exists yet at ScriptAPI construction time.
   *
   * @param {HTMLCanvasElement} canvas the PIXI Application's own canvas (pixiApp.view)
   * @param {import('../systems/RenderSystem.js').RenderSystem} renderSystem
   *   used for renderSystem.worldContainer.toLocal(...) — the SAME live
   *   PIXI transform (pan/zoom/rotation/camera-follow) sprites are
   *   already drawn through, so mouse.x/y always land exactly where the
   *   sprite under the cursor visually is, with no coordinate math
   *   duplicated here that could drift out of sync with rendering.
   */
  attachPointerInput(canvas, renderSystem) {
    if (!canvas || typeof window === "undefined") return;
    var self = this;

    /**
     * Converts clientX/clientY into screen-pixel and world-space coords.
     * Used by both mouse and touch paths.
     */
    function toCoords(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var screenX = (clientX - rect.left) * scaleX;
      var screenY = (clientY - rect.top) * scaleY;
      var world = { x: screenX, y: screenY };
      if (renderSystem && renderSystem.worldContainer && renderSystem.worldContainer.toLocal) {
        var local = renderSystem.worldContainer.toLocal({ x: screenX, y: screenY });
        world = { x: local.x, y: local.y };
      }
      return { screenX: screenX, screenY: screenY, worldX: world.x, worldY: world.y };
    }

    function isTouchPointer(e) {
      return e.pointerType === "touch" || e.pointerType === "pen";
    }

    // ── Mouse input (pointer events, non-touch only) ──────────────────
    canvas.addEventListener("pointermove", function (e) {
      if (isTouchPointer(e)) return; // touch/pen handled by the touch path below
      var c = toCoords(e.clientX, e.clientY);
      self._mouse.x = c.worldX;
      self._mouse.y = c.worldY;
      self._mouse.screenX = c.screenX;
      self._mouse.screenY = c.screenY;
      self._mouse.over = true;
    });
    canvas.addEventListener("pointerleave", function (e) {
      if (!isTouchPointer(e)) self._mouse.over = false;
    });
    canvas.addEventListener("pointerdown", function (e) {
      if (isTouchPointer(e)) return;
      self._mouse.buttonsDown.add(e.button);
      self._mouse.buttonsPressed.add(e.button);
    });
    canvas.addEventListener("pointerup", function (e) {
      if (isTouchPointer(e)) return;
      self._mouse.buttonsDown.delete(e.button);
      self._mouse.buttonsReleased.add(e.button);
    });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    // Prevent the browser (and OS touchpad) from pinch-zooming the page
    // while the game is running. On laptops, a two-finger pinch on the
    // touchpad arrives as a wheel event with ctrlKey=true — stopping it
    // here keeps the viewport locked at 100% regardless of what the
    // player's hands do on the trackpad.
    canvas.addEventListener("wheel", function (e) {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });

    // ── Native touch/pointer input ────────────────────────────────────
    // Do not make mobile input depend on Hammer's backend choice. Older
    // Android WebViews expose Touch Events, newer ones expose Pointer Events,
    // and some hybrid devices expose both. Native input is the source of
    // truth here; swipe and pinch are derived from the live touch map below.
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
    canvas.style.webkitUserSelect = "none";

    function touchStart(id, clientX, clientY) {
      var c = toCoords(clientX, clientY);
      self._touches.set(id, {
        id: id,
        x: c.worldX, y: c.worldY,
        screenX: c.screenX, screenY: c.screenY,
        startX: c.worldX, startY: c.worldY,
      });
      self._touchesStarted.add(id);
    }

    function touchMove(id, clientX, clientY) {
      if (!self._touches.has(id)) return;
      var c = toCoords(clientX, clientY);
      var entry = self._touches.get(id);
      entry.x = c.worldX; entry.y = c.worldY;
      entry.screenX = c.screenX; entry.screenY = c.screenY;
    }

    function touchEnd(id) {
      if (!self._touches.has(id)) return;
      self._touchesEndedData.set(id, Object.assign({}, self._touches.get(id)));
      self._touches.delete(id);
      self._touchesEnded.add(id);
    }

    if (typeof window.PointerEvent === "function") {
      canvas.addEventListener("pointerdown", function (e) {
        if (!isTouchPointer(e)) return;
        e.preventDefault();
        if (canvas.setPointerCapture) {
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        }
        touchStart(e.pointerId, e.clientX, e.clientY);
      }, { passive: false });
      canvas.addEventListener("pointermove", function (e) {
        if (!isTouchPointer(e)) return;
        e.preventDefault();
        touchMove(e.pointerId, e.clientX, e.clientY);
      }, { passive: false });
      function pointerTouchEnd(e) {
        if (!isTouchPointer(e)) return;
        e.preventDefault();
        touchEnd(e.pointerId);
        if (canvas.releasePointerCapture) {
          try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      }
      canvas.addEventListener("pointerup", pointerTouchEnd, { passive: false });
      canvas.addEventListener("pointercancel", pointerTouchEnd, { passive: false });
    } else {
      canvas.addEventListener("touchstart", function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          touchStart(t.identifier, t.clientX, t.clientY);
        }
      }, { passive: false });
      canvas.addEventListener("touchmove", function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          touchMove(t.identifier, t.clientX, t.clientY);
        }
      }, { passive: false });
      function rawTouchEnd(e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          touchEnd(e.changedTouches[i].identifier);
        }
      }
      canvas.addEventListener("touchend", rawTouchEnd, { passive: false });
      canvas.addEventListener("touchcancel", rawTouchEnd, { passive: false });
    }
  }

  /**
   * Rebuilds this._touchGlobal (the exact array reference exposed to
   * scripts as the `touch` global — see the comment on that field in
   * the constructor) IN PLACE: clears it, then re-pushes one entry per
   * active/just-ended finger and re-derives the array-level extras
   * (count/first/anyJustStarted/anyJustEnded/swipe/pinch), same shape
   * and math this used to compute inline inside the old `get touch()`.
   * Mutating the SAME array every time (instead of returning a new one)
   * is what makes a script's one-time-bound `touch` variable see fresh
   * data on every onUpdate() — see the BUG FIX comment above
   * this._touchGlobal for why that distinction matters.
   *
   * Called once per frame by ScriptSystem.update(), BEFORE both the
   * fixed-update and regular onUpdate passes, so every script callback
   * that runs this frame observes the same touch snapshot — matching
   * how keyPressed/mouse.pressed pulses are only cleared once per frame
   * (at the very end, via _clearFrameKeys()) rather than mid-frame.
   */
  _recomputeTouchGlobal() {
    var self = this;
    var list = this._touchGlobal;
    list.length = 0; // clear in place — keeps the same array reference

    // Active (currently down) touches.
    for (var t of self._touches.values()) {
      var dx = t.x - t.startX;
      var dy = t.y - t.startY;
      list.push({
        id: t.id,
        x: t.x, y: t.y,
        screenX: t.screenX, screenY: t.screenY,
        startX: t.startX, startY: t.startY,
        dx: dx, dy: dy,
        distance: Math.sqrt(dx * dx + dy * dy),
        justStarted: self._touchesStarted.has(t.id),
        justEnded: false,
      });
    }

    // Just-ended touches (one frame only, so scripts can read final pos).
    for (var endedId of self._touchesEnded) {
      var te = self._touchesEndedData.get(endedId);
      if (!te) continue;
      var edx = te.x - te.startX;
      var edy = te.y - te.startY;
      list.push({
        id: te.id,
        x: te.x, y: te.y,
        screenX: te.screenX, screenY: te.screenY,
        startX: te.startX, startY: te.startY,
        dx: edx, dy: edy,
        distance: Math.sqrt(edx * edx + edy * edy),
        justStarted: false,
        justEnded: true,
      });
    }

    // Array-level convenience properties.
    list.count = self._touches.size; // only currently-down fingers
    list.first = list.length > 0 ? list[0] : null;
    list.anyJustStarted = self._touchesStarted.size > 0;
    list.anyJustEnded = self._touchesEnded.size > 0;

    // ── Swipe gesture ──────────────────────────────────────────────
    // Detected when a SINGLE active finger has moved more than
    // SWIPE_THRESHOLD world-space pixels from its touch-down point.
    // Direction is the dominant (larger) axis: left/right/up/down.
    var SWIPE_THRESHOLD = 40;
    var swipe = { active: false, direction: null, dx: 0, dy: 0, distance: 0 };
    if (self._touches.size === 1) {
      var ft = list[0];
      if (ft && !ft.justEnded && ft.distance >= SWIPE_THRESHOLD) {
        swipe.active = true;
        swipe.dx = ft.dx;
        swipe.dy = ft.dy;
        swipe.distance = ft.distance;
        if (Math.abs(ft.dx) >= Math.abs(ft.dy)) {
          swipe.direction = ft.dx > 0 ? "right" : "left";
        } else {
          swipe.direction = ft.dy > 0 ? "down" : "up";
        }
      }
    }
    list.swipe = swipe;

    // ── Pinch gesture ──────────────────────────────────────────────
    // Detected while EXACTLY two fingers are on screen. scale is the
    // ratio of the current distance between the two fingers vs the
    // distance at the time they both touched down; delta is the raw
    // pixel change (positive = spreading/zooming out).
    var pinch = { active: false, scale: 1, delta: 0, distance: 0 };
    if (self._touches.size >= 2) {
      var touches = Array.from(self._touches.values());
      var p1 = touches[0], p2 = touches[1];
      var curDist = Math.sqrt(
        (p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y)
      );
      var startDist = Math.sqrt(
        (p1.startX - p2.startX) * (p1.startX - p2.startX) +
        (p1.startY - p2.startY) * (p1.startY - p2.startY)
      );
      pinch.active = true;
      pinch.distance = curDist;
      pinch.delta = curDist - startDist;
      pinch.scale = startDist > 0.5 ? curDist / startDist : 1;
    }
    list.pinch = pinch;
  }

  /** Called by ScriptSystem at the end of each frame — clears every
   *  one-frame "pulse" flag (keyPressed, mouse.pressed/released,
   *  touch.justStarted/justEnded) so each only reads true for the
   *  single frame the event actually happened on. */
  _clearFrameKeys() {
    this._keysPressed.clear();
    this._mouse.buttonsPressed.clear();
    this._mouse.buttonsReleased.clear();
    this._touchesStarted.clear();
    this._touchesEnded.clear();
    this._touchesEndedData.clear();
  }

  /**
   * Finds every entity with the given tag and returns live EntityContexts.
   * The returned array is a snapshot of the matching objects at call time;
   * each context still reads and writes the live entity.
   */
  findWithTag(tag) {
    var entities = this.world && this.world.findByTag ? this.world.findByTag(tag) : [];
    return entities.map((entity) => this.createEntityContext(entity));
  }

  // --- Explicit find-by-name / find-by-tag pair ---
  //
  // findWithTag() (above) is unchanged and keeps working exactly as
  // before. These four give lookups explicit, unambiguous names,
  // in matched first/all pairs, so a script never has to guess whether
  // findFirst("Enemy") returns one object or many, or reach for a byTag flag
  // to search by tag instead of name:
  //   findFirst("Enemy")      -> first entity named "Enemy", or null
  //   findAll("Enemy")        -> every entity named "Enemy" (array)
  //   findFirstWithTag("Foe") -> first entity tagged "Foe", or null
  //   findAllWithTag("Foe")   -> every entity tagged "Foe" (array)

  /** Find the first entity with the given NAME. Returns an EntityContext,
   *  or null if none match. */
  findFirst(name) {
    var entity = this.world.findFirst ? this.world.findFirst(name) : this.world.findFirstByName(name);
    if (!entity) return null;
    return this.createEntityContext(entity);
  }

  /** Find every entity with the given NAME. Returns an array of live
   *  EntityContexts (empty array if none match — never null, so a
   *  script can always safely .forEach()/.length it). */
  findAll(name) {
    var entities = this.world && this.world.findAll ? this.world.findAll(name) : [];
    return entities.map((entity) => this.createEntityContext(entity));
  }

  /**
   * Find the entity with the given stable id (see EntityContext's `id`
   * getter for what makes this different from/more reliable than
   * findFirst(name) or findFirstWithTag(tag)). Returns an EntityContext,
   * or null if no entity has that id — including if it once did, but
   * that entity has since been destroyed. There is at most ONE entity
   * with any given id, ever, so unlike findFirst/findFirstWithTag there
   * is no "byTag"-style ambiguity and no findAllById counterpart needed.
   *   var bullet = spawn("Bullet", { x: this.x, y: this.y });
   *   var id = bullet.id;
   *   // ...later...
   *   var sameBullet = findById(id); // null if it was destroyed by then
   */
  findById(id) {
    var entity = this.world && this.world.getEntity ? this.world.getEntity(id) : null;
    if (!entity) return null;
    return this.createEntityContext(entity);
  }

  /** Find the first entity with the given TAG. Returns an EntityContext,
   *  or null if none match. */
  findFirstWithTag(tag) {
    var entity = this.world && this.world.findFirstWithTag ? this.world.findFirstWithTag(tag) : null;
    if (!entity) return null;
    return this.createEntityContext(entity);
  }

  /** Find every entity with the given TAG. Same lookup as findWithTag()
   *  — this is just the name that matches findFirstWithTag() above. */
  findAllWithTag(tag) {
    return this.findWithTag(tag);
  }

  /**
   * Find every entity within `radius` world units of the point (x, y),
   * optionally narrowed to a NAME or a TAG — the distance-search
   * counterpart to findAll()/findAllWithTag() above. Always returns an
   * array (empty if nothing matches — never null, same convention as
   * every other findAll* here), sorted nearest-first so the common
   * "find the CLOSEST thing" case is just `findInRadius(...)[0]`.
   *
   * opts.name and opts.tag are mutually exclusive — if both are given,
   * name wins (matches CAST_TARGETS/ControllerAPI's own "one wins,
   * documented, no silent double-filter" convention elsewhere in this
   * codebase). Omit both to match every entity in the scene regardless
   * of name/tag.
   *
   *   findInRadius(this.x, this.y, 200)                     // everything within 200 units
   *   findInRadius(this.x, this.y, 200, { tag: "Enemy" })   // only Enemies
   *   findInRadius(this.x, this.y, 200, { name: "Coin" })   // only entities named "Coin"
   *
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {{name?:string, tag?:string}} [opts]
   * @returns {object[]} live EntityContexts, nearest first
   */
  findInRadius(x, y, radius, opts) {
    opts = opts || {};
    const r2 = Math.max(0, radius) * Math.max(0, radius);
    const all = this.world ? this.world.getAllEntities() : [];
    const hits = [];
    for (const entity of all) {
      if (opts.name && entity.name !== opts.name) continue;
      if (!opts.name && opts.tag && entity.tag !== opts.tag) continue;
      const t = entity.getComponent(TRANSFORM);
      if (!t) continue;
      const dx = t.x - x;
      const dy = t.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) hits.push({ entity, d2 });
    }
    hits.sort((a, b) => a.d2 - b.d2);
    return hits.map((h) => this.createEntityContext(h.entity));
  }

  /**
   * Spawns a runtime copy of an existing entity — Unity's
   * Object.Instantiate(original). Accepts EITHER:
   *   - an EntityContext directly — `this`, or anything returned by
   *     find*()/findById()/spawn() itself — clones THAT EXACT entity,
   *     no lookup involved at all. This is the reliable option: there
   *     is no ambiguity, even if ten other entities share its name.
   *       spawn(this)                     // clone whatever entity is running this script
   *       var e = findById(id); spawn(e);  // clone one specific entity you already have a handle to
   *   - a name or tag STRING (the original, still-supported form) —
   *     looks up the source by name (default) or tag (opts.byTag),
   *     using the FIRST match if more than one entity shares that
   *     name/tag. Kept for backward compatibility and for the common
   *     "spawn a fresh copy of this prefab-like object by name" case
   *     where you don't have (and don't need) a direct reference.
   *       spawn("Bullet")
   *       spawn("Enemy", { byTag: true })
   * Deep-clones via cloneEntity() (same registry-driven reconstruct as
   * editor copy/paste — every component type is handled uniformly,
   * nothing per-type to keep in sync here), and returns an
   * EntityContext for the new entity.
   *
   * Returns null if no source entity is found (string form only — the
   * EntityContext form can't miss, since you're handing over the exact
   * entity) — mirrors find()'s own null-on-miss behavior rather than
   * throwing, so a script can safely do
   * `var e = spawn("Enemy"); if (e) { ... }`.
   *
   * WIRING NOTE: the new entity is added straight into world.entities,
   * so PhysicsWorld.step() and RenderSystem.update() (both re-query the
   * live world every single frame) pick it up automatically next frame
   * with zero special-casing. ScriptSystem is the one system that does
   * NOT re-scan every frame (it only compiles once at scene start for
   * performance) — see ScriptSystem._initNewInstances(), called right
   * after this returns, which incrementally compiles/starts scripts for
   * ANY entity that doesn't have instances yet, clone or otherwise, and
   * is what actually fires this clone's own onClone()/onStart().
   *
   * @param {string|EntityContext} nameOrTagOrEntity  a name/tag string (looked up), or an EntityContext to clone directly
   * @param {{x?:number, y?:number, name?:string, byTag?:boolean}} [opts]
   *   x/y      — spawn position (defaults to the source's own position)
   *   name     — rename the clone (defaults to the source's own name)
   *   byTag    — true to look up nameOrTagOrEntity as a TAG instead of a name (ignored when passing an EntityContext directly)
   * @returns {object|null} EntityContext for the new entity, or null if no source was found
   */
  spawn(nameOrTagOrEntity, opts) {
    opts = opts || {};
    // EntityContext form: has an underlying _entity, so there's no
    // name/tag lookup to do at all — just clone that exact entity.
    // This is what makes `spawn(this)` / `spawn(someFindResult)`
    // possible, instead of being forced through a name that might
    // match more than one entity.
    var source = (nameOrTagOrEntity && nameOrTagOrEntity._entity)
      ? nameOrTagOrEntity._entity
      : (opts.byTag
          ? (this.world.findByTag ? this.world.findByTag(nameOrTagOrEntity)[0] : null)
          : this.world.findFirstByName(nameOrTagOrEntity));
    if (!source) {
      if (typeof console !== "undefined") {
        console.warn("[ScriptAPI] spawn('" + nameOrTagOrEntity + "') — no entity found " +
          (opts.byTag ? "with tag" : "named") + " '" + nameOrTagOrEntity + "'");
      }
      return null;
    }
    var entity = cloneEntity(this.world, source, opts);
    return this.createEntityContext(entity);
  }

  /**
   * Runs `callback` once after `seconds` of game time. Thin passthrough
   * to ScriptSystem's _scheduleWait (wired up as this._waitFn in
   * ScriptSystem's constructor, same pattern as _sendMessageFn) — see
   * that method's doc comment for the full behavior: ownership,
   * auto-cancel on destroy/restart/scene-switch, and `this` binding.
   * @param {number} seconds
   * @param {function} callback
   * @returns {number} timer id, or -1 if there was no active entity
   */
  wait(seconds, callback) {
    return this._waitFn ? this._waitFn(seconds, callback) : -1;
  }

  /**
   * Cancels a pending wait() timer before it fires. No-op if the id
   * already fired or was already cancelled.
   * @param {number} timerId
   */
  cancelWait(timerId) {
    if (this._cancelWaitFn) this._cancelWaitFn(timerId);
  }

  /**
   * Runs `callback` every `seconds`, forever, until cancelled or the
   * owning entity/scene goes away. Thin passthrough to ScriptSystem's
   * _scheduleRepeat (wired up as this._repeatFn), same pattern as
   * wait()/_waitFn — see that method's doc comment for full behavior.
   * @param {number} seconds
   * @param {function} callback
   * @returns {number} timer id, or -1 if there was no active entity
   */
  repeat(seconds, callback) {
    return this._repeatFn ? this._repeatFn(seconds, callback) : -1;
  }

  /**
   * Stops a repeat() before its next fire. No-op if already cancelled.
   * @param {number} timerId
   */
  cancelRepeat(timerId) {
    if (this._cancelRepeatFn) this._cancelRepeatFn(timerId);
  }

  /**
   * Creates (or returns a cached) EntityContext for the given entity.
   */
  createEntityContext(entity) {
    if (this._contexts.has(entity.id)) {
      return this._contexts.get(entity.id);
    }
    var ctx = new EntityContext(entity, this.world, this);
    this._contexts.set(entity.id, ctx);
    return ctx;
  }

  /**
   * Drops every cached EntityContext. MUST be called whenever the World
   * is cleared/reloaded (scene.restart(), scene.load()) — entity ids get
   * reused after World.clear() resets its id counter (see
   * core/World.js), so without this a stale EntityContext from the
   * PREVIOUS (now-destroyed) Entity instance would keep being handed
   * back to scripts for the new entity that happens to share its id,
   * silently reading/writing dead component data instead of the fresh
   * scene's actual entities.
   */
  clearContexts() {
    this._contexts.clear();
    // Collab goals are per-scene transient state, same category as the
    // contexts themselves — a stale goal surviving a scene.restart()/
    // scene.load() could otherwise make a freshly-spawned agent think
    // it's grouped with a target from the PREVIOUS scene for up to
    // _NAV_GOAL_STALE_SECONDS.
    this._navGoals.clear();
  }

  /**
   * Drops the cached EntityContext for ONE entity id. Used when a
   * single entity is destroyed via this.destroy() (see EntityContext's
   * destroy() method and ScriptSystem.js's flushDestroyed handling) —
   * the rest of the scene keeps running, so a full clearContexts()
   * would be wrong here (it would drop every OTHER entity's live
   * context too); this only removes the one that no longer exists, for
   * the same reuse-safety reason clearContexts() exists at all.
   * @param {string} id
   */
  clearContext(id) {
    this._contexts.delete(id);
    // Same reasoning as clearContexts() above, scoped to just this one
    // entity — a destroyed agent must stop "holding" a collab slot
    // immediately rather than lingering for the rest of the stale window.
    this._navGoals.delete(id);
  }

  /**
   * Real shape-accurate hit-test: which entities' Collider2D actually
   * contains this WORLD-space point (box/circle/capsule/triangle,
   * including rotation — not a bounding-box guess). Thin wrapper over
   * _physicsHitTestFn (wired to PhysicsWorld.entityAtPoint by
   * createGame — see runtime/index.js), returning EntityContexts
   * instead of raw ids so callers get the same `this`-shaped object
   * every other API here returns.
   * @param {number} x world-space x
   * @param {number} y world-space y
   * @returns {object[]} EntityContexts whose collider contains the point (possibly empty)
   */
  _entitiesAtPoint(x, y) {
    if (!this._physicsHitTestFn) return [];
    var ids = this._physicsHitTestFn(x, y) || [];
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var entity = this.world.getEntity(ids[i]);
      if (entity) out.push(this.createEntityContext(entity));
    }
    return out;
  }

  /**
   * Finds the entity currently under the mouse cursor matching
   * `nameOrTagOrEntity`, or null if the cursor isn't over any matching
   * entity right now. Accepts EITHER a name/tag string (opts.byTag
   * picks which) — the original form, which can match the wrong entity
   * if more than one shares that name/tag — OR an EntityContext
   * directly, which always checks against that EXACT entity with no
   * ambiguity at all:
   *   mouse.isOver(door)         // door from findById()/findFirst()/etc — checks THIS exact entity
   *   mouse.isOver("Door")       // still works — first entity named "Door" under the cursor
   * (There's no separate "pass a bare id" form — a bare string always
   * means name/tag, since a real id and someone's chosen entity name
   * are both just strings and can't be told apart reliably. Use the
   * EntityContext itself, e.g. from findById(id), not id alone.)
   * Shared by mouse.isOver()/mouse.clickedOn() — this.
   * isClicked/this.isPointerOver instead check ONE specific entity
   * directly via _entitiesAtPoint, without a name/tag search, since
   * they already know which entity they are.
   * @param {string|object} nameOrTagOrEntity  name/tag string, or an EntityContext
   * @param {{byTag?:boolean}} [opts]
   * @returns {object|null} EntityContext, or null
   */
  _entityUnderMouse(nameOrTagOrEntity, opts) {
    opts = opts || {};
    var hits = this._entitiesAtPoint(this._mouse.x, this._mouse.y);
    // EntityContext form: skip name/tag matching, just look for that
    // EXACT entity among the hits (via its stable, never-reused id —
    // see EntityContext's `id` getter for why this can never
    // accidentally match a different entity).
    var isEntityForm = !!(nameOrTagOrEntity && nameOrTagOrEntity._entity);
    var targetId = isEntityForm ? nameOrTagOrEntity._entity.id : null;
    for (var i = 0; i < hits.length; i++) {
      var entity = hits[i]._entity;
      var matches = isEntityForm
        ? entity.id === targetId
        : (opts.byTag ? entity.tag === nameOrTagOrEntity : entity.name === nameOrTagOrEntity);
      if (matches) return hits[i];
    }
    return null;
  }

  /**
   * Touch equivalent of _entityUnderMouse just above — same lookup
   * (name/tag string, OR an EntityContext for an exact, unambiguous
   * match), but checked against EVERY currently active finger (not a
   * single cursor position), since more than one finger can be on
   * screen at once. Returns the first matching hit found.
   * @param {string|object} nameOrTagOrEntity  name/tag string, or an EntityContext
   * @param {{byTag?:boolean, justStarted?:boolean}} [opts] justStarted
   *   restricts the check to fingers that touched down THIS frame —
   *   used by touch.tappedOn()/this.isTapped so a finger merely resting
   *   on the entity doesn't count as tapping it every single frame.
   * @returns {object|null} EntityContext, or null
   */
  _entityUnderTouch(nameOrTagOrEntity, opts) {
    opts = opts || {};
    var isEntityForm = !!(nameOrTagOrEntity && nameOrTagOrEntity._entity);
    var targetId = isEntityForm ? nameOrTagOrEntity._entity.id : null;
    for (var t of this._touches.values()) {
      if (opts.justStarted && !this._touchesStarted.has(t.id)) continue;
      var hits = this._entitiesAtPoint(t.x, t.y);
      for (var i = 0; i < hits.length; i++) {
        var entity = hits[i]._entity;
        var matches = isEntityForm
          ? entity.id === targetId
          : (opts.byTag ? entity.tag === nameOrTagOrEntity : entity.name === nameOrTagOrEntity);
        if (matches) return hits[i];
      }
    }
    return null;
  }

  /**
   * Real shape-accurate raycast against the live Rapier physics world.
   * Thin wrapper over _physicsRaycastFn (wired to PhysicsWorld.castRay
   * by createGame — see runtime/index.js), same pairing as
   * _entitiesAtPoint/_physicsHitTestFn just above. Exposed to scripts as
   * physics.raycast(x1,y1,x2,y2,opts) — see the doc comment on that
   * global in getGlobals() for the full opts.layerMask/opts.debug
   * behavior from a script author's point of view.
   *
   * @param {number} x1 @param {number} y1 ray start (world space)
   * @param {number} x2 @param {number} y2 ray end (world space)
   * @param {{ layerMask?: number, debug?: boolean }} [opts]
   * @returns {{ entity:object, point:{x,y}, normal:{x,y}|null, distance:number }|null}
   */
  _raycast(x1, y1, x2, y2, opts) {
    opts = opts || {};

    // Build a Set of entity IDs to exclude. opts.exclude is an array of
    // EntityContext objects (e.g. [this, find("Wall")]) — each carries
    // ._entity.id, the internal string ID used by _colliderHandleMap.
    var excludeEntityIds = null;
    if (opts.exclude && opts.exclude.length > 0) {
      excludeEntityIds = new Set();
      for (var i = 0; i < opts.exclude.length; i++) {
        var ex = opts.exclude[i];
        if (ex && ex._entity && ex._entity.id != null) {
          excludeEntityIds.add(ex._entity.id);
        }
      }
    }

    var hit = null;
    if (this._physicsRaycastFn) {
      hit = this._physicsRaycastFn(x1, y1, x2, y2, {
        layerMask: opts.layerMask,
        excludeEntityIds: excludeEntityIds,
      });
    }

    if (opts.debug) {
      // Drawn as a laser beam: the line ends at the hit point (if any),
      // not at the original endpoint — so it looks like a beam that stops
      // at the surface. No separate dot; the cut-off tip IS the indicator.
      // Red = missed, green = hit. NOT cleared here — cleared by the
      // renderer (renderDebugLines in play-popup.js / player/main.js)
      // after drawing, once per frame.
      this.debugState.debugLines.push({
        x1: x1, y1: y1,
        endX: hit ? hit.point.x : x2,
        endY: hit ? hit.point.y : y2,
        color: hit ? 0x00ff00 : 0xff3333,
      });
    }

    if (!hit) return null;
    var entity = this.world.getEntity(hit.entityId);
    return {
      entity: entity ? this.createEntityContext(entity) : null,
      point: hit.point,
      normal: hit.normal,
      distance: hit.distance,
    };
  }

  /**
   * Thin wrapper over _navFindPathFn (wired to NavWorldSystem.findPath
   * by createGame — see runtime/index.js). Exposed to scripts as
   * nav.findPath(x1,y1,x2,y2,opts) — see the doc comment on that global
   * in getGlobals() for the full opts.debug behavior from a script
   * author's point of view. Debug drawing reuses debugState.debugLines
   * (the same queue physics.raycast(...,{debug:true}) feeds) so a
   * script that turns BOTH on at once sees a consistent visual
   * language — green segments for a found path, same as a raycast hit —
   * rather than a second unrelated debug-drawing convention.
   * @param {number} x1 @param {number} y1 start (world space)
   * @param {number} x2 @param {number} y2 goal (world space)
   * @param {{ debug?: boolean, radius?: number, area?: number }} [opts]
   *   radius: agent clearance in world units against the shared
   *     NavWorld2D (default 0 — the base unpadded layer). Pass a
   *     NavAgent2D's radius for a path that actually respects that
   *     agent's size — this.navMoveToward() does this automatically.
   *   area: bitmask of allowed NavWorld2D area slots (default 0xffff —
   *     every area allowed), same model as Unity's NavMeshAgent.
   *     areaMask. A route will never cross a cell whose area isn't in
   *     this mask. Pass a NavAgent2D's area for a path that respects
   *     that agent's restrictions — this.navMoveToward() does this
   *     automatically.
   * Options are defined by NAV_API_OPTION_FIELDS.findPath so runtime docs
   * and editor `{ ... }` completion share one source of truth.
   * @returns {{x:number,y:number}[]|null}
   */
  _findNavPath(x1, y1, x2, y2, opts) {
    opts = opts || {};
    var radius = Number.isFinite(opts.radius) ? Math.max(0, opts.radius) : 0;
    var area = Number.isFinite(opts.area) ? (opts.area & 0xffff) : 0xffff;
    var path = this._navFindPathFn ? this._navFindPathFn(x1, y1, x2, y2, radius, area) : null;

    if (opts.debug && path && path.length > 1) {
      for (var i = 0; i < path.length - 1; i++) {
        this.debugState.debugLines.push({
          x1: path[i].x, y1: path[i].y,
          endX: path[i + 1].x, endY: path[i + 1].y,
          color: 0x00ff00,
        });
      }
    }

    return path;
  }

  /**
   * Records this entity's current navMoveToward() goal for
   * NavAgent2D "collab" grouping (see EntityContext._applyNavCollab()).
   * Called every navMoveToward() invocation, even when this agent ends
   * up ungrouped, so a SECOND agent that starts converging on the same
   * point a moment later can still discover this one.
   * @param {string} entityId
   * @param {number} x @param {number} y
   */
  _publishNavGoal(entityId, x, y) {
    this._navGoals.set(entityId, { x: x, y: y, time: this.time.elapsed });
  }

  /**
   * Looks up another entity's most recently published nav goal for
   * collab grouping, or null if it never published one or its entry has
   * gone stale (see _NAV_GOAL_STALE_SECONDS below — an agent that
   * stopped calling navMoveToward this many seconds ago no longer
   * counts as "currently converging on something", so it can't keep a
   * group slot reserved indefinitely).
   * @param {string} entityId
   * @returns {{x:number,y:number}|null}
   */
  _peekNavGoal(entityId) {
    var entry = this._navGoals.get(entityId);
    if (!entry) return null;
    if (this.time.elapsed - entry.time > ScriptAPI._NAV_GOAL_STALE_SECONDS) {
      this._navGoals.delete(entityId);
      return null;
    }
    return entry;
  }

  /**
   * Returns the global API object passed as function parameters to
   * each compiled script. Called once per script at compile time.
   */
  getGlobals() {
    var self = this;
    return {
      // Note: bare `find(name)` was removed — it was an exact duplicate
      // of findFirst(name) (same lookup, same single-entity-or-null
      // return). Use findFirst() instead; it pairs with findAll() the
      // same way findFirstWithTag() pairs with findAllWithTag().
      findWithTag: function (tag) { return self.findWithTag(tag); },
      // Explicit first/all pair for both name and tag lookups — see the
      // doc comments on ScriptAPI.findFirst/findAll/findFirstWithTag/
      // findAllWithTag above for what each returns.
      findFirst: function (name) { return self.findFirst(name); },
      findAll: function (name) { return self.findAll(name); },
      findFirstWithTag: function (tag) { return self.findFirstWithTag(tag); },
      findAllWithTag: function (tag) { return self.findAllWithTag(tag); },
      // Unlike the name/tag lookups above, findById NEVER has an
      // ambiguity problem — see EntityContext's `id` getter and
      // ScriptAPI.findById's doc comments for why an id is reliable
      // where a name or tag might not be.
      findById: function (id) { return self.findById(id); },
      findInRadius: function (x, y, radius, opts) { return self.findInRadius(x, y, radius, opts); },
      scene: {
        findWithTag: function (tag) { return self.findWithTag(tag); },
        findFirst: function (name) { return self.findFirst(name); },
        findAll: function (name) { return self.findAll(name); },
        findFirstWithTag: function (tag) { return self.findFirstWithTag(tag); },
        findAllWithTag: function (tag) { return self.findAllWithTag(tag); },
        findById: function (id) { return self.findById(id); },
        load: function (sceneName) {
          if (self._loadSceneFn) {
            self._loadSceneFn(sceneName);
          } else if (typeof console !== "undefined") {
            console.log("[ScriptAPI] scene.load('" + sceneName + "') — no scene manager available");
          }
        },
        restart: function () {
          if (self._restartFn) {
            self._restartFn();
          } else if (typeof console !== "undefined") {
            console.log("[ScriptAPI] scene.restart() — no scene manager available");
          }
        },
        /**
         * Freezes gameplay: physics, scripts (including this one's own
         * onUpdate — the pause takes effect starting next frame, not
         * mid-call), animation, and audio all stop advancing. Rendering
         * and the editor/Play window itself stay fully responsive — this
         * is a gameplay pause, not tab-out/suspend. Call scene.resume()
         * to continue exactly where it left off.
         *   Example — pause menu:
         *   if (input.keyPressed("Escape")) { scene.pause(); showPauseMenu(); }
         */
        pause: function () {
          if (self._pauseFn) {
            self._pauseFn();
          } else if (typeof console !== "undefined") {
            console.log("[ScriptAPI] scene.pause() — no game loop available");
          }
        },
        /** Resumes gameplay after scene.pause(). Safe to call even if not currently paused. */
        resume: function () {
          if (self._resumeFn) {
            self._resumeFn();
          } else if (typeof console !== "undefined") {
            console.log("[ScriptAPI] scene.resume() — no game loop available");
          }
        },
        /** True while gameplay is frozen by scene.pause(). Read-only. */
        get isPaused() {
          return self._isPausedFn ? self._isPausedFn() : false;
        },
      },
      physics: {
        /**
         * Casts a ray from (x1,y1) to (x2,y2) against real Rapier
         * collider shapes and returns the CLOSEST hit, or null.
         *
         *   raycast(x1, y1, x2, y2)
         *   raycast(x1, y1, x2, y2, { exclude: [this] })
         *   raycast(x1, y1, x2, y2, { exclude: [this, find("Wall")] })
         *   raycast(x1, y1, x2, y2, { debug: true })
         *
         * opts.exclude — array of entity objects to skip entirely.
         *   Pass [this] to ignore the caster's own collider (the most
         *   common use). Pass [this, find("Shield")] to skip multiple.
         *   Triggers (isTrigger=true colliders) are always skipped
         *   regardless of this option.
         *
         * opts.debug — draws the ray as a laser beam for one frame:
         *   green and cut at the hit point if it hit, red full-length
         *   if it missed. Call debug.show() once (e.g. in onStart) to
         *   make the overlay visible.
         *
         * Returns { entity, point:{x,y}, normal:{x,y}|null, distance }
         * or null. entity is the same shape as find() / this.
         */
        raycast: function (x1, y1, x2, y2, opts) {
          return self._raycast(x1, y1, x2, y2, opts);
        },
        /**
         * Builds a layerMask bitmask from one or more layer indices
         * (0-15), for use as physics.raycast(...)'s opts.layerMask —
         *   physics.raycast(x1, y1, x2, y2, { layerMask: physics.layer(2, 3) })
         * hits ONLY colliders on layers 2 and 3, ignoring everything else.
         */
        layer: function () {
          var mask = 0;
          for (var i = 0; i < arguments.length; i++) {
            var n = arguments[i] | 0;
            if (n >= 0 && n <= 15) mask |= (1 << n);
          }
          return mask;
        },
      },
      /**
       * Pathfinding over the scene's baked/painted NavWorld2D (see
       * components/NavWorld2D.js and the Nav tool in the Scene view).
       * Uses the FIRST NavWorld2D entity in the scene — see this
       * global's individual method docs and NavWorldSystem.js's
       * one-per-scene convention note. All methods no-op safely (return
       * null/false) if the scene has no NavWorld2D entity yet, same
       * "missing wiring degrades gracefully" behavior physics.raycast()
       * has before physics finishes loading.
       */
      nav: {
        /**
         * Finds a walkable path from (x1,y1) to (x2,y2) across the
         * scene's NavWorld2D, snapping each endpoint to the nearest
         * walkable cell if it doesn't land exactly on one.
         *
         *   nav.findPath(x1, y1, x2, y2)
         *   nav.findPath(x1, y1, x2, y2, { debug: true })
         *   nav.findPath(x1, y1, x2, y2, { radius: 24 })
         *   nav.findPath(x1, y1, x2, y2, { area: (1 << 0) | (1 << 4) })
         *
         * Returns an array of { x, y } WORLD-space waypoints from start
         * to goal inclusive, or null if no path exists (goal
         * unreachable, or no NavWorld2D in the scene). Waypoints are one
         * per grid cell the path passes through a turn at — NOT one
         * per grid cell crossed (straight runs are merged) — so this is
         * cheap enough to call every frame for a single agent, but for
         * many agents prefer calling it once (e.g. in onStart or when
         * the target changes) and walking the returned array over
         * several frames instead of re-pathing every tick.
         *
         * opts.debug — draws the path as a chain of green segments for
         * one frame, same visual language as physics.raycast's debug
         * beam. Call debug.show() once to make the overlay visible.
         *
         * opts.radius — agent clearance in world units against the
         * shared NavWorld2D (default 0, the base unpadded layer). A
         * narrow passage the base layer allows can become unwalkable at
         * a larger radius — that's the same per-agent-size pipeline
         * this.navMoveToward() uses automatically from a NavAgent2D
         * component; pass it here directly for manual path queries.
         *
         * opts.area — bitmask of allowed NavWorld2D area slots (default
         * 0xffff, every area allowed), same model as Unity's
         * NavMeshAgent.areaMask: a route will NEVER cross a cell whose
         * area bit isn't in this mask, no matter how short a shortcut it
         * would be. See editor/state/NavAreas.js (Edit > Nav Areas…) for
         * naming slots, and NavWorld2D.areaCosts for the separate SOFT
         * per-area cost preference (e.g. "prefer roads over mud") that
         * applies only to areas already allowed by this mask.
         *
         * A returned path does NOT smooth into a single straight line
         * across open areas — it follows the grid, so a path through a
         * wide-open room will look like a staircase of cell-sized
         * segments rather than one diagonal line. Move an agent through
         * each waypoint in order (e.g. with mathx.moveToward) for
         * correct obstacle-avoiding movement.
         */
        findPath: function (x1, y1, x2, y2, opts) {
          return self._findNavPath(x1, y1, x2, y2, opts);
        },
        /**
         * True if the world-space point (x,y) falls on a walkable
         * NavWorld2D cell. False for a blocked cell, a cell outside the
         * baked/painted area, or if the scene has no NavWorld2D.
         */
        isWalkable: function (x, y) {
          return self._navIsWalkableFn ? self._navIsWalkableFn(x, y) : false;
        },
        /**
         * Re-bakes the scene's NavWorld2D from every Collider2D
         * currently in the world (same operation as the Inspector's
         * "Bake Nav World" button). Returns { walkable, blocked } cell
         * counts, or null if the scene has no NavWorld2D entity. Most
         * games bake once in the editor and never call this — it's here
         * for levels that spawn their own obstacles procedurally at
         * runtime and need the NavWorld2D to reflect that afterward.
         */
        bake: function () {
          return self._navBakeFn ? self._navBakeFn() : null;
        },
      },
      /**
       * Send a message to script instances on entities matching the
       * first argument. Accepts EITHER a tag string — messages EVERY
       * entity with that tag, a group broadcast — OR an EntityContext
       * directly, which messages that ONE exact entity only, with no
       * ambiguity even if other entities share its tag. Scripts that
       * define `onMessage(message, sender, data)` will be called
       * immediately.
       *   sendMessage("Enemy", "takeDamage", { amount: 10 })       // every entity tagged "Enemy"
       *   sendMessage(oneEnemy, "takeDamage", { amount: 10 })      // just that one entity, e.g. from findById()/spawn()
       */
      sendMessage: function(tagOrEntity, message, data) {
        if (self._sendMessageFn) self._sendMessageFn(tagOrEntity, message, data);
      },
      /**
       * Broadcast a message to ALL entities in the scene. Every script
       * instance that defines `onMessage(message, sender, data)` will be
       * called.
       *   broadcastMessage("gameOver", { winner: "Player" })
       */
      broadcastMessage: function(message, data) {
        if (self._broadcastMessageFn) self._broadcastMessageFn(message, data);
      },
      /**
       * Spawns a runtime clone of an existing entity — Unity's
       * Object.Instantiate(). Looks the source up by NAME by default:
       *   spawn("Bullet")
       *   spawn("Bullet", { x: this.x, y: this.y })
       * Pass byTag to look up by tag instead (clones the FIRST match):
       *   spawn("Enemy", { byTag: true, x: 200, y: 100 })
       * Optionally rename the clone with `name`. Returns an
       * EntityContext for the new entity (same shape as `this` — .x,
       * .sprite, .rigidbody, etc.), or null if no source entity exists
       * with that name/tag. The clone's own onClone()/onStart() fire
       * automatically on the next frame, with this.isClone === true.
       */
      spawn: function (nameOrTag, opts) {
        return self.spawn(nameOrTag, opts);
      },
      /**
       * Runs `callback` once, after `seconds` of game time — a simple
       * beginner-friendly timer. `this` inside the callback is the SAME
       * entity that called wait(), exactly like onUpdate:
       *   function onStart() {
       *     wait(3, function () {
       *       this.visible = false;
       *     });
       *   }
       * Timers are automatically cancelled if their entity is destroyed,
       * or if the scene restarts/switches before they fire — a wait()
       * never fires "late" against a scene that's already gone.
       * Returns a timer id you can optionally pass to cancelWait(id) to
       * stop it early:
       *   var id = wait(5, function () { this.destroy(); });
       *   // later, e.g. if the player does something that cancels it:
       *   cancelWait(id);
       */
      wait: function (seconds, callback) {
        return self._waitFn ? self._waitFn(seconds, callback) : -1;
      },
      /**
       * Cancels a pending wait() timer before it fires. Safe to call
       * with an id that already fired or was already cancelled (does
       * nothing in either case).
       *   var id = wait(3, function () { ... });
       *   cancelWait(id);
       */
      cancelWait: function (timerId) {
        if (self._cancelWaitFn) self._cancelWaitFn(timerId);
      },
      /**
       * Runs `callback` every `seconds`, forever — the beginner-friendly
       * way to do repeating actions without writing a self-rescheduling
       * wait() by hand:
       *   function onStart() {
       *     repeat(2, function () {
       *       spawn("Enemy", { x: random.int(0, 800), y: 0 });
       *     });
       *   }
       * The first call happens `seconds` from now, then every `seconds`
       * after that, forever, until you call cancelRepeat(id), the
       * entity is destroyed, or the scene restarts/switches — same
       * auto-cancellation as wait(). There's no separate "forever loop"
       * construct in this engine: onUpdate() already runs every frame
       * for as long as the entity exists, and repeat() covers "do this
       * every N seconds" — an actual while(true) would freeze the game,
       * since scripts run synchronously with no pause point mid-frame.
       * Returns a timer id for cancelRepeat(id).
       */
      repeat: function (seconds, callback) {
        return self._repeatFn ? self._repeatFn(seconds, callback) : -1;
      },
      /**
       * Stops a repeat() before its next fire. Safe to call with an id
       * that was already cancelled (does nothing).
       *   var id = repeat(1, function () { ... });
       *   cancelRepeat(id);
       */
      cancelRepeat: function (timerId) {
        if (self._cancelRepeatFn) self._cancelRepeatFn(timerId);
      },
      input: {
        keyDown: function (key) { return self._keysDown.has(key); },
        keyPressed: function (key) { return self._keysPressed.has(key); },
      },
      /**
       * Mouse position + buttons. x/y are WORLD coordinates — the same
       * space this.x/this.y use — so you can compare them directly:
       *   function onUpdate() {
       *     this.x = mouse.x; // sprite follows the cursor
       *   }
       * screenX/screenY are raw canvas-pixel coordinates instead (0,0
       * at the top-left of the game view), for UI-style code that
       * doesn't care about the world/camera at all.
       * down()/pressed()/released() take a button number: 0 = left,
       * 1 = middle, 2 = right (same numbering the browser itself uses).
       * pressed()/released() are true for exactly the one frame the
       * button changed state, same as input.keyPressed().
       */
      mouse: {
        get x() { return self._mouse.x; },
        get y() { return self._mouse.y; },
        get screenX() { return self._mouse.screenX; },
        get screenY() { return self._mouse.screenY; },
        /** True while the cursor is anywhere over the game screen. */
        get over() { return self._mouse.over; },
        down: function (button) { return self._mouse.buttonsDown.has(button === undefined ? 0 : button); },
        pressed: function (button) { return self._mouse.buttonsPressed.has(button === undefined ? 0 : button); },
        released: function (button) { return self._mouse.buttonsReleased.has(button === undefined ? 0 : button); },
        /**
         * True if the mouse is currently over the given entity — real
         * shape-accurate hit-testing (matches a circle collider as a
         * circle, not its bounding box), same query this.isPointerOver
         * uses for "this" entity specifically. Accepts a name/tag
         * string (the original form — matches the FIRST entity with
         * that name/tag, which can be the wrong one if several share
         * it) OR an EntityContext directly, for an exact, unambiguous
         * check:
         *   if (mouse.isOver("PlayButton")) { ... }        // by name
         *   if (mouse.isOver(door)) { ... }                 // door from findFirst()/findById()/etc — checks that EXACT entity
         */
        isOver: function (nameOrTagOrEntity, opts) {
          return self._entityUnderMouse(nameOrTagOrEntity, opts) !== null;
        },
        /**
         * True the SAME FRAME the given button was pressed while the
         * cursor was over the given entity — the "I clicked this
         * specific thing" check, combining isOver() + pressed() into
         * one beginner-friendly call. Accepts a name/tag string OR an
         * EntityContext directly, same as isOver() above:
         *   if (mouse.clickedOn("PlayButton")) { scene.load("Level1"); }
         *   if (mouse.clickedOn(door)) { ... }
         * Defaults to the left mouse button (0). For "did I click
         * ANYTHING on this entity, tracked entity-side", see
         * this.isClicked instead — same underlying check, just phrased
         * as a property on the object itself rather than a global
         * lookup by name.
         */
        clickedOn: function (nameOrTagOrEntity, opts, button) {
          if (typeof opts === "number") { button = opts; opts = undefined; }
          if (!self._mouse.buttonsPressed.has(button === undefined ? 0 : button)) return false;
          return self._entityUnderMouse(nameOrTagOrEntity, opts) !== null;
        },
      },
      /**
       * Active touches for mobile/touchscreen games — one entry per
       * finger currently on the screen (plus any that just lifted this
       * frame, which appear as justEnded: true).
       *
       * PER-TOUCH SHAPE  (same for every entry in the array):
       *   id           — stable finger id, use to tell fingers apart across frames
       *   x, y         — current world-space position
       *   screenX/Y    — current canvas-pixel position
       *   startX/Y     — world-space position where this finger first touched down
       *   dx, dy       — how far it has moved from startX/Y (x - startX, y - startY)
       *   distance     — total distance from startX/Y (Math.hypot(dx, dy))
       *   justStarted  — true for exactly the one frame this finger touched down
       *   justEnded    — true for exactly the one frame this finger lifted
       *
       * ARRAY EXTRAS:
       *   touch.count          — how many fingers are touching right now
       *   touch.first          — first active touch, or null
       *   touch.anyJustStarted — true if any finger touched down this frame
       *   touch.anyJustEnded   — true if any finger lifted this frame
       *
       * GESTURE HELPERS  (recomputed fresh every frame, no setup needed):
       *   touch.swipe.active    — true when one finger has moved > 40 px from start
       *   touch.swipe.direction — 'left'|'right'|'up'|'down' (dominant axis)
       *   touch.swipe.dx/dy     — raw displacement from touch start
       *   touch.swipe.distance  — distance from touch start
       *
       *   touch.pinch.active   — true while two fingers are on screen
       *   touch.pinch.scale    — current / start distance ratio (>1 = spreading)
       *   touch.pinch.delta    — current distance minus start distance (px)
       *   touch.pinch.distance — current distance between the two fingers (px)
       *
       * TAP-ON-ENTITY HELPERS  (the touch equivalent of mouse.isOver/
       * mouse.clickedOn — checked against EVERY active finger, not just
       * one cursor position):
       *   touch.isOver(nameOrTag, opts)    — true if any finger is over that entity right now
       *   touch.tappedOn(nameOrTag, opts)  — true the one frame a finger FIRST touched down on it
       *   opts: { byTag?: boolean } — look up by tag instead of name
       * For "is a finger over/tapping THIS entity" from inside its own
       * script, see this.isTouchOver / this.isTapped instead — same
       * checks, no name/tag lookup needed.
       *
       * EXAMPLE — drag with one finger:
       *   if (touch.count > 0) { this.x = touch.first.x; }
       * EXAMPLE — swipe to jump:
       *   if (touch.swipe.active && touch.swipe.direction === 'up') { simulateJump(); }
       * EXAMPLE — pinch to zoom:
       *   if (touch.pinch.active) { this.camera.zoom = 5 / touch.pinch.scale; }
       * EXAMPLE — tap a button:
       *   if (touch.tappedOn("PlayButton")) { scene.load("Level1"); }
       */
      // See the big comment on `this._touchGlobal` in the constructor —
      // this is a direct reference to that persistent array, refreshed
      // IN PLACE every frame by _recomputeTouchGlobal() below, NOT a
      // getter. A script's `touch` local binding is set once at
      // script-compile time either way; handing out a stable reference
      // that gets mutated in place is what makes it look "live" on
      // every subsequent onUpdate() read, the same way `mouse` already
      // works via its own getters closing over `self`.
      touch: self._touchGlobal,
      time: self.time,
      random: {
        /** Random integer in [min, max] inclusive. */
        int: function (min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; },
        /** Random float in [min, max). */
        float: function (min, max) { return Math.random() * (max - min) + min; },
      },
      /**
       * Small gameplay-math helpers that plain JS `Math` doesn't provide
       * on its own. Named `mathx` (not `math`) so it reads as clearly
       * separate from both native `Math` and the engine itself — scripts
       * can still use `Math.floor`, `Math.abs`, `Math.hypot`, etc.
       * directly. These five are ADDITIONS, not wrappers, so there's no
       * overlap/duplication with native Math.
       */
      mathx: {
        /** Linear interpolation from a to b. t=0 -> a, t=1 -> b (t is not clamped, so overshoot works). */
        lerp: function (a, b, t) { return a + (b - a) * t; },
        /** Restrict value to the [min, max] range. */
        clamp: function (value, min, max) { return value < min ? min : (value > max ? max : value); },
        /** Move current toward target by at most maxDelta this call — no overshoot. Great for frame-rate-independent easing: this.x = mathx.moveToward(this.x, targetX, 200 * time.deltaTime). */
        moveToward: function (current, target, maxDelta) {
          if (Math.abs(target - current) <= maxDelta) return target;
          return current + Math.sign(target - current) * maxDelta;
        },
        /** Remap value from [inMin, inMax] into [outMin, outMax]. E.g. mathx.remap(hp, 0, 100, 0, 1) for a health-bar fill amount. */
        remap: function (value, inMin, inMax, outMin, outMax) {
          return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
        },
        /** True if a and b are within epsilon of each other (default 0.0001) — safer than === for comparing floats. */
        approximately: function (a, b, epsilon) { return Math.abs(a - b) < (epsilon === undefined ? 0.0001 : epsilon); },
      },
      global: new Proxy({}, {
        get: function (_, key) { return self._globals.get(key); },
        set: function (_, key, value) { self._globals.set(key, value); return true; },
        has: function (_, key) { return self._globals.has(key); },
      }),
      /**
       * Persistent, per-slot key/value storage backed by IndexedDB —
       * the way to make a game REMEMBER things across page refreshes
       * and browser restarts (unlike `global` above, which resets
       * every time the page reloads). See components/SaveAPI.js for
       * the full per-method docs.
       *   save.set("highScore", 4200);
       *   var best = save.get("highScore") ?? 0;
       *   save.has("checkpoint")
       *   save.delete("temporaryBuff")
       *   await save.load("slot2")   // switch save files
       */
      save: createSaveAPI(self.saveStore),
      /**
       * On-screen debug HUD, shown in the actual Play popup window (not
       * the editor Console panel). Call debug.show() from any script
       * (onStart is the usual place) to turn it on for the whole game —
       * it's global state, not per-entity, so any script can toggle it.
       *   debug.show()            — turn the HUD on, FPS counter visible
       *   debug.show(false)       — turn it off again
       *   debug.showFps(false)    — keep the HUD on but hide just the FPS line
       *   debug.log("label", val) — add/update a custom line in the HUD,
       *                              e.g. debug.log("Player HP", this.hp)
       *   debug.clear("label")    — remove a single custom line
       *   debug.clearAll()        — remove every custom line (FPS stays)
       */
      debug: {
        show: function (on) {
          const enabled = on === undefined ? true : !!on;
          self.debugState.enabled = enabled;
          // Piggyback the world's per-system profiler on the same
          // toggle — see World.js's profilingEnabled doc comment.
          // This is what backs the "SYSTEM TIMES" lines in the debug
          // HUD (see player/main.js / play-popup.js's
          // updateDebugOverlay), so a slow-frame investigation never
          // needs browser DevTools: debug.show() alone is enough to
          // see which system is actually eating the frame budget.
          if (self.world) {
            // Reset the averaging window on every OFF->ON transition
            // so a re-enabled HUD starts from a clean window instead
            // of blending in stale accumulated ms from before — see
            // World.js's resetProfiling() doc comment.
            if (enabled && !self.world.profilingEnabled) self.world.resetProfiling();
            self.world.profilingEnabled = enabled;
          }
        },
        showFps: function (on) {
          self.debugState.showFps = on === undefined ? true : !!on;
        },
        log: function (label, value) {
          self.debugState.stats.set(String(label), value);
        },
        clear: function (label) {
          self.debugState.stats.delete(String(label));
        },
        clearAll: function () {
          self.debugState.stats.clear();
        },
      },
    };
  }

  // --- Backwards-compatible methods (existing runtime/index.js uses these) ---

  findByName(name) { return this.findFirst(name); }

  findByTag(tag) { return this.findWithTag(tag); }

  setGlobal(key, value) { this._globals.set(key, value); }

  getGlobal(key) { return this._globals.has(key) ? this._globals.get(key) : undefined; }
}

/**
 * Seconds after which a published NavAgent2D collab goal (see
 * ScriptAPI._publishNavGoal/_peekNavGoal and EntityContext.
 * _applyNavCollab) is treated as abandoned. Comfortably longer than any
 * sane repathInterval so a normally-ticking agent's goal never appears
 * stale between its own navMoveToward() calls, but short enough that a
 * destroyed/disabled agent stops reserving a group slot within about a
 * second of going quiet.
 */
ScriptAPI._NAV_GOAL_STALE_SECONDS = 1;
