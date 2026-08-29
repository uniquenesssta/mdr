import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} WebPortImplementation
 * @property {(url: string, options?: object) => Promise<string>} fetchText
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Remote text retrieval contract. Transport and proxy details remain implementation-owned. */
export const WEB_PORT_METHODS = Object.freeze(['fetchText']);

/** @param {WebPortImplementation} implementation */
export function defineWebPort(implementation) {
  return definePlatformPort({ name: 'web', methods: WEB_PORT_METHODS }, implementation);
}
