/** Public Stage 5 document-domain contract. */
export { createDocumentId, normalizeDocumentId } from './domain/document-identity.js';
export { normalizeDocumentTitle } from './domain/document-title.js';
export { normalizeDocumentPath } from './domain/document-path.js';
export { normalizeDocumentNativeMetadata } from './domain/document-native-metadata.js';
export { createDocumentRecord, pickDocumentRecordMetadata, updateDocumentRecord } from './domain/document-record.js';
export { createRecentFileEntry, normalizeRecentFilePath } from './domain/recent-file-entry.js';
export { mountClassicDocumentDomainPort } from './compatibility/classic-document-domain-port.js';
