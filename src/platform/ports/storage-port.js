import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} StoragePortImplementation
 * @property {(key: string) => string | null} get
 * @property {(key: string, value: string) => void | Promise<void>} set
 * @property {(key: string) => void | Promise<void>} remove
 * @property {() => void | Promise<void>} clear
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Key-value persistence contract. Values remain strings or null at this boundary. */
export const STORAGE_PORT_METHODS = Object.freeze(['get', 'set', 'remove', 'clear']);

/** @param {StoragePortImplementation} implementation */
export function defineStoragePort(implementation) {
  return definePlatformPort({ name: 'storage', methods: STORAGE_PORT_METHODS }, implementation);
}
