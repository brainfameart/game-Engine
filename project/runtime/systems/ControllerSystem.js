/**
 * runtime/systems/ControllerSystem.js
 *
 * Movement behaviors are engine shortcuts, not physics body replacements.
 * A Rigidbody2D keeps its selected Dynamic/Kinematic/Static type; this
 * system only computes movement intent for the existing body.
 *
 * Dynamic bodies receive target velocity input and remain fully simulated by
 * Rapier. Kinematic bodies receive a target velocity/translation and are
 * resolved by PhysicsWorld against the same Rapier collider. Static bodies
 * are never moved. No Rapier CharacterController is created here or anywhere
 * else in the engine.
 *
 * Supported controllerType values: Character Controller, Platformer,
 * Top-Down, Car, Follow, Patrol, and Free.
 *
 * RUNTIME-ONLY FILE.
 */

import { System } from "../core/System.js";
import { TRANSFORM } from "../components/Transform.js";
import { RIGIDBODY_2D, BodyType } from "../components/Rigidbody2D.js";
import { CHARACTER_CONTROLLER, ControllerType } from "../components/CharacterController.js";

const GRAVITY_Y = 980; // px/s^2 — matches PhysicsWorld.js's GRAVITY_Y. Only
// used for the KINEMATIC path (which gets none of Rapier's own gravity
// integration for free) so a gravity-enabled Kinematic controller still
// falls at a visually consistent rate. Dynamic bodies never use this —
// they get real gravity straight from Rapier via gravityScale.


// Keys this engine's default input binds to game actions (see isDown()
// calls throughout this file: ArrowLeft/Right/Up/Down, WASD, Space).
// Their default browser behavior (arrow keys and Space scroll the
// page; Space also "clicks" whatever element currently has focus) is
// suppressed ONLY for these specific codes — not blanket-blocked for
// every key — so normal browser/editor shortcuts and any text inputs
// elsewhere on the page keep working normally.
const GAME_KEY_CODES = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "KeyW", "KeyA", "KeyS", "KeyD",
  "Space",
]);

/** Tracks currently-held keys. One instance per ControllerSystem (per game). */
class InputState {
  constructor() {
    this.keys = new Set();
    /** Keys that went down THIS frame only — cleared at the start of each
     *  ControllerSystem.update() tick via tick(). Used for jump so holding
     *  Space only triggers one jump per press, not one per frame. */
    this._justPressed = new Set();
    this._onKeyDown = (e) => {
      // BUG FIX: without this, holding an arrow key or Space scrolled
      // the whole page (taking the game canvas out of view), and
      // Space could "click" a focused button/link on the page. Either
      // one can shift keyboard focus away from the game, which
      // sometimes drops the matching keyup event entirely — leaving
      // that key stuck "down" in this Set forever, i.e. a character
      // that keeps walking/jumping on its own after the key was
      // actually released. preventDefault() only for the specific
      // codes this engine binds to game actions (see GAME_KEY_CODES
      // above), so nothing else on the page is affected.
      //
      // BUG FIX 2: this listener is attached to `window` and this
      // system lives for as long as the editor's own live preview is
      // running (SceneViewport.js calls createGame() to drive it),
      // not just inside actual Play mode. That means it was ALWAYS
      // active while using the editor — including while typing in the
      // Monaco script editor. Since WASD/Space/arrows are exactly the
      // codes this handler preventDefault()s unconditionally, every
      // one of those keystrokes was swallowed before Monaco's own
      // hidden textarea ever saw them, while every other key typed
      // normally. Guard against that: skip entirely when a normal
      // text input/textarea or the Monaco editor currently has focus.
      if (InputState._isTypingTarget(e.target)) return;
      if (GAME_KEY_CODES.has(e.code)) e.preventDefault();
      // Track just-pressed: only fires once per physical key-down, not
      // repeatedly while held (browser fires repeated keydown events
      // while a key is held; skip those by checking keys first).
      if (!this.keys.has(e.code)) {
        this._justPressed.add(e.code);
      }
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => {
      if (InputState._isTypingTarget(e.target)) return;
      this.keys.delete(e.code);
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  /** Clear the just-pressed set at the start of each frame. */
  tick() {
    this._justPressed.clear();
  }

  /**
   * True when the event's target is a normal text field or Monaco's
   * own editing surface, meaning the keystroke is meant for typing —
   * not game input — and this system should get completely out of
   * its way (no preventDefault, no key tracking). Checked on both
   * keydown and keyup so a key held while focus moves in/out of a
   * text field doesn't leave a stuck entry in `keys`.
   */
  static _isTypingTarget(target) {
    if (!target) return false;
    if (/^(input|textarea)$/i.test(target.tagName)) return true;
    if (target.isContentEditable) return true;
    // Monaco's real keyboard-capturing element is a hidden textarea
    // with class "inputarea" inside .monaco-editor — some browsers
    // report its tagName oddly, so also check via closest() as a
    // belt-and-suspenders match against the editor's outer container.
    if (target.closest && target.closest(".monaco-editor")) return true;
    return false;
  }

  isDown(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** True if ANY of the given codes was pressed THIS frame (not held). */
  isJustPressed(...codes) {
    return codes.some((c) => this._justPressed.has(c));
  }

  destroy() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    this.keys.clear();
    this._justPressed.clear();
  }
}

export class ControllerSystem extends System {
  constructor() {
    super();
    this.input = new InputState();
    /** @type {Map<string, number>} entityId -> vertical velocity carried between frames (KINEMATIC path only — DYNAMIC gets real gravity from Rapier) */
    this._verticalVelocity = new Map();
    /** @type {Map<string, number>} entityId -> jumps used since last grounded */
    this._jumpsUsed = new Map();
    /** @type {Map<string, number>} entityId -> buffered jump request time remaining */
    this._jumpBuffer = new Map();
    /** @type {Map<string, number>} entityId -> seconds since a jump was launched */
    this._jumpAirTime = new Map();
    /** @type {Map<string, boolean>} entityId -> whether the current jump arc has launched */
    this._jumpHasLaunched = new Map();
    /** @type {Map<string, number>} entityId -> current forward speed (Car controller) */
    this._carSpeed = new Map();
    /** @type {Map<string, {dir:1|-1, distance:number}>} entityId -> facing
     * direction (+1 = right, -1 = left) and px walked since the last turn
     * (Patrol controller only). Runtime-only derived state, same reasoning
     * as _verticalVelocity/_jumpsUsed/_carSpeed above — not authored data,
     * so it lives here rather than on the CharacterController component
     * (RULES.txt section 4: components stay plain data). */
    this._patrolState = new Map();
    /**
     * Set by runtime/index.js so Dynamic movement can read real Rapier
     * contact state (especially ground contact) before the next simulation step.
     * @type {import('../physics/PhysicsWorld.js').PhysicsWorld|null}
     */
    this.physicsWorld = null;
  }

  // Safety multiplier on top of the physical ascent time (jumpForce / GRAVITY_Y).
  // 1.2 = 20% past the theoretical apex, giving margin for frame-rate variance
  // and the brief plateau near the top of a real jump arc.
  static POST_JUMP_LOCKOUT_SAFETY = 1.2;
  static JUMP_BUFFER_SECONDS = 0.12;
  static JUMP_MIN_AIR_TIME_SECONDS = 0.08;

  update(world, dt) {
    const entities = world.query(TRANSFORM, CHARACTER_CONTROLLER, RIGIDBODY_2D);

    // Prune per-entity movement state when controllers are destroyed mid-scene.
    // are all keyed by entityId and only ever written via .set() below —
    // resetScene() clears them on a full scene reload, but nothing
    // previously removed a single entity's entries when that specific
    // entity was destroyed mid-scene (e.g. a pooled enemy or a temporary
    // platform with a CharacterController). Over a long play session with
    // controllers spawning/despawning, all four maps grow forever. Pruned
    // here the same way RenderSystem/PhysicsWorld prune their own stale
    // per-entity maps: build the current id set, then drop anything not
    // present from every map that isn't already empty for that id.
    const liveIds = new Set();
    for (const entity of entities) liveIds.add(entity.id);
    if (this._verticalVelocity.size || this._jumpsUsed.size || this._jumpBuffer.size || this._jumpAirTime.size || this._jumpHasLaunched.size || this._carSpeed.size || this._patrolState.size) {
      for (const id of this._verticalVelocity.keys()) if (!liveIds.has(id)) this._verticalVelocity.delete(id);
      for (const id of this._jumpsUsed.keys()) if (!liveIds.has(id)) this._jumpsUsed.delete(id);
      for (const id of this._jumpBuffer.keys()) if (!liveIds.has(id)) this._jumpBuffer.delete(id);
      for (const id of this._jumpAirTime.keys()) if (!liveIds.has(id)) this._jumpAirTime.delete(id);
      for (const id of this._jumpHasLaunched.keys()) if (!liveIds.has(id)) this._jumpHasLaunched.delete(id);
      for (const id of this._carSpeed.keys()) if (!liveIds.has(id)) this._carSpeed.delete(id);
      for (const id of this._patrolState.keys()) if (!liveIds.has(id)) this._patrolState.delete(id);
    }



    for (const entity of entities) {
      const controller = entity.getComponent(CHARACTER_CONTROLLER);
      const rigidbody = entity.getComponent(RIGIDBODY_2D);

      // FREE means "fully script-driven" (see CharacterController.js's
      // doc comment) — this system does nothing at all for it, so a
      // script's own this.rigidbody calls are never fought/overridden.
      if (controller.controllerType === ControllerType.FREE) continue;
      // Static bodies never move — nothing to drive.
      if (rigidbody.bodyType === BodyType.STATIC) continue;

      const type = controller.controllerType;
      if (type === ControllerType.CAR) {
        if (controller.useDefaultInput) this._applyCar(entity, controller, rigidbody, dt);
      } else if (type === ControllerType.FOLLOW) {
        this._applyFollow(entity, controller, rigidbody, dt, world);
      } else if (type === ControllerType.PATROL) {
        this._applyPatrol(entity, controller, rigidbody, dt);
      } else if (rigidbody.bodyType === BodyType.DYNAMIC) {
        // NOTE: unlike useDefaultInput's old all-or-nothing gate, this
        // still runs even with useDefaultInput=false for Character/
        // Platformer/Top-Down — it just skips reading the keyboard
        // (see the `controller.useDefaultInput ? ... : false` reads
        // inside _applyDynamic/_applyKinematic below) so gravity and
        // controller.simulateJump() (scripting/components/
        // ControllerAPI.js) still work for a controller a script wants
        // to trigger jumps on without also taking over WASD.
        this._applyDynamic(entity.id, controller, rigidbody, dt);
      } else {
        this._applyKinematic(entity.id, controller, rigidbody, dt);
      }
    }

    // Clear just-pressed state at the END of the frame (after all controllers
    // have read it) so every isJustPressed() call this tick sees the press,
    // and it is cleared before the NEXT frame's keydown events arrive.
    // Placing tick() at the START of update() was the original bug: a keydown
    // event queued between frames would be added to _justPressed and then
    // immediately cleared before any controller could read it.
    this.input.tick();
  }

  /**
   * DYNAMIC path: seeds Rapier's velocity via the transient
   * driveVelocityX/driveVelocityY fields (consumed + cleared each step by
   * PhysicsWorld.js) instead of owning velocity outright, so gravity,
   * contact pushback, and landing on slopes all stay fully Rapier's.
   */
  _applyDynamic(entityId, controller, rigidbody, dt) {
    const useKeys = controller.useDefaultInput;
    const left = useKeys && this.input.isDown("ArrowLeft", "KeyA");
    const right = useKeys && this.input.isDown("ArrowRight", "KeyD");
    const up = useKeys && this.input.isDown("ArrowUp", "KeyW");
    const down = useKeys && this.input.isDown("ArrowDown", "KeyS");
    // A script can request a jump via this.controller.simulateJump()
    // (scripting/components/ControllerAPI.js sets requestJump=true on
    // the component); consumed here alongside the keyboard Space/ArrowUp
    // keys so all trigger the exact same jump logic/limits.
    //
    // JUMP-KEY FIX: use isJustPressed (went down THIS frame) rather than
    // isDown (held), so holding Space doesn't fire a jump every frame.
    // With isDown and maxJumps=2, holding Space would consume both jumps
    // in consecutive frames before the body had time to leave the ground,
    // making double-jump impossible and allowing infinite jumping when
    // combined with the apex grounded false-positive (see grounded fix
    // below). isJustPressed fires exactly once per physical key-down.
    // ArrowUp is added as an alternative jump key — the standard
    // Platformer convention alongside Space.
    const jumpJustPressed = useKeys && (
      this.input.isJustPressed("Space") ||
      (controller.controllerType === ControllerType.PLATFORMER && this.input.isJustPressed("ArrowUp", "KeyW"))
    );
    const jumpPressed = jumpJustPressed || controller.requestJump;
    if (jumpPressed) {
      const bufferedJumpsUsed = this._jumpsUsed.get(entityId) || 0;
      const jumpHasLaunched = this._jumpHasLaunched.get(entityId) || false;
      // Buffer an initial press before the first launch, or a legitimate extra
      // jump while maxJumps still has capacity. Once the available mid-air
      // jumps are consumed, an extra press is ignored rather than queued for
      // a later landing.
      if (!jumpHasLaunched || bufferedJumpsUsed < controller.maxJumps) {
        this._jumpBuffer.set(entityId, ControllerSystem.JUMP_BUFFER_SECONDS);
      }
    }
    controller.requestJump = false;
    const existingBuffer = this._jumpBuffer.get(entityId) || 0;
    const bufferedJump = existingBuffer > 0;
    if (existingBuffer > 0) {
      this._jumpBuffer.set(entityId, Math.max(0, existingBuffer - dt));
    }

    // A script can request movement via this.controller.simulateMove(x, y)
    // (ControllerAPI.js) — consumed here as a one-shot per-frame axis
    // request, same lifecycle as requestJump above. When present it
    // OVERRIDES the keyboard's own -1/0/1 read for that axis rather than
    // adding to it, so simulateMove(-1, 0) reliably means "move left"
    // regardless of what keys happen to be held at the same time.
    const keyMoveX = (right ? 1 : 0) - (left ? 1 : 0);
    const keyMoveY = (down ? 1 : 0) - (up ? 1 : 0);
    const moveX = controller.requestMoveX !== null ? controller.requestMoveX : keyMoveX;
    const moveY = controller.requestMoveY !== null ? controller.requestMoveY : keyMoveY;
    controller.requestMoveX = null;
    controller.requestMoveY = null;

    const targetX = moveX * controller.moveSpeed;
    // PhysicsWorld needs to know which Kinematic bodies are Platformers so
    // it can apply moving-Dynamic-platform carry only to that controller.
    rigidbody._controllerType = controller.controllerType;

    // Air control scales horizontal acceleration while the body is not in
    // contact with ground. Grounded state comes from Rapier's manifolds.
    //
    // Dynamic bodies use the actual Rapier contact manifold when physics is
    // wired. The velocity fallback exists only for isolated unit tests.

    // For a standalone ControllerSystem unit test with no PhysicsWorld wired,
    // retain the velocity fallback so the system remains usable in isolation;
    // the real engine always wires physicsWorld in runtime/index.js.
    const gravityScale = Math.max(0.05, rigidbody.gravityScale != null ? rigidbody.gravityScale : 1);
    const vy = rigidbody.velocityY;
    const velocityLooksGrounded =
      vy >= -10 * gravityScale && vy < 40 * gravityScale;

    const hasRealGroundContact = this.physicsWorld
      ? this.physicsWorld.hasGroundContact(entityId)
      : velocityLooksGrounded;

    // ControllerSystem runs BEFORE PhysicsSystem each frame. Immediately after
    // a jump, Rapier can still report the floor contact from the previous step
    // for one or more frames even though the body is already moving upward.
    // A contact alone is therefore not enough to declare a landing: an actual
    // upward velocity means this is takeoff state, not a new grounded state.
    // This uses the body's real velocity rather than an arbitrary frame/time
    // lock, so the rule remains correct at different frame rates and jump
    // strengths.
    const airTime = this._jumpAirTime.get(entityId) || 0;
    const stillTakingOff = rigidbody.velocityY < -0.001 || (airTime > 0 && airTime < ControllerSystem.JUMP_MIN_AIR_TIME_SECONDS);
    const grounded = controller.controllerType === ControllerType.TOP_DOWN
      ? true
      : (hasRealGroundContact && !stillTakingOff);
    const airborneMultiplier = grounded ? 1 : controller.airControl;
    if (controller.controllerType !== ControllerType.TOP_DOWN) {
      this._jumpAirTime.set(entityId, airTime + dt);
    }

    // Dynamic movement is just a target velocity. Rapier remains responsible
    // for collision response, sliding, gravity, impulses, and body-to-body
    // interaction. There is no manual wall correction here.
    const currentX = rigidbody.velocityX;
    const lerpT = Math.min(1, controller.acceleration * airborneMultiplier * dt);
    rigidbody.driveVelocityX = currentX + (targetX - currentX) * lerpT;

    if (controller.controllerType === ControllerType.TOP_DOWN) {
      // Top-Down has no gravity concept even on a Dynamic body — drive Y
      // directly too via the same transient channel, bypassing gravity.
      const targetY = moveY * controller.moveSpeed;
      const currentY = rigidbody.velocityY;
      rigidbody.driveVelocityY = currentY + (targetY - currentY) * lerpT;
      return;
    }

    // Character Controller / Platformer on a Dynamic body: let Rapier's
    // own gravityScale integrate falling. We only ever touch Y to apply
    // a jump impulse (a velocity kick), never to simulate gravity
    // ourselves — that would double up with Rapier's.
    // (grounded was already computed above, before the air-control lerp.)
    // Store back onto the component (same field the Kinematic sweep in
    // PhysicsWorld.js already populates) so this.controller.isGrounded
    // (see scripting/components/ControllerAPI.js) reads real state on a
    // Dynamic body too, not just Kinematic. This IS a coarser signal
    // than Kinematic's real sweep-based grounded (no isOnCeiling/
    // isOnWall/isOnSlope/groundAngle equivalent exists for Dynamic —
    // Rapier's own solver handles those contacts, this engine doesn't
    // track them per-axis for Dynamic bodies), but it's the same
    // approximation this system already used internally, just now
    // exposed instead of staying a local-only const.
    rigidbody.grounded = grounded;

    // Reset the jump allowance only on a genuine landing after the minimum
    // airborne window. This prevents a partial/stale contact on takeoff from
    // immediately resetting the jump count and allowing a second mid-air press.
    if (grounded && airTime >= ControllerSystem.JUMP_MIN_AIR_TIME_SECONDS) {
      this._jumpsUsed.set(entityId, 0);
      this._jumpHasLaunched.set(entityId, false);
    }

    if (controller.canJump && bufferedJump) {
      const jumpsUsed = this._jumpsUsed.get(entityId) || 0;
      if ((grounded || jumpsUsed < controller.maxJumps) && jumpsUsed < controller.maxJumps) {
        rigidbody.driveVelocityY = -controller.jumpForce; // negative = up (this engine is Y-down)
        this._jumpsUsed.set(entityId, jumpsUsed + 1);
        this._jumpHasLaunched.set(entityId, true);
        this._jumpBuffer.delete(entityId);
        this._jumpAirTime.set(entityId, 0);
      }
    }

  }

  /**
   * KINEMATIC path: this system owns velocity outright (Rapier applies
   * no forces to a Kinematic body), so it has to simulate its own
   * gravity/jump-arc using the same GRAVITY_Y constant PhysicsWorld.js
   * uses for Dynamic bodies, to keep the two body types feeling similar.
   */
  _applyKinematic(entityId, controller, rigidbody, dt) {
    const useKeys = controller.useDefaultInput;
    const left = useKeys && this.input.isDown("ArrowLeft", "KeyA");
    const right = useKeys && this.input.isDown("ArrowRight", "KeyD");
    const up = useKeys && this.input.isDown("ArrowUp", "KeyW");
    const down = useKeys && this.input.isDown("ArrowDown", "KeyS");
    // JUMP-KEY FIX: use isJustPressed so holding Space only triggers one
    // jump per press, matching the Dynamic path fix above. ArrowUp is also
    // accepted as an alternative jump key for Platformer (common convention).
    const jumpJustPressed = useKeys && (
      this.input.isJustPressed("Space") ||
      (controller.controllerType === ControllerType.PLATFORMER && this.input.isJustPressed("ArrowUp", "KeyW"))
    );
    const jumpPressed = jumpJustPressed || controller.requestJump;
    if (jumpPressed) {
      const bufferedJumpsUsed = this._jumpsUsed.get(entityId) || 0;
      const jumpHasLaunched = this._jumpHasLaunched.get(entityId) || false;
      if (!jumpHasLaunched || bufferedJumpsUsed < controller.maxJumps) {
        this._jumpBuffer.set(entityId, ControllerSystem.JUMP_BUFFER_SECONDS);
      }
    }
    controller.requestJump = false;
    const existingBuffer = this._jumpBuffer.get(entityId) || 0;
    const bufferedJump = existingBuffer > 0;
    if (existingBuffer > 0) {
      this._jumpBuffer.set(entityId, Math.max(0, existingBuffer - dt));
    }

    // A script can request movement via this.controller.simulateMove(x, y)
    // (ControllerAPI.js) — same one-shot lifecycle as requestJump, and
    // same override-not-add semantics as the Dynamic path above: when
    // set, it replaces the keyboard's -1/0/1 read for that axis rather
    // than combining with it.
    const keyMoveX = (right ? 1 : 0) - (left ? 1 : 0);
    const keyMoveY = (down ? 1 : 0) - (up ? 1 : 0);
    const moveX = controller.requestMoveX !== null ? controller.requestMoveX : keyMoveX;
    const moveY = controller.requestMoveY !== null ? controller.requestMoveY : keyMoveY;
    controller.requestMoveX = null;
    controller.requestMoveY = null;

    const targetX = moveX * controller.moveSpeed;
    rigidbody._controllerType = controller.controllerType;

    // AIR CONTROL FIX: controller.airControl (0-1 multiplier on
    // acceleration while airborne — see CharacterController.js's doc
    // comment, the Inspector's "Air Control" slider, and
    // ControllerAPI.js's this.controller.airControl) was previously
    // defined and fully wired everywhere EXCEPT here — this system
    // never actually read it, so every controller accelerated at full
    // ground acceleration in mid-air regardless of the slider's value.
    // Applied only for Character Controller/Platformer (their gravity
    // path, resolved a few lines below) — Top-Down has no airborne
    // concept and already returns above.
    const airborneMultiplier = rigidbody.grounded ? 1 : controller.airControl;
    const lerpT = Math.min(1, controller.acceleration * airborneMultiplier * dt);
    rigidbody.velocityX += (targetX - rigidbody.velocityX) * lerpT;

    const usesGravity =
      controller.controllerType === ControllerType.PLATFORMER
        ? true
        : controller.controllerType === ControllerType.TOP_DOWN
        ? false
        : controller.useGravity;

    if (controller.controllerType === ControllerType.TOP_DOWN) {
      const targetY = moveY * controller.moveSpeed;
      rigidbody.velocityY += (targetY - rigidbody.velocityY) * lerpT;
      return;
    }

    let vy = this._verticalVelocity.get(entityId) || 0;
    // A Kinematic script may directly assign this.rigidbody.velocityY
    // (for example `velocityY = -200` on Space). ScriptSystem runs after
    // physics, while this controller runs before physics, so without this
    // hand-off the controller's private gravity velocity would overwrite
    // the script value on the following frame. Consume the explicit script
    // value as authoritative for this tick; this is transient and never
    // serialized.
    const scriptVelocityY = rigidbody._scriptVelocityY;
    if (scriptVelocityY !== null && Number.isFinite(Number(scriptVelocityY))) {
      vy = Number(scriptVelocityY);
      rigidbody._scriptVelocityY = null;
    }
    // Ground/contact state is supplied by Rapier's actual post-step contact
    // manifolds. ControllerSystem runs before PhysicsSystem, so immediately
    // after takeoff the manifold can still describe the floor while the
    // controller's stored vertical velocity is already upward. Do not let
    // that stale contact zero the jump velocity or reset the jump allowance.
    const stillTakingOff = vy < -0.001;
    const grounded = rigidbody.grounded && !stillTakingOff;

    // A ceiling is a real contact too. Kill an upward movement request once
    // the solver/contact query says the body is touching a ceiling so the
    // next frame starts falling instead of repeatedly requesting the blocked
    // upward translation.
    if (rigidbody.isOnCeiling && vy < 0) {
      vy = 0;
    }

    const airTime = this._jumpAirTime.get(entityId) || 0;
    const scriptVelocityWasApplied = scriptVelocityY !== null && Number.isFinite(Number(scriptVelocityY));
    const effectiveGrounded = grounded && !scriptVelocityWasApplied && (airTime === 0 || airTime >= ControllerSystem.JUMP_MIN_AIR_TIME_SECONDS);
    if (effectiveGrounded) {
      vy = 0;
      const jumpsUsed = this._jumpsUsed.get(entityId) || 0;
      if (jumpsUsed > 0) this._jumpsUsed.set(entityId, 0);
      this._jumpHasLaunched.set(entityId, false);
    }
    this._jumpAirTime.set(entityId, airTime + dt);

    // Gravity is movement behavior for Kinematic bodies only; Rapier owns
    // gravity for Dynamic bodies. Grounded bodies stay at zero vertical
    // controller velocity until a jump or other explicit move occurs.
    if (!grounded && usesGravity && !scriptVelocityWasApplied) {
      vy += GRAVITY_Y * dt;
    } else if (controller.controllerType === ControllerType.CHARACTER && !scriptVelocityWasApplied) {
      // Character Controller with gravity off: vertical is direct move
      // input too (e.g. a floating/flying controller). Reuses the same
      // moveY resolved above (keyboard OR a script's simulateMove(x,y))
      // instead of re-reading up/down directly, so a scripted vertical
      // move request works here exactly like it does for horizontal.
      vy = moveY * controller.moveSpeed;
    }

    if (controller.canJump && bufferedJump) {
      const jumpsUsed = this._jumpsUsed.get(entityId) || 0;
      if ((grounded || jumpsUsed < controller.maxJumps) && jumpsUsed < controller.maxJumps) {
        vy = -controller.jumpForce;
        this._jumpsUsed.set(entityId, jumpsUsed + 1);
        this._jumpHasLaunched.set(entityId, true);
        this._jumpBuffer.delete(entityId);
        this._jumpAirTime.set(entityId, 0);
      }
    }


    this._verticalVelocity.set(entityId, vy);
    rigidbody.velocityY = vy;
  }

  /**
   * CAR controller: arcade-style car movement. Up/Down (W/S)
   * accelerate / brake-and-reverse; Left/Right (A/D) steer. Steering
   * is proportional to speed (can't turn when stopped). The car moves
   * along its own forward direction (derived from Transform rotation,
   * 0 deg = up, clockwise). Works on both Kinematic (velocityX/Y +
   * angularVelocity) and Dynamic (driveVelocityX/Y +
   * driveAngularVelocity) bodies.
   */
  _applyCar(entity, controller, rigidbody, dt) {
    const transform = entity.getComponent(TRANSFORM);
    if (!transform) return;

    const accelerate = this.input.isDown("ArrowUp", "KeyW");
    const brake = this.input.isDown("ArrowDown", "KeyS");
    const steerLeft = this.input.isDown("ArrowLeft", "KeyA");
    const steerRight = this.input.isDown("ArrowRight", "KeyD");

    let speed = this._carSpeed.get(entity.id) || 0;

    if (accelerate) {
      speed += controller.carAcceleration * dt;
    } else if (brake) {
      speed -= controller.brakeForce * dt;
    } else {
      // Natural deceleration when no throttle/brake input
      const decay = 200 * dt;
      if (speed > 0) speed = Math.max(0, speed - decay);
      else if (speed < 0) speed = Math.min(0, speed + decay);
    }
    // Clamp: full maxSpeed forward, half maxSpeed in reverse
    speed = Math.max(-controller.maxSpeed * 0.5, Math.min(controller.maxSpeed, speed));
    this._carSpeed.set(entity.id, speed);

    // Steering proportional to speed (can't turn when stopped)
    const speedFactor = Math.abs(speed) / controller.maxSpeed;
    const steer = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
    const angVel = steer * controller.turnSpeed * speedFactor;

    // Forward direction from rotation (0 deg = up, clockwise)
    const rad = (transform.rotation * Math.PI) / 180;
    const forwardX = Math.sin(rad);
    const forwardY = -Math.cos(rad);
    const vx = forwardX * speed;
    const vy = forwardY * speed;

    if (rigidbody.bodyType === BodyType.DYNAMIC) {
      rigidbody.driveVelocityX = vx;
      rigidbody.driveVelocityY = vy;
      rigidbody.driveAngularVelocity = angVel;
    } else {
      rigidbody.velocityX = vx;
      rigidbody.velocityY = vy;
      rigidbody.angularVelocity = angVel;
    }
  }

  /**
   * FOLLOW controller: moves toward a named target entity at a set
   * speed, stopping when within followDistance. Useful for simple AI
   * pursuit, escort NPCs, or camera followers. The target is looked
   * up by name every frame via World.findFirstByName.
   */
  _applyFollow(entity, controller, rigidbody, dt, world) {
    if (!controller.targetName) return;
    const target = world.findFirstByName(controller.targetName);
    if (!target) return;
    const targetTransform = target.getComponent(TRANSFORM);
    if (!targetTransform) return;

    const transform = entity.getComponent(TRANSFORM);
    if (!transform) return;

    const dx = targetTransform.x - transform.x;
    const dy = targetTransform.y - transform.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= controller.followDistance) {
      if (rigidbody.bodyType === BodyType.DYNAMIC) {
        rigidbody.driveVelocityX = 0;
        rigidbody.driveVelocityY = 0;
      } else {
        rigidbody.velocityX = 0;
        rigidbody.velocityY = 0;
      }
      return;
    }

    const vx = (dx / dist) * controller.followSpeed;
    const vy = (dy / dist) * controller.followSpeed;

    if (rigidbody.bodyType === BodyType.DYNAMIC) {
      rigidbody.driveVelocityX = vx;
      rigidbody.driveVelocityY = vy;
    } else {
      rigidbody.velocityX = vx;
      rigidbody.velocityY = vy;
    }
  }

  // After a Patrol turn, ignore wall/ledge triggers for this long
  // (seconds) before allowing another one. FIXES THE SHAKING/JITTER
  // BUG: ControllerSystem runs BEFORE PhysicsSystem each frame (same
  // ordering note as _applyDynamic/_applyKinematic above), so the very
  // frame after a turn, rigidbody.isOnWall/isOnCeiling still reflect
  // the PREVIOUS position — the body hasn't actually been swept away
  // from the wall yet. Without a cooldown, that one-frame-stale
  // isOnWall reads true again immediately, flips state.dir right back,
  // and the entity oscillates left/right every single frame instead of
  // walking away — visually a rapid shake/jitter rather than a clean
  // turn. A brief lockout gives the sweep a moment to actually move the
  // body clear of the wall before another turn can be triggered, same
  // "don't trust a contact the instant something else just changed"
  // reasoning as _applyDynamic's stillTakingOff guard.
  static PATROL_TURN_LOCKOUT = 0.15;

  /**
   * PATROL controller: by default (controller.useDefaultInput = true)
   * walks back and forth automatically, no input needed, turning
   * around whenever EITHER of these happens first:
   *   1. it touches a wall ahead (rigidbody.isOnWall)
   *   2. it has walked controller.patrolDistance px since its last turn
   * Ledge detection was deliberately left out (a separate raycast-based
   * check that was itself a source of false turns on flat ground/tile
   * seams — see the wall-jitter fix below for the same class of issue).
   * Wall + distance together is a clean, predictable combo: it walks up
   * to patrolDistance px and turns on its own, or turns sooner if it
   * actually hits something solid first.
   * Turning off useDefaultInput disables auto-walk/auto-turn entirely
   * and hands control to a script instead via
   * this.controller.simulateMove(x, y) (ControllerAPI.js) — the same
   * one-shot requestMoveX/Y channel the walk family already reads in
   * _applyDynamic/_applyKinematic, consumed and cleared here the same
   * way. Ground-based like Platformer: gravity is always on, no jump.
   * Works on both Dynamic and Kinematic bodies, same dual-path
   * convention as every other controller type in this file — Dynamic
   * seeds Rapier's gravity/velocity via driveVelocityX/Y (consumed +
   * cleared each step by PhysicsWorld.js), Kinematic simulates its own
   * gravity the same way _applyKinematic above does (reusing
   * this._verticalVelocity).
   */
  _applyPatrol(entity, controller, rigidbody, dt) {
    const transform = entity.getComponent(TRANSFORM);
    if (!transform) return;
    const entityId = entity.id;

    let state = this._patrolState.get(entityId);
    if (!state) {
      // turnLockout counts down after every turn (auto or scripted
      // direction change) — see PATROL_TURN_LOCKOUT above.
      state = { dir: 1, distance: 0, turnLockout: 0 };
      this._patrolState.set(entityId, state);
    }

    // Grounded state: same real-Rapier-contact reasoning as every other
    // path in this file (see _applyDynamic/_applyKinematic above) —
    // hasGroundContact() for Dynamic, rigidbody.grounded (populated by
    // PhysicsWorld.js's Kinematic sweep) for Kinematic.
    const isDynamic = rigidbody.bodyType === BodyType.DYNAMIC;
    const grounded = isDynamic
      ? (this.physicsWorld ? this.physicsWorld.hasGroundContact(entityId) : true)
      : !!rigidbody.grounded;

    if (state.turnLockout > 0) state.turnLockout = Math.max(0, state.turnLockout - dt);

    // Scripted flip: this.controller.flipDirection() (ControllerAPI.js).
    // Consumed here, BEFORE the auto/manual branch below, so it works
    // regardless of useDefaultInput — forces an immediate turn whether
    // Patrol is auto-walking or being driven manually via simulateMove.
    // Resets state.distance the same as any other turn (wall or
    // distance-based) so the next leg starts fresh, and sets
    // turnLockout so a wall the entity happens to be touching at the
    // same moment can't immediately flip it right back (same stale-
    // contact protection as the auto wall-turn below).
    if (controller.requestFlip) {
      state.dir = state.dir === 1 ? -1 : 1;
      state.distance = 0;
      state.turnLockout = ControllerSystem.PATROL_TURN_LOCKOUT;
    }
    controller.requestFlip = false;

    // A script can request movement via this.controller.simulateMove(x, y)
    // (ControllerAPI.js) — same one-shot per-frame axis request the walk
    // family already uses in _applyDynamic/_applyKinematic. Only read
    // when useDefaultInput is OFF, so a script driving Patrol manually
    // never fights the built-in auto-walk/auto-turn logic below; when ON,
    // any stray request is still consumed and discarded so it can't leak
    // into a later frame where useDefaultInput gets turned off.
    const useAutoWalk = controller.useDefaultInput;
    const requestedX = controller.requestMoveX;
    controller.requestMoveX = null;
    controller.requestMoveY = null; // Patrol has no vertical input concept — discard same as X

    if (!useAutoWalk) {
      // Manual mode: no auto-walk, no auto-turn (the wall check below
      // is for the built-in behavior only). Facing direction still
      // tracks the requested axis so facingDirection and any later
      // re-enable of auto-walk start from something sensible, but
      // nothing here can trigger a turn on its own.
      if (requestedX > 0) state.dir = 1;
      else if (requestedX < 0) state.dir = -1;

      const targetX = (requestedX || 0) * controller.moveSpeed;
      const lerpT = Math.min(1, controller.acceleration * (grounded ? 1 : controller.airControl) * dt);

      if (isDynamic) {
        const currentX = rigidbody.velocityX;
        rigidbody.driveVelocityX = currentX + (targetX - currentX) * lerpT;
        rigidbody.grounded = grounded;
      } else {
        rigidbody.velocityX += (targetX - rigidbody.velocityX) * lerpT;

        let vy = this._verticalVelocity.get(entityId) || 0;
        if (rigidbody.isOnCeiling && vy < 0) vy = 0;
        if (grounded) vy = 0;
        else vy += GRAVITY_Y * dt;
        this._verticalVelocity.set(entityId, vy);
        rigidbody.velocityY = vy;
      }
      return;
    }

    // TURN TRIGGER: whichever comes first — wall contact OR having
    // walked controller.patrolDistance px since the last turn. Ledge
    // detection was left out (its own raycast-based detection was a
    // separate source of false turns — see the removed code this
    // replaced), but distance + wall together is a clean, predictable
    // combo: walk up to patrolDistance px, or turn sooner if something
    // solid is hit first.
    //
    // turnLockout gate: while it's still counting down after a turn,
    // ignore isOnWall (see PATROL_TURN_LOCKOUT's comment above — this
    // is what stops the stale-contact jitter right after a turn). The
    // distance trigger is NOT gated by turnLockout — patrolDistance is
    // an intentional walk limit, not a stale-contact read, so there's
    // nothing to protect it from; state.distance is reset to 0 on every
    // turn (wall or distance) so it can't immediately re-trigger.
    const wallTurn = state.turnLockout <= 0 && rigidbody.isOnWall;
    if (wallTurn || state.distance >= controller.patrolDistance) {
      state.dir = state.dir === 1 ? -1 : 1;
      state.distance = 0;
      state.turnLockout = ControllerSystem.PATROL_TURN_LOCKOUT;
    }

    const targetX = state.dir * controller.moveSpeed;
    const lerpT = Math.min(1, controller.acceleration * (grounded ? 1 : controller.airControl) * dt);

    if (isDynamic) {
      const currentX = rigidbody.velocityX;
      rigidbody.driveVelocityX = currentX + (targetX - currentX) * lerpT;
      rigidbody.grounded = grounded;
    } else {
      rigidbody.velocityX += (targetX - rigidbody.velocityX) * lerpT;

      let vy = this._verticalVelocity.get(entityId) || 0;
      const stillTakingOff = false; // Patrol never jumps — no takeoff state to protect
      const isGrounded = grounded && !stillTakingOff;
      if (rigidbody.isOnCeiling && vy < 0) vy = 0;
      if (isGrounded) vy = 0;
      else vy += GRAVITY_Y * dt;
      this._verticalVelocity.set(entityId, vy);
      rigidbody.velocityY = vy;
    }

    // Track distance walked using actual resolved horizontal speed so a
    // stall against something that doesn't count as isOnWall (e.g. a
    // trigger, or grazing acceleration ramp-up) still can't stall the
    // distance-based turn forever.
    state.distance += Math.abs(rigidbody.bodyType === BodyType.DYNAMIC ? rigidbody.driveVelocityX || 0 : rigidbody.velocityX) * dt;
  }

  destroy() {
    this.input.destroy();
  }

  /**
   * Clears controller state that belongs to the current scene while keeping
   * the shared keyboard listeners alive for the next scene.
   */
  resetScene() {
    this._verticalVelocity.clear();
    this._jumpsUsed.clear();
    this._carSpeed.clear();
    this._patrolState.clear();
  }
}
