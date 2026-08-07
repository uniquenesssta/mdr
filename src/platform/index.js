/** Stable public entry for platform contracts and runtime capability detection. */
export * from './ports/index.js';
export { detectPlatformEnvironment, PLATFORM_ENVIRONMENTS } from './environment/platform-detection.js';
export { createRuntimeCapabilities } from './environment/runtime-capabilities.js';
export { createBrowserStorage } from './browser/browser-storage.js';
export { createBrowserFileDownload } from './browser/browser-file-download.js';
export { createBrowserClipboard } from './browser/browser-clipboard.js';
export { createBrowserFullscreen } from './browser/browser-fullscreen.js';
export { createBrowserPrint } from './browser/browser-print.js';
export { BrowserFileReadCancelledError, createBrowserFileReader } from './browser/browser-file-reader.js';
export { createDialogClient } from './desktop/dialog-client.js';
export { createDocumentStoreClient } from './desktop/document-store-client.js';
export { createDragDropClient } from './desktop/drag-drop-client.js';
export { createFileSystemClient } from './desktop/file-system-client.js';
export { createInvokeClient } from './desktop/invoke-client.js';
export { createLinkClient } from './desktop/link-client.js';
export { createPerformanceLogClient } from './desktop/performance-log-client.js';
export { createWebFetchClient } from './desktop/web-fetch-client.js';
export { createWindowClient } from './desktop/window-client.js';
