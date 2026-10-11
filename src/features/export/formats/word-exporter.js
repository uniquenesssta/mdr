import { createRenderedDocumentExporter } from './rendered-document-exporter.js';

/** Fixed Word HTML .doc capability; shares lifecycle without calling the HTML exporter. */
export function createWordExporter(options = {}) {
  return createRenderedDocumentExporter({ ...options, format: 'word' });
}
