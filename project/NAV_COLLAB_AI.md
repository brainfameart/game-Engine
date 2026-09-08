# NavAgent2D Collaboration AI

The collaboration mode is designed as a game-style NPC pursuit system rather than a simple "move directly to the player" behavior.

## Behavior

- Moving targets are tracked from recent target movement and given a bounded look-ahead prediction.
- Paths are re-planned as the predicted target changes, so agents chase where the target is going instead of constantly following its previous position.
- Each agent keeps a separate surround slot when multiple collaboration-enabled agents converge on the same target.
- Local avoidance remains separate from pathfinding, so agents can slide around one another while still following their planned route.
- Movement toward waypoints uses acceleration/deceleration instead of snapping to a new velocity each frame.
- Final approach slows down naturally instead of overshooting and repeatedly correcting.

## Design inspiration

For the technical navigation model, this follows concepts used by engine navigation systems such as Unity NavMeshAgent and Unreal Engine navigation/avoidance: pathfinding determines a route while local avoidance adjusts motion around nearby moving agents/obstacles.

For the game-feel target, the pursuit/encounter behavior is inspired by the smooth enemy movement and positioning seen in games such as **Hollow Knight**. This is a behavior/feel reference, not copied game code.
