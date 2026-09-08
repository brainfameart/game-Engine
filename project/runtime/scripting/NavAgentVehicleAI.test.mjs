import { World } from '../core/World.js';
import { NAV_AGENT_2D, NavAgent2D } from '../components/NavAgent2D.js';
import { createNavAgentAPI } from './components/NavAgentAPI.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const world = new World();
const entity = world.createEntity('Vehicle');
const agent = new NavAgent2D({
  vehicleLookahead: 90,
  vehicleCornerLookahead: 160,
  vehicleObstacleLookahead: 180,
  vehicleObstacleWidth: 34,
  vehicleSteerSmoothing: 8,
  vehicleSpeedSmoothing: 6,
  vehicleCornerSlowdown: 0.65,
  vehicleObstacleBrake: 1.1,
  vehicleRecoveryTime: 1.7,
  vehicleRecoveryReverseTime: 1.0,
});
entity.addComponent(NAV_AGENT_2D, agent);
const api = createNavAgentAPI(entity);

assert(api.vehicleLookahead === 90, 'vehicleLookahead should be readable');
api.vehicleLookahead = 100;
api.vehicleCornerSlowdown = 0.7;
api.vehicleObstacleBrake = 1.2;
assert(agent.vehicleLookahead === 100, 'vehicleLookahead should be writable');
assert(agent.vehicleCornerSlowdown === 0.7, 'vehicleCornerSlowdown should be writable');
assert(agent.vehicleObstacleBrake === 1.2, 'vehicleObstacleBrake should be writable');
assert(Object.prototype.hasOwnProperty.call(agent, 'vehicleRecoveryTime'), 'vehicle recovery fields should exist on NavAgent2D');
console.log('PASS: NavAgent2D human-driver vehicle settings are constructed and script-tunable');
