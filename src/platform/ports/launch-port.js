/** Native launch-policy and pending-open transport contract, independent of document business logic. */
import { definePlatformPort } from './port-contract.js';
export const LAUNCH_PORT_METHODS = Object.freeze(['readContext', 'setSingleInstance', 'peek', 'acknowledge', 'subscribe']);
export function defineLaunchPort(implementation) {
  return definePlatformPort({ name: 'launch', methods: LAUNCH_PORT_METHODS, subscriptions: ['subscribe'] }, implementation);
}
