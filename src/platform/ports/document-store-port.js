import { definePlatformPort } from './port-contract.js';

/**
 * @typedef {Object} DocumentStorePortImplementation
 * @property {(request: object) => Promise<object>} save
 * @property {(documentId: string, uploadId: string) => Promise<unknown>} beginSnapshotUpload
 * @property {(documentId: string, uploadId: string, chunk: string, chunkIndex?: number) => Promise<unknown>} appendSnapshotChunk
 * @property {(request: object, uploadId: string) => Promise<object>} commitSnapshotUpload
 * @property {(documentId: string, uploadId: string) => Promise<unknown>} abortSnapshotUpload
 * @property {(documentId: string) => Promise<object | null>} load
 * @property {(documentId: string) => Promise<object | null>} loadManifest
 * @property {(documentId: string, byteOffset: number, maxBytes?: number) => Promise<object | null>} readChunk
 * @property {(request: object) => Promise<object | null>} search
 * @property {(documentId: string) => Promise<unknown>} remove
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Versioned document persistence and chunked snapshot transport contract. */
export const DOCUMENT_STORE_PORT_METHODS = Object.freeze([
  'save',
  'beginSnapshotUpload',
  'appendSnapshotChunk',
  'commitSnapshotUpload',
  'abortSnapshotUpload',
  'load',
  'loadManifest',
  'readChunk',
  'search',
  'remove'
]);

/** @param {DocumentStorePortImplementation} implementation */
export function defineDocumentStorePort(implementation) {
  return definePlatformPort({
    name: 'documentStore',
    methods: DOCUMENT_STORE_PORT_METHODS
  }, implementation);
}
