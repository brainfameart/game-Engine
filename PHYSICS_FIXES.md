# Physics Fixes Included in This Launcher

This launcher contains the latest HubLauncher physics project with the following kinematic/dynamic fixes:

- Kinematic bodies can reliably push Dynamic bodies while standing on a grounded platform.
- Kinematic-to-Dynamic push strength is load-aware so grounded stacks do not become artificially immovable because of a fixed push-acceleration cap.
- Push direction is derived more robustly from the actual contact geometry, reducing left/right asymmetry when approaching a Dynamic from opposite sides.
- Kinematic bodies do not become stuck on Dynamic bodies that are pinned against walls; wall/pinned escape handling is preserved.
- Grounded and airborne kinematic-vs-dynamic jump/platform interactions are preserved.
- Rotated Dynamic bodies are covered by regression tests, including Dynamics that are allowed to rotate/tumble while being pushed.
- Rotated Dynamic pushes are checked from both directions on grounded platforms.
- Regression coverage checks for invalid positions/velocities/angular velocities during rotated pushes.
- Existing physics regression coverage is retained.
- Local Rapier 2D 0.20.0 assets remain packaged with the project; the launcher does not fall back to a CDN.

The project architecture was preserved; these changes target the kinematic/dynamic interaction and regression coverage rather than replacing the physics engine.

- Custom Kinematic Geometry-style scripts can rotate the real collider in mid-air and snap to the nearest 90° on landing without the one-frame support pop/vibration caused by the collider's contact margin.
- Grounded scripted Kinematic rotation is re-seated around its real support contact during the script phase, keeping Transform and Rapier in sync before the frame renders.
- Resting Kinematic contact-margin tolerance no longer treats a sub-half-pixel Rapier shape-contact margin as a real penetration, preventing tiny landing/corner oscillations.
- Added `player/example-scripts/GeometryDashKinematicCustom.js` for Movement Type = None custom Geometry-style movement.
