/**
 * Responsibility: Own autosave debounce scheduling, autosave Settings projection, same-version/title suppression and SaveController triggering.
 * Imports: None; SaveController, document/model readers, SaveStatusStore, Settings source and timer capabilities are injected explicitly.
 * Exports: createAutosaveController().
 * State/side effects: Owns only one debounce timer, an operational autosave settings snapshot, request generation and the last successful autosave identity; never owns document body/session records.
 * Lifecycle: destroy() is idempotent and terminal, unsubscribes Settings, cancels pending timer work and prevents late completions from mutating Autosave-owned state.
 */

const DEFAULT_DELAY = 500;
const MIN_DELAY = 500;
const MAX_DELAY = 3_600_000;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is required.`);
  return value;
}

function assertMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`${label} requires ${method}().`);
}

function normalizeVersion(value) {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function normalizeDelay(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return DEFAULT_DELAY;
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(delay)));
}

function normalizeSettings(value) {
  assertObject(value, 'Autosave settings snapshot');
  return Object.freeze({
    enabled: Boolean(value.enabled),
    delay: normalizeDelay(value.delay)
  });
}

function freezeResult(value) {
  return Object.freeze({ ...value });
}

function sameIdentity(left, right) {
  return Boolean(left && right)
    && left.documentId === right.documentId
    && left.version === right.version
    && left.title === right.title;
}

export function createAutosaveController({
  saveController,
  documentController,
  model,
  statusStore,
  settings,
  setTimer,
  clearTimer,
  reportError = () => {}
} = {}) {
  assertObject(saveController, 'Autosave Controller save controller');
  assertMethod(saveController, 'save', 'Autosave Controller save controller');
  assertObject(documentController, 'Autosave Controller document controller');
  assertMethod(documentController, 'getActiveRecord', 'Autosave Controller document controller');
  assertObject(model, 'Autosave Controller frozen model');
  assertMethod(model, 'getDocumentVersion', 'Autosave Controller frozen model');
  assertObject(statusStore, 'Autosave Controller status store');
  assertMethod(statusStore, 'setState', 'Autosave Controller status store');
  assertObject(settings, 'Autosave Controller settings source');
  assertMethod(settings, 'read', 'Autosave Controller settings source');
  assertMethod(settings, 'subscribe', 'Autosave Controller settings source');
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('Autosave Controller requires timer capabilities.');
  }
  if (typeof reportError !== 'function') throw new TypeError('Autosave Controller reportError must be a function.');

  let destroyed = false;
  let timerId = null;
  let scheduleGeneration = 0;
  let settingsSnapshot = normalizeSettings(settings.read());
  let lastSavedIdentity = null;

  const assertActive = () => {
    if (destroyed) throw new Error('Autosave Controller is destroyed.');
  };

  const readIdentity = () => {
    const record = documentController.getActiveRecord();
    const documentId = String(model.documentId || record?.id || '');
    if (!record || !documentId) return null;
    return Object.freeze({
      documentId,
      version: normalizeVersion(model.getDocumentVersion()),
      title: String(model.title ?? record.title ?? '')
    });
  };

  const cancelTimer = () => {
    const hadPending = timerId !== null;
    if (hadPending) clearTimer(timerId);
    timerId = null;
    scheduleGeneration += 1;
    return hadPending;
  };

  const skippedResult = (identity, reason) => freezeResult({
    scheduled: false,
    skipped: true,
    cancelled: false,
    reason,
    documentId: identity?.documentId || '',
    version: identity?.version ?? null,
    title: identity?.title || ''
  });

  async function execute(generation, reason) {
    if (destroyed || generation !== scheduleGeneration) {
      return freezeResult({ completed: false, cancelled: true, stale: true, reason: 'autosave-superseded' });
    }

    settingsSnapshot = normalizeSettings(settings.read());
    if (!settingsSnapshot.enabled) {
      return freezeResult({ completed: false, cancelled: true, stale: false, reason: 'autosave-disabled' });
    }

    const identity = readIdentity();
    if (!identity) {
      return freezeResult({ completed: false, cancelled: true, stale: false, reason: 'no-active-document' });
    }
    if (sameIdentity(identity, lastSavedIdentity)) {
      statusStore.setState('saved', {
        operation: 'save',
        documentId: identity.documentId,
        targetVersion: identity.version
      }, 'autosave-unchanged-skip');
      return skippedResult(identity, 'unchanged-version-and-title');
    }

    let result;
    try {
      result = await saveController.save({
        title: identity.title,
        fallbackTitle: '未命名文档',
        forceSnapshot: false,
        snapshotReason: 'document-storage',
        statusMessage: '正在后台保存…'
      });
    } catch (error) {
      if (!destroyed) reportError('Auto save failed:', error);
      return freezeResult({
        completed: false,
        cancelled: false,
        stale: false,
        failed: true,
        reason: 'save-failed',
        error
      });
    }

    if (destroyed) {
      return freezeResult({ completed: false, cancelled: true, stale: true, reason: 'controller-destroyed' });
    }
    if (result?.cancelled || result?.stale || result?.saved === false) {
      return freezeResult({
        completed: false,
        cancelled: Boolean(result?.cancelled),
        stale: Boolean(result?.stale),
        reason: String(result?.reason || 'save-not-completed'),
        result: result || null
      });
    }

    const persistedIdentity = Object.freeze({
      documentId: String(result?.documentId || identity.documentId),
      version: normalizeVersion(result?.targetVersion ?? identity.version),
      title: String(result?.title ?? identity.title)
    });
    lastSavedIdentity = persistedIdentity;
    return freezeResult({
      completed: true,
      cancelled: false,
      stale: false,
      skipped: false,
      reason: 'saved',
      documentId: persistedIdentity.documentId,
      version: persistedIdentity.version,
      title: persistedIdentity.title,
      result
    });
  }

  function schedule({ reason = 'autosave-request' } = {}) {
    assertActive();
    cancelTimer();
    settingsSnapshot = normalizeSettings(settings.read());
    if (!settingsSnapshot.enabled) {
      return freezeResult({ scheduled: false, skipped: true, cancelled: false, reason: 'autosave-disabled' });
    }

    const identity = readIdentity();
    if (!identity) return skippedResult(null, 'no-active-document');
    if (sameIdentity(identity, lastSavedIdentity)) return skippedResult(identity, 'unchanged-version-and-title');

    const generation = scheduleGeneration;
    statusStore.setState('queued', {
      operation: 'save',
      documentId: identity.documentId,
      targetVersion: identity.version
    }, 'autosave-queued');
    timerId = setTimer(() => {
      if (destroyed || generation !== scheduleGeneration) return;
      timerId = null;
      void execute(generation, String(reason || 'autosave-request'));
    }, settingsSnapshot.delay);

    return freezeResult({
      scheduled: true,
      skipped: false,
      cancelled: false,
      reason: String(reason || 'autosave-request'),
      documentId: identity.documentId,
      version: identity.version,
      title: identity.title,
      delay: settingsSnapshot.delay
    });
  }

  const unsubscribeSettings = settings.subscribe(() => {
    if (destroyed) return;
    settingsSnapshot = normalizeSettings(settings.read());
    if (!settingsSnapshot.enabled) {
      cancelTimer();
      return;
    }
    schedule({ reason: 'settings-change' });
  });
  if (typeof unsubscribeSettings !== 'function') {
    throw new TypeError('Autosave Controller settings subscription must return an unsubscribe function.');
  }

  return Object.freeze({
    schedule,
    cancelPending(reason = 'cancel-pending') {
      assertActive();
      return freezeResult({ cancelled: cancelTimer(), reason: String(reason || 'cancel-pending') });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelTimer();
      unsubscribeSettings();
      lastSavedIdentity = null;
    }
  });
}
