/**
 * Responsibility: Expose the Stage 5 Documents feature through one public domain/application/state/infrastructure/UI boundary.
 * State/side effects: None; import-only facade.
 * Lifecycle: Pure module; exported factories and mounts own their explicit lifecycles.
 */
export { createDocumentId, normalizeDocumentId } from './domain/document-identity.js';
export { normalizeDocumentTitle } from './domain/document-title.js';
export { normalizeDocumentPath } from './domain/document-path.js';
export { normalizeDocumentNativeMetadata } from './domain/document-native-metadata.js';
export { createDocumentRecord, pickDocumentRecordMetadata, updateDocumentRecord } from './domain/document-record.js';
export { createRecentFileEntry, normalizeRecentFilePath } from './domain/recent-file-entry.js';
export { mountClassicDocumentDomainPort } from './compatibility/classic-document-domain-port.js';
export { DOCUMENT_SESSION_CHANGED_EVENT, createDocumentSessionStore } from './state/document-session-store.js';
export { mountClassicDocumentSessionPort } from './compatibility/classic-document-session-port.js';
export { createSessionDocumentRepository } from './infrastructure/session-document-repository.js';
export { createDocumentOpenCoordinator } from './application/document-open-coordinator.js';
export { createDocumentCloseCoordinator } from './application/document-close-coordinator.js';
export { createDocumentTitleController } from './application/document-title-controller.js';
export { DocumentOperationStaleError, createDocumentSessionController } from './application/document-session-controller.js';
export { mountClassicDocumentControllerPort } from './compatibility/classic-document-controller-port.js';
export { createRecentFilesRepository } from './infrastructure/recent-files-repository.js';
export { mountClassicRecentFilesPort } from './compatibility/classic-recent-files-port.js';
export { mountClassicDocumentUiCommandPort } from './compatibility/classic-document-ui-command-port.js';
export { createDocumentListItemView } from './ui/document-list-item-view.js';
export { createDocumentListView } from './ui/document-list-view.js';
export { createDocumentContextMenuView } from './ui/document-context-menu-view.js';
export { createDocumentTitleView } from './ui/document-title-view.js';
