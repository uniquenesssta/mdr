/**
 * Responsibility: Expose the Stage 5.3 DocumentSessionController to remaining classic callers through the existing scoped compatibility host.
 * State/side effects: Owns one host property lifecycle only; lifecycle generation/model/session/persistence remain owned by the injected controller and its dependencies.
 */
import { DocumentOperationStaleError } from '../application/document-session-controller.js';

const PORT_NAME = 'markdownEditorDocumentControllerPort';

export function mountClassicDocumentControllerPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Document controller compatibility host is required.');
  if (!controller || typeof controller.openDocument !== 'function' || typeof controller.closeDocument !== 'function') {
    throw new TypeError('Document session controller is required.');
  }
  if (host[PORT_NAME]) throw new Error('Document controller compatibility port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Document controller compatibility port has been destroyed.');
  };
  const call = method => (...args) => {
    assertActive();
    return controller[method](...args);
  };

  const api = Object.freeze({
    get generation() { assertActive(); return controller.generation; },
    get records() { assertActive(); return controller.records; },
    get activeId() { assertActive(); return controller.activeId; },
    getRecord: call('getRecord'),
    getActiveRecord: call('getActiveRecord'),
    getLegacySessionRecords: call('getLegacySessionRecords'),
    captureOperation: call('captureOperation'),
    isCurrentGeneration: call('isCurrentGeneration'),
    initializeEmptySession: call('initializeEmptySession'),
    ensureActiveForEditing: call('ensureActiveForEditing'),
    saveActive: call('saveActive'),
    openDocument: call('openDocument'),
    newDocument: call('newDocument'),
    openExternalDocument: call('openExternalDocument'),
    duplicateDocument: call('duplicateDocument'),
    renameDocument: call('renameDocument'),
    updateActiveTitleDraft: call('updateActiveTitleDraft'),
    bindDocumentFilePath: call('bindDocumentFilePath'),
    closeDocument: call('closeDocument'),
    readDocumentContent: call('readDocumentContent'),
    persistLegacyActiveSnapshot: call('persistLegacyActiveSnapshot'),
    isStaleError(error) {
      assertActive();
      return error instanceof DocumentOperationStaleError || error?.code === 'DOCUMENT_OPERATION_STALE';
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
