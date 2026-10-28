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
import { SETTING_DEFAULTS } from './domain/settings-defaults.js';
import { createLaunchPolicyController } from './application/launch-policy-controller.js';

function publishSettingsChanged(documentRef, event) {
  const CustomEventClass = documentRef.defaultView?.CustomEvent || globalThis.CustomEvent;
  if (typeof CustomEventClass !== 'function') throw new Error('CustomEvent is unavailable for Settings change publication.');
  documentRef.dispatchEvent(new CustomEventClass(SETTINGS_CHANGED_EVENT, { detail: event }));
}

export function createSettingsFeature({
  menuRoot,
  overlayRoot,
  workspaceRoot = null,
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
  let launchPolicy = null;
  let alive = true;
  try {
    applyCoordinator = createSettingsApplyCoordinator({
      store,
      publish: event => publishSettingsChanged(documentRef, event)
    });
    dialogView = createSettingsDialogView(overlayRoot, {
      workspaceRoot,
      onNavigate: page => controller?.navigate(page),
      onDraftChange: (settingId, value) => controller?.updateDraft(settingId, value),
      onRequestApply: () => controller?.apply(),
      onRequestCancel: reason => controller?.cancel(reason),
      onChooseDirectory: () => controller?.chooseDirectory(),
      onClearDirectory: () => controller?.clearDirectory(),
      onRequestReset: () => { void launchPolicy.reset(() => controller?.resetDefaults(SETTING_DEFAULTS)).catch(error => { if (alive) dialogView.setFeedback('恢复默认失败：' + (error?.message || String(error)), 'error'); }); },
      onLaunchPolicyChange: enabled => { void launchPolicy.change(enabled); },
      onOpen: () => { void launchPolicy?.refresh().catch(error => { if (alive) dialogView.setFeedback('多开设置读取失败：' + (error?.message || String(error)), 'error'); }); }
    });
    launchPolicy = createLaunchPolicyController({ launch: platform.launch, view: dialogView.launchPolicy, supported: platform.capabilities.isDesktop === true });
    controller = createSettingsController({
      store,
      view: dialogView,
      applyCoordinator,
      platform,
      openTrigger,
      shortcutTarget: documentRef,
      autoApply: true
    });
    return Object.freeze({ ...controller, get activePage() { return controller.activePage; }, destroy() { if (!alive) return; alive = false; launchPolicy.destroy(); controller.destroy(); } });
  } catch (error) {
    const errors = [error];
    try { launchPolicy?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { dialogView?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { applyCoordinator?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Settings feature cleanly.');
  }
}
