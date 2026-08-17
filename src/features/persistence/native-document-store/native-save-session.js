/**
 * Responsibility: Own one document's native persistence session metadata: backend/editor versions, persisted title, initialization state and source reference.
 * Imports: None; the source capability and version/title values are injected by the NativeDocumentStore orchestrator.
 * Exports: createNativeSaveSession().
 * State/side effects: Stores no document body, snapshot, transactions, queue, timer, DOM or platform object. It only invokes the injected source consumer/persist acknowledgement hooks at the preserved lifecycle points.
 * Lifecycle: destroy() is idempotent and terminal; it releases the source reference and rejects later mutation/publication.
 */

function normalizeVersion(value) {
  return Math.max(0, Number(value) || 0);
}

function normalizeTitle(value) {
  return String(value || '');
}

export function createNativeSaveSession(documentId) {
  const id = String(documentId || '');
  if (!id) throw new TypeError('Native Save Session document id is required.');

  let backendVersion = 0;
  let lastEditorVersion = 0;
  let title = '';
  let initialized = false;
  let source = null;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Native Save Session is destroyed.');
  };

  const snapshot = () => {
    assertActive();
    return Object.freeze({
      documentId: id,
      backendVersion,
      lastEditorVersion,
      title,
      initialized
    });
  };

  const api = {
    get documentId() {
      return id;
    },
    get backendVersion() {
      assertActive();
      return backendVersion;
    },
    get lastEditorVersion() {
      assertActive();
      return lastEditorVersion;
    },
    get title() {
      assertActive();
      return title;
    },
    get initialized() {
      assertActive();
      return initialized;
    },
    get source() {
      assertActive();
      return source;
    },
    get destroyed() {
      return destroyed;
    },
    snapshot,
    attachSource(nextSource) {
      assertActive();
      source = nextSource ?? null;
      return snapshot();
    },
    activate({
      source: nextSource = null,
      editorVersion = 0,
      title: nextTitle = '',
      loaded = false,
      loadedVersion = 0,
      nativeBacked = false,
      nativeVersion = 0
    } = {}) {
      assertActive();
      source = nextSource ?? null;
      lastEditorVersion = normalizeVersion(editorVersion);
      source?.registerConsumer?.('storage', lastEditorVersion);
      title = normalizeTitle(nextTitle);
      if (loaded) {
        backendVersion = normalizeVersion(loadedVersion);
        initialized = true;
      } else if (!nativeBacked) {
        backendVersion = 0;
        initialized = false;
      } else {
        backendVersion = normalizeVersion(nativeVersion);
        initialized = backendVersion > 0;
      }
      return snapshot();
    },
    recordLoaded(version) {
      assertActive();
      backendVersion = normalizeVersion(version);
      initialized = true;
      return snapshot();
    },
    invalidateInitialization() {
      assertActive();
      initialized = false;
      return snapshot();
    },
    commit({ editorVersion = 0, backendVersion: nextBackendVersion = 0, title: nextTitle = '' } = {}) {
      assertActive();
      const committedEditorVersion = normalizeVersion(editorVersion);
      const committedBackendVersion = normalizeVersion(nextBackendVersion);
      backendVersion = committedBackendVersion;
      lastEditorVersion = committedEditorVersion;
      initialized = true;
      title = normalizeTitle(nextTitle);
      source?.markPersisted?.(committedEditorVersion, committedBackendVersion);
      source?.acknowledge?.('storage', committedEditorVersion);
      return snapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      source = null;
    }
  };

  return Object.freeze(api);
}
