import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} LinksPortImplementation
 * @property {(url: string) => Promise<unknown>} openExternal
 * @property {(() => void | Promise<void>)=} destroy
 */

/** System-level external link opening contract. */
export const LINKS_PORT_METHODS = Object.freeze(['openExternal']);

/** @param {LinksPortImplementation} implementation */
export function defineLinksPort(implementation) {
  return definePlatformPort({ name: 'links', methods: LINKS_PORT_METHODS }, implementation);
}
