import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} LogsPortImplementation
 * @property {(entries: object[]) => Promise<string>} writePerformance
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Durable performance-log transport contract. */
export const LOGS_PORT_METHODS = Object.freeze(['writePerformance']);

/** @param {LogsPortImplementation} implementation */
export function defineLogsPort(implementation) {
  return definePlatformPort({ name: 'logs', methods: LOGS_PORT_METHODS }, implementation);
}
