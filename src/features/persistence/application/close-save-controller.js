/**
 * Responsibility: Coordinate close-time persistence admission by cancelling pending Autosave work, forcing one final SaveController snapshot and delegating save-failure decisions.
 * Imports: None; SaveController, AutosaveController, Documents reader, CloseSavePort and user-decision capabilities are injected by the composition root.
 * Exports: createCloseSaveController().
 * State/side effects: Owns only CloseSavePort registration, one in-flight close-save promise and terminal operation generation; never owns document body, model, queue, native session, timer or Window close state.
 * Lifecycle: start() is idempotent; destroy() unregisters the port handler, invalidates late async completion and is terminal.
 */

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is required.`);
  return value;
}

function assertMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`${label} requires ${method}().`);
}

function normalizeContext(value, record) {
  if (value === undefined || value === null) value = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Close Save readSaveContext must return an object.');
  }
  return Object.freeze({
    title: String(value.title ?? record?.title ?? '')
  });
}

export function createCloseSaveController({
  saveController,
  autosaveController,
  documentController,
  closeSavePort,
  readSaveContext = () => ({}),
  decideAfterFailure = async () => false
} = {}) {
  assertObject(saveController, 'Close Save save controller');
  assertMethod(saveController, 'save', 'Close Save save controller');
  assertObject(autosaveController, 'Close Save autosave controller');
  assertMethod(autosaveController, 'cancelPending', 'Close Save autosave controller');
  assertObject(documentController, 'Close Save document controller');
  assertMethod(documentController, 'getActiveRecord', 'Close Save document controller');
  assertObject(closeSavePort, 'Close Save port');
  assertMethod(closeSavePort, 'register', 'Close Save port');
  if (typeof readSaveContext !== 'function') throw new TypeError('Close Save readSaveContext must be a function.');
  if (typeof decideAfterFailure !== 'function') throw new TypeError('Close Save decideAfterFailure must be a function.');

  let started = false;
  let destroyed = false;
  let operationGeneration = 0;
  let unregister = null;
  let inFlight = null;

  const assertActive = () => {
    if (destroyed) throw new Error('Close Save Controller is destroyed.');
  };

  async function runCloseSave(generation) {
    autosaveController.cancelPending('close-save');
    const record = documentController.getActiveRecord();
    if (!record) return !destroyed && generation === operationGeneration;

    const context = normalizeContext(readSaveContext(), record);
    try {
      const saved = await saveController.save({
        title: context.title,
        fallbackTitle: '未命名文档',
        forceSnapshot: true,
        snapshotReason: 'close-save'
      });
      if (destroyed || generation !== operationGeneration) return false;
      if (!saved || saved.saved === false || saved.cancelled || saved.stale || saved.completed === false) return false;
      return true;
    } catch (error) {
      if (destroyed || generation !== operationGeneration) return false;
      const allowed = await decideAfterFailure(error);
      if (destroyed || generation !== operationGeneration) return false;
      return allowed === true;
    }
  }

  function prepareClose() {
    assertActive();
    if (inFlight) return inFlight;
    const generation = ++operationGeneration;
    const pending = runCloseSave(generation);
    const wrapped = pending.finally(() => {
      if (inFlight === wrapped) inFlight = null;
    });
    inFlight = wrapped;
    return wrapped;
  }

  return Object.freeze({
    start() {
      assertActive();
      if (started) return false;
      unregister = closeSavePort.register(() => prepareClose());
      if (typeof unregister !== 'function') throw new TypeError('Close Save port registration must return a disposer.');
      started = true;
      return true;
    },
    prepareClose,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      operationGeneration += 1;
      const dispose = unregister;
      unregister = null;
      dispose?.();
      inFlight = null;
    }
  });
}
