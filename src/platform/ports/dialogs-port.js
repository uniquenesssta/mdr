import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} DialogsPortImplementation
 * @property {(options?: object) => Promise<string | null>} openFile
 * @property {(options?: object) => Promise<string | null>} openDirectory
 * @property {(preferredName: string, options?: object) => Promise<string | null>} saveFile
 * @property {(message: string, options?: object) => Promise<boolean>} confirm
 * @property {(() => void | Promise<void>)=} destroy
 */

/** User file, directory, save and confirmation dialog contract. Cancellation resolves normally. */
export const DIALOGS_PORT_METHODS = Object.freeze([
  'openFile',
  'openDirectory',
  'saveFile',
  'confirm'
]);

/** @param {DialogsPortImplementation} implementation */
export function defineDialogsPort(implementation) {
  return definePlatformPort({ name: 'dialogs', methods: DIALOGS_PORT_METHODS }, implementation);
}
