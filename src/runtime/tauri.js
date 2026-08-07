import { createDialogClient, createDragDropClient, createInvokeClient, createRuntimeCapabilities, createWindowClient, detectPlatformEnvironment } from '../platform/index.js';

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
const windowClient = createWindowClient();

if (isAvailable) {
  document.documentElement.classList.add('tauri-shell');
}


function bytesToBase64(bytes) {
  const chunkSize = 32 * 1024;
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
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
    const extension = String(path || '').split('.').pop()?.toLowerCase() || '';
    return invokeClient.invoke('read_dropped_file', { path }, { extension });
  },
  async listTextFileTree(documentPath) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    const value = String(documentPath || '').trim();
    return invokeClient.invoke('list_text_file_tree', { documentPath: value }, {
      hasDocumentPath: Boolean(value),
      extension: value.split('.').pop()?.toLowerCase() || ''
    });
  },
  async readLocalImage(source, documentPath = '') {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    const value = String(source || '').trim();
    return invokeClient.invoke('read_local_image', {
      source: value,
      documentPath: String(documentPath || '').trim() || null
    }, {
      sourceLength: value.length,
      hasDocumentPath: Boolean(String(documentPath || '').trim())
    });
  },
  async getInitialFilePath() {
    if (!isAvailable) return null;
    return invokeClient.invoke('initial_file_path', {}, {});
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
    const text = String(content ?? '');
    return invokeClient.invoke('write_local_text_file', {
      path: String(path || ''),
      content: text
    }, {
      extension: String(details.extension || 'md'),
      characters: text.length,
      fileName: String(path || '').split(/[\\/]/).pop() || '',
      reason: String(details.reason || '')
    });
  },
  async writeBinaryFile(path, content, details = {}) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content || []);
    return invokeClient.invoke('write_local_binary_file', {
      path: String(path || ''),
      contentBase64: bytesToBase64(bytes)
    }, {
      extension: String(details.extension || ''),
      bytes: bytes.byteLength,
      fileName: String(path || '').split(/[\\/]/).pop() || '',
      reason: String(details.reason || '')
    });
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
