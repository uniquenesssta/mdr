import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} ClipboardPortImplementation
 * @property {(text: string) => Promise<boolean | void>} writeText
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Text clipboard write contract with fallback policy owned by its adapter. */
export const CLIPBOARD_PORT_METHODS = Object.freeze(['writeText']);

/** @param {ClipboardPortImplementation} implementation */
export function defineClipboardPort(implementation) {
  return definePlatformPort({ name: 'clipboard', methods: CLIPBOARD_PORT_METHODS }, implementation);
}
