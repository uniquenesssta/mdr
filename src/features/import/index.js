/** Public import boundary: file/image/drop/web coordination and scoped classic migration ports. */
export { createImageImportController, isImageImportCancelled } from './images/image-import-controller.js';
export { isAllowedImageMime, assessBrowserImage } from './images/image-policy.js';
export { IMPORT_KINDS, classifyBrowserFile, classifyImportPath, classifyImportResult } from './files/file-type-classifier.js';
export { createFileImportController, FileImportCancelledError } from './files/file-import-controller.js';
export { mountClassicFileImportPort } from './compatibility/classic-file-import-port.js';
export { createDropImportController } from './files/drop-import-controller.js';
export { mountClassicDropImportPort } from './compatibility/classic-drop-import-port.js';
export { createDropOverlayView } from './files/drop-overlay-view.js';
export { createImageMarkdown } from './images/image-markdown-factory.js';
export { createWebFetchCoordinator } from './web-clipper/web-fetch-coordinator.js';
export { mountClassicWebFetchPort } from './compatibility/classic-web-fetch-port.js';

export { extractHtml } from './web-clipper/html-extractor.js';
export { mountClassicHtmlExtractorPort } from './compatibility/classic-html-extractor-port.js';
export { htmlToMarkdown, convertExtractedHtml } from './web-clipper/html-to-markdown.js';
export { mountClassicHtmlMarkdownPort } from './compatibility/classic-html-markdown-port.js';
export { createWebClipperController } from './web-clipper/web-clipper-controller.js';
export { createWebClipperView } from './web-clipper/web-clipper-view.js';
export { mountClassicWebClipperPort } from './compatibility/classic-web-clipper-port.js';
