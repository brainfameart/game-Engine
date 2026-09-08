# NPC Car Human-Driver Navigation

`NavAgent2D + Car` now has a local vehicle-driving layer on top of the shared NavWorld2D path.

## What it does

- Smooth acceleration/braking through the existing Car controller.
- Speed-dependent look-ahead so the car aims beyond the next grid waypoint.
- Preview of upcoming path corners and early braking before sharp turns.
- Pure-pursuit-inspired curvature steering instead of point-at-waypoint steering.
- Steering-rate smoothing to reduce left/right twitching.
- Local physics obstacle scans in the forward, forward-left, and forward-right lanes.
- Clearer-side selection when an obstacle blocks the center line.
- Predictive obstacle braking before collision instead of waiting for a contact.
- Faster path refresh when a local obstacle persists.
- The existing committed reverse maneuver remains responsible for difficult target geometry: brake, choose a reverse side once, back around, then hand back to forward driving.
- Stuck detection based on real transform progress; a blocked car can brake, reverse, steer out, and force a fresh Nav path.
- Existing NavAgent avoidance/collaboration remain active, so local vehicle steering and multi-NPC separation work together.

## Design basis

The implementation deliberately separates global routing from vehicle control. Grid/A* answers where the road goes; the vehicle layer converts that route into a drivable look-ahead trajectory, speed plan, local obstacle response, and recovery maneuver. This follows the same broad architecture used by practical vehicle planners: path planners account for vehicle feasibility and forward/reverse motion, while path tracking uses look-ahead/curvature and speed control to follow the path smoothly.
