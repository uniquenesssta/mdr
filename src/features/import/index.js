/** Public import boundary: metadata classification, text reads and scoped classic migration ports. */
export { IMPORT_KINDS, classifyBrowserFile, classifyImportPath, classifyImportResult } from './files/file-type-classifier.js';
export { mountClassicImportClassifierPort } from './compatibility/classic-import-classifier-port.js';
export { createFileImportController, FileImportCancelledError } from './files/file-import-controller.js';
export { mountClassicFileImportPort } from './compatibility/classic-file-import-port.js';
