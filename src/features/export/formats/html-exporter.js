import { createRenderedDocumentExporter } from './rendered-document-exporter.js';

/** Fixed HTML capability over the shared rendered-file owner. */
export function createHtmlExporter(options = {}) {
  return createRenderedDocumentExporter({ ...options, format: 'html' });
}
