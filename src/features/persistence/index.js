/**
 * Responsibility: Public Stage 10 Persistence contract exposing completed R10-01 through R10-06 save status, manual/autosave orchestration and native Session/Queue/Snapshot Uploader boundaries plus scoped classic migration bridges.
 * Imports: Persistence feature modules only; callers must not import feature internals across this boundary.
 * Exports: SAVE_STATUS_STATES, createSaveStatusStore(), createSaveController(), createAutosaveController(), createNativeSaveSession(), createNativeSaveQueue(), createNativeSnapshotUploader(), and scoped classic save/autosave/status bridges.
 * State/side effects: Import-only facade with no runtime state, DOM, storage, platform or persistence side effects.
 * Lifecycle: Pure import facade; lifecycle belongs to exported explicit instances.
 */
export { SAVE_STATUS_STATES, createSaveStatusStore } from './state/save-status-store.js';
export { createSaveController } from './application/save-controller.js';
export { createAutosaveController } from './application/autosave-controller.js';
export { createNativeSaveSession } from './native-document-store/native-save-session.js';
export { createNativeSaveQueue } from './native-document-store/native-save-queue.js';
export { createNativeSnapshotUploader } from './native-document-store/native-snapshot-uploader.js';
export { mountClassicSaveStatusStorePort } from './compatibility/classic-save-status-store-port.js';
export { mountClassicSaveControllerPort } from './compatibility/classic-save-controller-port.js';
export { mountClassicAutosaveControllerPort } from './compatibility/classic-autosave-controller-port.js';
