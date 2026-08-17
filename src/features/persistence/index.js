
/**
 * Responsibility: Public Stage 10 Persistence contract exposing the completed R10-01 SaveStatusStore and R10-02 SaveController boundaries plus their scoped classic migration bridges.
 * Imports: Persistence feature modules only; callers must not import feature internals across this boundary.
 * Exports: SAVE_STATUS_STATES, createSaveStatusStore(), createSaveController(), mountClassicSaveStatusStorePort(), mountClassicSaveControllerPort().
 * State/side effects: Import-only facade with no runtime state, DOM, storage, platform or persistence side effects.
 * Lifecycle: Pure import facade; lifecycle belongs to exported explicit instances.
 */
export { SAVE_STATUS_STATES, createSaveStatusStore } from './state/save-status-store.js';
export { createSaveController } from './application/save-controller.js';
export { mountClassicSaveStatusStorePort } from './compatibility/classic-save-status-store-port.js';
export { mountClassicSaveControllerPort } from './compatibility/classic-save-controller-port.js';
