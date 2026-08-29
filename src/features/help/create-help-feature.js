/**
 * Responsibility: Compose one Help feature instance from explicit UI, i18n and storage dependencies.
 * Imports: Help internals plus bounded UI DOM primitives only.
 * Exports: createHelpFeature().
 * State/side effects: Constructs owned Help resources with rollback on partial failure. Lifecycle: controller-owned explicit instance.
 */
import { requireElementRef } from '../../ui/dom/index.js';
import { createHelpController } from './help-controller.js';
import { helpContentRegistry } from './help-content-registry.js';
import { createHelpState } from './help-state.js';
import { createHelpDialogView } from './ui/help-dialog-view.js';
import { createHelpNavigationView } from './ui/help-navigation-view.js';

export function createHelpFeature({ menuRoot, overlayRoot, i18n, storage }) {
  requireElementRef(menuRoot, 'Help menu root');
  requireElementRef(overlayRoot, 'Help overlay root');
  const openTrigger = requireElementRef(menuRoot.querySelector('[data-help-open]'), 'Help menu trigger');

  let controller = null;
  let state = null;
  let dialogView = null;
  let navigationView = null;
  try {
    state = createHelpState();
    dialogView = createHelpDialogView(overlayRoot, {
      onRequestClose: reason => controller?.close(reason)
    });
    navigationView = createHelpNavigationView(dialogView.navigationRoot, {
      onNavigate: page => controller?.navigate(page)
    });
    controller = createHelpController({
      i18n,
      contentRegistry: helpContentRegistry,
      state,
      dialogView,
      navigationView,
      storage,
      openTrigger
    });
    return controller;
  } catch (error) {
    const errors = [error];
    try { navigationView?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { dialogView?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { state?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Help feature cleanly.');
  }
}
