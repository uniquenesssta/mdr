/**
 * Responsibility: Public Stage 10 Persistence contract exposing completed R10-01 through R10-10 save status, manual/autosave/load orchestration and browser Repository plus native Session/Queue/Snapshot Uploader/Segmented Loader/Search Adapter boundaries plus scoped classic migration bridges.
 * Imports: Persistence feature modules only; callers must not import feature internals across this boundary.
 * Exports: SAVE_STATUS_STATES, createSaveStatusStore(), createSaveController(), createAutosaveController(), createLoadController(), createNativeSaveSession(), createNativeSaveQueue(), createNativeSnapshotUploader(), createNativeSegmentedLoader(), createNativeSearchAdapter(), createBrowserDocumentRepository(), and scoped classic save/autosave/status bridges.
 * State/side effects: Import-only facade with no runtime state, DOM, storage, platform or persistence side effects.
 * Lifecycle: Pure import facade; lifecycle belongs to exported explicit instances.
 */
export { SAVE_STATUS_STATES, createSaveStatusStore } from './state/save-status-store.js';
export { createSaveController } from './application/save-controller.js';
export { createAutosaveController } from './application/autosave-controller.js';
export { createLoadController } from './application/load-controller.js';
export { createCloseSaveController } from './application/close-save-controller.js';
export { createNativeSaveSession } from './native-document-store/native-save-session.js';
export { createNativeSaveQueue } from './native-document-store/native-save-queue.js';
export { createNativeSnapshotUploader } from './native-document-store/native-snapshot-uploader.js';
export { createNativeSegmentedLoader } from './native-document-store/native-segmented-loader.js';
export { createNativeSearchAdapter } from './native-document-store/native-search-adapter.js';
export { createBrowserDocumentRepository } from './browser/browser-document-repository.js';
export { mountClassicSaveStatusStorePort } from './compatibility/classic-save-status-store-port.js';
export { mountClassicSaveControllerPort } from './compatibility/classic-save-controller-port.js';
export { mountClassicAutosaveControllerPort } from './compatibility/classic-autosave-controller-port.js';