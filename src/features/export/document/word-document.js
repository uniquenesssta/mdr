import { createExportDocumentSerializer } from './export-document-serializer.js';

/** Existing HTML .doc container with the shared Word stylesheet and embedded math fonts. */
export function createWordDocumentSerializer(options = {}) {
  return createExportDocumentSerializer({ ...options, format: 'word' });
}
