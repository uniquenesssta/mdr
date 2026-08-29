/**
 * Responsibility: Expose the Stage 5.1 pure document-domain contract to remaining classic callers through the existing explicit compatibility host.
 * State/side effects: Owns only one host property lifecycle; no document/session/body state.
 */
import { createDocumentRecord, pickDocumentRecordMetadata, updateDocumentRecord } from '../domain/document-record.js';
import { normalizeDocumentNativeMetadata } from '../domain/document-native-metadata.js';
import { normalizeDocumentPath } from '../domain/document-path.js';
import { normalizeDocumentTitle } from '../domain/document-title.js';
import { createRecentFileEntry, normalizeRecentFilePath } from '../domain/recent-file-entry.js';

const PORT_NAME = 'markdownEditorDocumentDomainPort';

export function mountClassicDocumentDomainPort(host) {
  if (!host || typeof host !== 'object') throw new TypeError('Document domain compatibility host is required.');
  if (host[PORT_NAME]) throw new Error('Document domain compatibility port is already mounted.');
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Document domain compatibility port has been destroyed.');
  };
  const api = Object.freeze({
    createRecord(input, options) {
      assertActive();
      return createDocumentRecord(input, options);
    },
    updateRecord(source, patch, options) {
      assertActive();
      return updateDocumentRecord(pickDocumentRecordMetadata(source), patch, options);
    },
    normalizeTitle(value, fallbackTitle) {
      assertActive();
      return normalizeDocumentTitle(value, fallbackTitle);
    },
    normalizePath(value) {
      assertActive();
      return normalizeDocumentPath(value);
    },
    normalizeRecentPath(value) {
      assertActive();
      return normalizeRecentFilePath(value);
    },
    normalizeNativeMetadata(value) {
      assertActive();
      return normalizeDocumentNativeMetadata(value);
    },
    createRecentFileEntry(input, options) {
      assertActive();
      return createRecentFileEntry(input, options);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });
  host[PORT_NAME] = api;
  return api;
}
