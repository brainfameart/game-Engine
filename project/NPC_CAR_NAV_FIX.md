# NPC Car Navigation / Reverse Maneuver Fix

This build keeps the existing Car + NavAgent2D architecture and fixes the NPC autopilot's reverse behavior.

## What changed

- Reverse/forward selection is now a stateful maneuver instead of a frame-by-frame angle comparison.
- When a target is behind a moving car, the car brakes before changing from forward motion into reverse.
- A target directly behind the car now gets a persistent reverse steering direction so the vehicle creates an actual turning arc instead of backing straight forever.
- The reverse steering side stays locked until the reverse maneuver is complete, so a target crossing the centerline cannot make the car oscillate left/right.
- Reverse exits only after the car has rotated far enough for the target to be comfortably inside the forward-facing cone.
- The reverse-to-forward handoff is gradual: remaining reverse speed is removed before normal forward acceleration takes over.
- Forward driving now plans lower speed for large steering errors and brakes when the car is carrying too much speed into a corner, reducing the large circles/overshoot that made targets look like they were being chased incorrectly.
- `navDriveToward()` and `simulateDriveToward()` continue to use the same Car resolver, so the fix applies to both direct chase NPCs and NavAgent2D NPC cars.

## Validation

`ControllerSystem.car-autopilot.test.mjs` covers:

1. A centered-behind target creates a committed reverse turn instead of a straight reverse.
2. The reverse steering side stays stable while the target crosses the car's centerline.
3. A straight-ahead target remains in forward mode.
