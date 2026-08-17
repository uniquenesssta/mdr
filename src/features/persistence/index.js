/**
 * Responsibility: Public Stage 10 Persistence contract; R10-01 exposes only SaveStatusStore and its scoped classic migration bridge.
 * Imports: Persistence feature modules only; callers must not import feature internals across this boundary.
 * Exports: SAVE_STATUS_STATES, createSaveStatusStore(), mountClassicSaveStatusStorePort().
 * State/side effects: Import-only facade with no runtime state, DOM, storage, platform or persistence side effects.
 * Lifecycle: Pure import facade; lifecycle belongs to exported explicit instances.
 */
export { SAVE_STATUS_STATES, createSaveStatusStore } from './state/save-status-store.js';
export { mountClassicSaveStatusStorePort } from './compatibility/classic-save-status-store-port.js';
