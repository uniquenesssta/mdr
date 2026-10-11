import { createExportDocumentSerializer } from './export-document-serializer.js';

/** Fixed HTML stylesheet/title profile over the passive document serializer. */
export function createHtmlDocumentSerializer(options = {}) {
  return createExportDocumentSerializer({ ...options, format: 'html' });
}
