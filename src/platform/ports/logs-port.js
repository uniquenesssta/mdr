import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} LogsPortImplementation
 * @property {(entries: object[], batch?: object) => Promise<string|object>} writePerformance
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Debug transport: legacy path result, or explicit process-local batch receipt (not crash durability). */
export const LOGS_PORT_METHODS = Object.freeze(['writePerformance']);

/** @param {LogsPortImplementation} implementation */
export function defineLogsPort(implementation) {
  return definePlatformPort({ name: 'logs', methods: LOGS_PORT_METHODS }, implementation);
}
