/**
 * Responsibility: Expose the Stage 5.2 DocumentSessionStore to remaining classic callers through the existing explicit compatibility host.
 * State/side effects: Owns only one host property lifecycle; authoritative session state remains inside the injected store and document body is never exposed by this port.
 */
import { pickDocumentRecordMetadata } from '../domain/document-record.js';

const PORT_NAME = 'markdownEditorDocumentSessionPort';

export function mountClassicDocumentSessionPort(host, store) {
  if (!host || typeof host !== 'object') throw new TypeError('Document session compatibility host is required.');
  if (!store || typeof store.getRecord !== 'function' || typeof store.insertRecord !== 'function') {
    throw new TypeError('Document session store is required.');
  }
  if (host[PORT_NAME]) throw new Error('Document session compatibility port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Document session compatibility port has been destroyed.');
  };
  const projectRecord = source => pickDocumentRecordMetadata(source);

  const api = Object.freeze({
    get snapshot() { assertActive(); return store.snapshot; },
    get records() { assertActive(); return store.records; },
    get activeId() { assertActive(); return store.activeId; },
    getRecord(documentId) { assertActive(); return store.getRecord(documentId); },
    getActiveRecord() { assertActive(); return store.getActiveRecord(); },
    replaceRecords(records, options) {
      assertActive();
      return store.replaceRecords(Array.from(records || []).map(projectRecord), options);
    },
    insertRecord(record, options) {
      assertActive();
      return store.insertRecord(projectRecord(record), options);
    },
    updateRecord(documentId, patch, options) {
      assertActive();
      return store.updateRecord(documentId, patch, options);
    },
    setActive(documentId, options) {
      assertActive();
      return store.setActive(documentId, options);
    },
    removeRecord(documentId, options) {
      assertActive();
      return store.removeRecord(documentId, options);
    },
    reset(options) {
      assertActive();
      return store.reset(options);
    },
    subscribe(listener) {
      assertActive();
      return store.subscribe(listener);
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
