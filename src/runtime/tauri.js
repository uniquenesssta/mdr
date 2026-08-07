import { createDialogClient, createDragDropClient, createFileSystemClient, createInvokeClient, createRuntimeCapabilities, createWindowClient, detectPlatformEnvironment } from '../platform/index.js';

const platformEnvironment = detectPlatformEnvironment(window);
const capabilities = createRuntimeCapabilities(platformEnvironment, window);
const isAvailable = capabilities.desktop.invoke;
const invokeClient = createInvokeClient({
  now: () => performance.now(),
  record: (operation, entry) => window.markdownEditorPerf?.record(operation, entry)
});
const dialogClient = createDialogClient({
  now: () => performance.now(),
  record: (operation, entry) => window.markdownEditorPerf?.record(operation, entry)
});
const dragDropClient = createDragDropClient();
const fileSystemClient = createFileSystemClient({ invoke: invokeClient.invoke });
const windowClient = createWindowClient();

if (isAvailable) {
  document.documentElement.classList.add('tauri-shell');
}

window.markdownEditorNative = {
  isAvailable,
  capabilities,
  async fetchUrl(url) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    return invokeClient.invoke('fetch_url', { url }, { inputLength: String(url || '').length });
  },
  async openExternalUrl(url) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    const value = String(url || '').trim();
    return invokeClient.invoke('open_external_url', { url: value }, {
      scheme: value.split(':', 1)[0].toLowerCase(),
      inputLength: value.length
    });
  },
  async readDroppedFile(path) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    return fileSystemClient.readDroppedFile(path);
  },
  async listTextFileTree(documentPath) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    return fileSystemClient.listTextFileTree(documentPath);
  },
  async readLocalImage(source, documentPath = '') {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    return fileSystemClient.readLocalImage(source, documentPath);
  },
  async getInitialFilePath() {
    if (!isAvailable) return null;
    return fileSystemClient.getInitialFilePath();
  },
  async writePerformanceLogs(entries) {
    if (!isAvailable) return '';
    return invokeClient.invoke('write_performance_logs', { entries }, {}, { record: false });
  },
  async saveDocumentState(request) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    return invokeClient.invoke('save_document_state', { request }, {
      documentId: request?.documentId || '',
      baseVersion: request?.baseVersion || 0,
      nextVersion: request?.nextVersion || 0,
      transactions: request?.transactions?.length || 0,
      fullSnapshot: typeof request?.fullContent === 'string'
    });
  },
  async beginDocumentSnapshotUpload(documentId, uploadId) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    return invokeClient.invoke('begin_document_snapshot_upload', { documentId, uploadId }, {
      documentId,
      uploadId
    });
  },
  async appendDocumentSnapshotChunk(documentId, uploadId, chunk, chunkIndex = 0) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    const content = String(chunk ?? '');
    return invokeClient.invoke('append_document_snapshot_chunk', {
      documentId,
      uploadId,
      chunk: content
    }, {
      documentId,
      uploadId,
      chunkIndex,
      characters: content.length
    });
  },
  async commitDocumentSnapshotUpload(request, uploadId) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    return invokeClient.invoke('commit_document_snapshot_upload', { request, uploadId }, {
      documentId: request?.documentId || '',
      uploadId,
      baseVersion: request?.baseVersion || 0,
      nextVersion: request?.nextVersion || 0
    });
  },
  async abortDocumentSnapshotUpload(documentId, uploadId) {
    if (!isAvailable) return;
    return invokeClient.invoke('abort_document_snapshot_upload', { documentId, uploadId }, {
      documentId,
      uploadId
    });
  },
  async loadDocumentState(documentId) {
    if (!isAvailable) return null;
    return invokeClient.invoke('load_document_state', { documentId }, { documentId });
  },
  async loadDocumentManifest(documentId) {
    if (!isAvailable) return null;
    return invokeClient.invoke('load_document_manifest', { documentId }, { documentId });
  },
  async readDocumentChunk(documentId, byteOffset, maxBytes = 512 * 1024) {
    if (!isAvailable) return null;
    return invokeClient.invoke('read_document_chunk', {
      documentId,
      byteOffset: Math.max(0, Number(byteOffset) || 0),
      maxBytes: Math.max(16 * 1024, Number(maxBytes) || 512 * 1024)
    }, { documentId, byteOffset, maxBytes });
  },
  async searchDocumentState(request) {
    if (!isAvailable) return null;
    return invokeClient.invoke('search_document_state', { request }, {
      documentId: request?.documentId || '',
      queryLength: String(request?.query || '').length,
      from: Number(request?.from) || 0
    });
  },
  async deleteDocumentState(documentId) {
    if (!isAvailable) return;
    return invokeClient.invoke('delete_document_state', { documentId }, { documentId });
  },
  async chooseOpenPath(options = {}) {
    if (!isAvailable) return null;
    return dialogClient.openFile(options);
  },
  async chooseDirectoryPath(options = {}) {
    if (!isAvailable) return null;
    return dialogClient.openDirectory(options);
  },
  async chooseSavePath(preferredName, options = {}) {
    if (!isAvailable) return null;
    return dialogClient.saveFile(preferredName, options);
  },
  async writeTextFile(path, content, details = {}) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    return fileSystemClient.writeTextFile(path, content, details);
  },
  async writeBinaryFile(path, content, details = {}) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    return fileSystemClient.writeBinaryFile(path, content, details);
  },
  async saveTextFile(content, preferredName, options = {}) {
    if (!isAvailable) return { cancelled: false, fallback: true };
    const path = await this.chooseSavePath(preferredName, options);
    if (!path) return { cancelled: true };
    await this.writeTextFile(path, content, { extension: options.extension || 'md' });
    return { cancelled: false, path };
  },
  async confirmAction(message, options = {}) {
    if (!isAvailable) return window.confirm(String(message || ''));
    return dialogClient.confirm(message, options);
  },
  async onDragDrop(handler) {
    if (!isAvailable) return null;
    return dragDropClient.subscribe(event => handler({ payload: event }));
  },
  async onCloseRequested(handler) {
    if (!isAvailable) return null;
    return windowClient.subscribeCloseRequest(handler);
  },
  async startWindowDragging() {
    if (!isAvailable) return;
    return windowClient.startDrag();
  },
  async minimizeWindow() {
    if (!isAvailable) return;
    return windowClient.minimize();
  },
  async toggleMaximizeWindow() {
    if (!isAvailable) return false;
    return windowClient.toggleMaximize();
  },
  async isWindowMaximized() {
    if (!isAvailable) return false;
    return windowClient.isMaximized();
  },
  async onWindowResized(handler) {
    if (!isAvailable) return null;
    return windowClient.subscribeResize(handler);
  },
  async closeWindow() {
    if (!isAvailable) return;
    return windowClient.requestClose();
  },
  async destroyWindow() {
    if (!isAvailable) return;
    return windowClient.forceClose();
  }
};
