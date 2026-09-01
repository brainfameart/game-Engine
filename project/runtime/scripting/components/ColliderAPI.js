/**
 * runtime/scripting/components/ColliderAPI.js
 *
 * The `this.collider` sub-object exposed to user scripts. Collider settings
 * remain plain component data; this file only provides a safe live view of
 * the settings that are useful to gameplay scripts.
 *
 * RUNTIME-ONLY FILE.
 */

import { COLLIDER_2D } from "../../components/Collider2D.js";

function _tag(err, kind) {
  err.kind = kind;
  return err;
}

function _requireCollider(entity) {
  const collider = entity.getComponent(COLLIDER_2D);
  if (!collider) {
    throw _tag(new Error(
      "'" + (entity.name || "Entity") + "' called this.collider but has no Collider 2D. " +
      "Add one in the Inspector (Add Component → Collider 2D)."
    ), "missing-component");
  }
  return collider;
}

const COLLIDER_MEMBERS = new Set([
  "shape", "width", "height", "radius", "capsuleHalfHeight",
  "capsuleRadius", "offset", "isTrigger", "friction", "restitution",
  "density", "layer", "mask", "isColliding",
]);

export function createColliderAPI(entity, scriptApi) {
  const target = {
    get shape() { return _requireCollider(entity).shape; },
    get width() { return _requireCollider(entity).width; },
    get height() { return _requireCollider(entity).height; },
    get radius() { return _requireCollider(entity).radius; },
    get capsuleHalfHeight() { return _requireCollider(entity).capsuleHalfHeight; },
    get capsuleRadius() { return _requireCollider(entity).capsuleRadius; },
    get offset() {
      const c = _requireCollider(entity);
      return { x: c.offsetX, y: c.offsetY };
    },
    get isTrigger() { return !!_requireCollider(entity).isTrigger; },
    get friction() { return _requireCollider(entity).friction; },
    get restitution() { return _requireCollider(entity).restitution; },
    get density() { return _requireCollider(entity).density; },
    get layer() { return _requireCollider(entity).layer; },
    get mask() { return _requireCollider(entity).mask; },
    /**
     * True if this entity's collider is CURRENTLY touching a SOLID
     * collider — same "still in contact right now" state
     * onCollisionStay fires from, just readable on demand instead of
     * waiting for the next Stay callback. Two forms:
     *   this.collider.isColliding()        // touching ANYTHING right now?
     *   this.collider.isColliding(other)   // touching THIS specific entity?
     * ('other' is an EntityContext, e.g. from onCollisionEnter(other) or
     * findFirst(...) — same object every other collision-related API
     * hands you.) Only reflects SOLID collisions, same as onCollision*
     * — a pure trigger overlap always reads false here; check
     * onTriggerEnter/onTriggerExit for those instead.
     */
    isColliding(other) {
      if (!scriptApi || !scriptApi._isCollidingFn) return false;
      var otherId = other && other._entity ? other._entity.id : undefined;
      return scriptApi._isCollidingFn(entity.id, otherId);
    },
  };

  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === "symbol" || prop === "then") return t[prop];
      const key = String(prop);
      if (!(key in t) && !COLLIDER_MEMBERS.has(key)) {
        throw _tag(new Error(
          "this.collider." + key + " does not exist. Check the spelling — " +
          "valid members are: " + Array.from(COLLIDER_MEMBERS).join(", ") + "."
        ), "unknown-api");
      }
      const v = t[key];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(_t, prop) {
      const key = String(prop);
      throw _tag(new Error(
        "this.collider." + key + " is read-only — change Collider 2D settings in the Inspector."
      ), "unsupported-body-type");
    },
  });
}
