/**
 * Responsibility: Orchestrate one Settings dialog draft session, navigation, validation, directory picking, apply/cancel and scoped open shortcuts.
 * Imports: Generic DOM event primitives and Settings section registry only; Store, View, Apply Coordinator and platform are injected.
 * Exports: createSettingsController().
 * State/side effects: Owns dialog-session/navigation/request-generation state and scoped listeners; all Settings values remain Store draft/committed state.
 */
import { createEventScope, requireElementRef } from '../../../ui/dom/index.js';
import { SETTINGS_SECTION_IDS } from '../sections/section-registry.js';

function normalizePage(page) {
  const value = String(page || '');
  return SETTINGS_SECTION_IDS.includes(value) ? value : SETTINGS_SECTION_IDS[0];
}

function assertPort(value, methods, label) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(`Settings Controller requires ${label}.`);
  }
}

export function createSettingsController({
  store,
  view,
  applyCoordinator,
  platform,
  openTrigger,
  shortcutTarget
} = {}) {
  assertPort(store, ['openDraft', 'updateDraft', 'cancelDraft'], 'a Settings Store.');
  assertPort(view, [
    'renderDraft', 'setActivePage', 'getActiveNavigationButton', 'validate',
    'setFeedback', 'setDirectoryBusy', 'setDirectoryValue', 'open', 'close', 'isOpen', 'destroy'
  ], 'a Settings dialog view.');
  assertPort(applyCoordinator, ['applyDraft', 'destroy'], 'a Settings Apply Coordinator.');
  if (!platform || typeof platform.supports !== 'function' || typeof platform.call !== 'function') {
    throw new TypeError('Settings Controller requires a platform port.');
  }
  requireElementRef(openTrigger, 'Settings open trigger');
  if (!shortcutTarget || typeof shortcutTarget.addEventListener !== 'function') {
    throw new TypeError('Settings Controller requires a shortcut event target.');
  }

  const events = createEventScope();
  let activePage = SETTINGS_SECTION_IDS[0];
  let destroyed = false;
  let requestGeneration = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Settings Controller has been destroyed.');
  };

  function updateDraft(settingId, value) {
    assertActive();
    const draft = store.updateDraft({ [settingId]: value });
    view.setFeedback('');
    return draft;
  }

  function navigate(page) {
    assertActive();
    activePage = normalizePage(page);
    view.setActivePage(activePage);
    return activePage;
  }

  function onClosed() {
    requestGeneration += 1;
    if (!destroyed) view.setDirectoryBusy(false);
    if (store.hasDraft) store.cancelDraft();
  }

  function open(page = activePage) {
    assertActive();
    if (view.isOpen()) {
      navigate(page);
      return true;
    }
    const draft = store.openDraft();
    try {
      view.renderDraft(draft);
      navigate(page);
      view.setFeedback('');
      return view.open({
        initialFocus: view.getActiveNavigationButton(),
        onClose: onClosed
      });
    } catch (error) {
      if (store.hasDraft) store.cancelDraft();
      throw error;
    }
  }

  function cancel(reason = 'feature-close') {
    assertActive();
    requestGeneration += 1;
    view.setDirectoryBusy(false);
    if (view.isOpen()) return view.close(reason);
    if (store.hasDraft) return store.cancelDraft();
    return false;
  }

  function apply() {
    assertActive();
    if (!store.hasDraft) throw new Error('Settings draft is not open.');
    const validation = view.validate();
    if (!validation.valid) {
      view.setFeedback(validation.message || '请检查设置值。', 'error');
      validation.focus?.();
      return false;
    }
    try {
      const snapshot = applyCoordinator.applyDraft();
      view.setFeedback('');
      if (view.isOpen()) view.close('applied');
      return snapshot;
    } catch (error) {
      view.setFeedback('设置保存失败：' + (error?.message || String(error)), 'error');
      return false;
    }
  }

  async function chooseDirectory() {
    assertActive();
    if (!store.hasDraft) return false;
    if (!platform.supports('desktop.dialogs')) {
      view.setFeedback('自定义导出路径仅支持桌面版', 'info');
      return false;
    }
    const generation = ++requestGeneration;
    view.setDirectoryBusy(true);
    view.setFeedback('');
    try {
      const selected = await platform.call('dialogs', 'openDirectory', {
        title: '选择默认导出目录',
        defaultPath: String(store.draft?.exportDirectory || '')
      });
      if (destroyed || generation !== requestGeneration || !store.hasDraft) return false;
      if (!selected) return false;
      const draft = store.updateDraft({ exportDirectory: String(selected) });
      view.setDirectoryValue(draft.exportDirectory);
      return true;
    } catch (error) {
      if (!destroyed && generation === requestGeneration && store.hasDraft) {
        view.setFeedback('目录选择失败：' + (error?.message || String(error)), 'error');
      }
      return false;
    } finally {
      if (!destroyed && generation === requestGeneration) view.setDirectoryBusy(false);
    }
  }

  function clearDirectory() {
    assertActive();
    if (!store.hasDraft) return false;
    requestGeneration += 1;
    view.setDirectoryBusy(false);
    const draft = store.updateDraft({ exportDirectory: '' });
    view.setDirectoryValue(draft.exportDirectory);
    view.setFeedback('');
    return true;
  }

  try {
    events.listen(openTrigger, 'click', () => open());
    events.listen(shortcutTarget, 'keydown', event => {
      const key = String(event?.key || '');
      if (!(event?.ctrlKey || event?.metaKey) || key !== ',') return;
      event.preventDefault?.();
      event.stopPropagation?.();
      open();
    });
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Settings Controller cleanly.');
  }

  return Object.freeze({
    get activePage() {
      assertActive();
      return activePage;
    },
    open,
    apply,
    cancel,
    navigate,
    updateDraft,
    chooseDirectory,
    clearDirectory,
    isOpen() {
      assertActive();
      return view.isOpen();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestGeneration += 1;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { if (store.hasDraft) store.cancelDraft(); } catch (error) { errors.push(error); }
      try { applyCoordinator.destroy(); } catch (error) { errors.push(error); }
      try { view.destroy(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Settings Controller cleanly.');
    }
  });
}
