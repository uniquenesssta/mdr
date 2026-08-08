/**
 * Responsibility: Compose the Settings UI/application feature from the authoritative Store, shared overlay/menu roots and platform/event ports.
 * Imports: Settings application/UI internals plus bounded DOM validation.
 * Exports: createSettingsFeature().
 * State/side effects: Constructs owned Settings UI/controller resources with rollback-safe wiring; lifecycle is returned controller.
 */
import { requireElementRef } from '../../ui/dom/index.js';
import { SETTINGS_CHANGED_EVENT, createSettingsApplyCoordinator } from './application/settings-apply-coordinator.js';
import { createSettingsController } from './application/settings-controller.js';
import { createSettingsDialogView } from './ui/settings-dialog-view.js';

function publishSettingsChanged(documentRef, event) {
  const CustomEventClass = documentRef.defaultView?.CustomEvent || globalThis.CustomEvent;
  if (typeof CustomEventClass !== 'function') throw new Error('CustomEvent is unavailable for Settings change publication.');
  documentRef.dispatchEvent(new CustomEventClass(SETTINGS_CHANGED_EVENT, { detail: event }));
}

export function createSettingsFeature({
  menuRoot,
  overlayRoot,
  documentRef = overlayRoot?.ownerDocument,
  store,
  platform
} = {}) {
  requireElementRef(menuRoot, 'Settings menu root');
  requireElementRef(overlayRoot, 'Settings overlay root');
  const openTrigger = requireElementRef(menuRoot.querySelector('[data-settings-open]'), 'Settings menu trigger');
  if (!documentRef || typeof documentRef.addEventListener !== 'function') {
    throw new TypeError('Settings feature requires a document event target.');
  }

  let controller = null;
  let applyCoordinator = null;
  let dialogView = null;
  try {
    applyCoordinator = createSettingsApplyCoordinator({
      store,
      publish: event => publishSettingsChanged(documentRef, event)
    });
    dialogView = createSettingsDialogView(overlayRoot, {
      onNavigate: page => controller?.navigate(page),
      onDraftChange: (settingId, value) => controller?.updateDraft(settingId, value),
      onRequestApply: () => controller?.apply(),
      onRequestCancel: reason => controller?.cancel(reason),
      onChooseDirectory: () => controller?.chooseDirectory(),
      onClearDirectory: () => controller?.clearDirectory()
    });
    controller = createSettingsController({
      store,
      view: dialogView,
      applyCoordinator,
      platform,
      openTrigger,
      shortcutTarget: documentRef
    });
    return controller;
  } catch (error) {
    const errors = [error];
    try { dialogView?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { applyCoordinator?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Settings feature cleanly.');
  }
}
