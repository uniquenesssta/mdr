import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} PrintPortImplementation
 * @property {() => void | Promise<void>} print
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Current-document print contract. */
export const PRINT_PORT_METHODS = Object.freeze(['print']);

/** @param {PrintPortImplementation} implementation */
export function definePrintPort(implementation) {
  return definePlatformPort({ name: 'print', methods: PRINT_PORT_METHODS }, implementation);
}
