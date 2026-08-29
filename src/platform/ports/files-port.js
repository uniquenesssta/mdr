import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} FilesPortImplementation
 * @property {(path: string) => Promise<string>} readText
 * @property {(path: string, content: string, options?: object) => Promise<unknown>} writeText
 * @property {(path: string, content: Uint8Array, options?: object) => Promise<unknown>} writeBinary
 * @property {(documentPath?: string) => Promise<object>} listTextTree
 * @property {(source: string, documentPath?: string) => Promise<string>} readImage
 * @property {() => Promise<string | null>} getInitialPath
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Local file content, tree and startup-path contract without runtime-specific path types. */
export const FILES_PORT_METHODS = Object.freeze([
  'readText',
  'writeText',
  'writeBinary',
  'listTextTree',
  'readImage',
  'getInitialPath'
]);

/** @param {FilesPortImplementation} implementation */
export function defineFilesPort(implementation) {
  return definePlatformPort({ name: 'files', methods: FILES_PORT_METHODS }, implementation);
}
