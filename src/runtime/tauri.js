import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm as showConfirmDialog, open as showOpenDialog, save as showSaveDialog } from '@tauri-apps/plugin-dialog';

const isAvailable = Boolean(window.__TAURI_INTERNALS__);

if (isAvailable) {
  document.documentElement.classList.add('tauri-shell');
}


function normalizeSaveFileName(name, extension = 'md', acceptedExtensions = [extension]) {
  const fallback = `未命名文档.${extension}`;
  const value = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  if (!value) return fallback;
  const hasAcceptedExtension = acceptedExtensions.some(item => new RegExp(`\\.${item}$`, 'i').test(value));
  return hasAcceptedExtension ? value : `${value}.${extension}`;
}

function joinNativePath(directory, fileName) {
  const base = String(directory || '').trim().replace(/[\\/]+$/, '');
  if (!base) return String(fileName || '');
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base}${separator}${fileName}`;
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

async function invokeMeasured(operation, args, details = {}) {
  const started = performance.now();
  try {
    const result = await invoke(operation, args);
    window.markdownEditorPerf?.record(`native.${operation}`, {
      category: 'native.roundtrip',
      durationMs: performance.now() - started,
      details
    });
    return result;
  } catch (error) {
    window.markdownEditorPerf?.record(`native.${operation}`, {
      category: 'native.roundtrip',
      durationMs: performance.now() - started,
      status: 'error',
      details: { ...details, error: error?.message || String(error) }
    });
    throw error;
  }
}

window.markdownEditorNative = {
  isAvailable,
  async fetchUrl(url) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    return invokeMeasured('fetch_url', { url }, { inputLength: String(url || '').length });
  },
  async openExternalUrl(url) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    const value = String(url || '').trim();
    return invokeMeasured('open_external_url', { url: value }, {
      scheme: value.split(':', 1)[0].toLowerCase(),
      inputLength: value.length
    });
  },
  async readDroppedFile(path) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    const extension = String(path || '').split('.').pop()?.toLowerCase() || '';
    return invokeMeasured('read_dropped_file', { path }, { extension });
  },
  async listTextFileTree(documentPath) {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    const value = String(documentPath || '').trim();
    return invokeMeasured('list_text_file_tree', { documentPath: value }, {
      hasDocumentPath: Boolean(value),
      extension: value.split('.').pop()?.toLowerCase() || ''
    });
  },
  async readLocalImage(source, documentPath = '') {
    if (!isAvailable) {
      throw new Error('Tauri runtime is not available');
    }
    const value = String(source || '').trim();
    return invokeMeasured('read_local_image', {
      source: value,
      documentPath: String(documentPath || '').trim() || null
    }, {
      sourceLength: value.length,
      hasDocumentPath: Boolean(String(documentPath || '').trim())
    });
  },
  async getInitialFilePath() {
    if (!isAvailable) return null;
    return invokeMeasured('initial_file_path', {}, {});
  },
  async writePerformanceLogs(entries) {
    if (!isAvailable) return '';
    return invoke('write_performance_logs', { entries });
  },
  async saveDocumentState(request) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    return invokeMeasured('save_document_state', { request }, {
      documentId: request?.documentId || '',
      baseVersion: request?.baseVersion || 0,
      nextVersion: request?.nextVersion || 0,
      transactions: request?.transactions?.length || 0,
      fullSnapshot: typeof request?.fullContent === 'string'
    });
  },
  async beginDocumentSnapshotUpload(documentId, uploadId) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    return invokeMeasured('begin_document_snapshot_upload', { documentId, uploadId }, {
      documentId,
      uploadId
    });
  },
  async appendDocumentSnapshotChunk(documentId, uploadId, chunk, chunkIndex = 0) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    const content = String(chunk ?? '');
    return invokeMeasured('append_document_snapshot_chunk', {
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
    return invokeMeasured('commit_document_snapshot_upload', { request, uploadId }, {
      documentId: request?.documentId || '',
      uploadId,
      baseVersion: request?.baseVersion || 0,
      nextVersion: request?.nextVersion || 0
    });
  },
  async abortDocumentSnapshotUpload(documentId, uploadId) {
    if (!isAvailable) return;
    return invokeMeasured('abort_document_snapshot_upload', { documentId, uploadId }, {
      documentId,
      uploadId
    });
  },
  async loadDocumentState(documentId) {
    if (!isAvailable) return null;
    return invokeMeasured('load_document_state', { documentId }, { documentId });
  },
  async loadDocumentManifest(documentId) {
    if (!isAvailable) return null;
    return invokeMeasured('load_document_manifest', { documentId }, { documentId });
  },
  async readDocumentChunk(documentId, byteOffset, maxBytes = 512 * 1024) {
    if (!isAvailable) return null;
    return invokeMeasured('read_document_chunk', {
      documentId,
      byteOffset: Math.max(0, Number(byteOffset) || 0),
      maxBytes: Math.max(16 * 1024, Number(maxBytes) || 512 * 1024)
    }, { documentId, byteOffset, maxBytes });
  },
  async searchDocumentState(request) {
    if (!isAvailable) return null;
    return invokeMeasured('search_document_state', { request }, {
      documentId: request?.documentId || '',
      queryLength: String(request?.query || '').length,
      from: Number(request?.from) || 0
    });
  },
  async deleteDocumentState(documentId) {
    if (!isAvailable) return;
    return invokeMeasured('delete_document_state', { documentId }, { documentId });
  },
  async chooseOpenPath(options = {}) {
    if (!isAvailable) return null;
    const started = performance.now();
    const selectedPath = await showOpenDialog({
      title: String(options.title || '打开 Markdown'),
      multiple: false,
      directory: false,
      filters: [{
        name: String(options.filterName || 'Markdown 和文本文件'),
        extensions: Array.isArray(options.extensions) && options.extensions.length
          ? options.extensions.map(item => String(item).replace(/^\./, '')).filter(Boolean)
          : ['md', 'markdown', 'txt']
      }]
    });
    window.markdownEditorPerf?.record('native.open-file-dialog', {
      category: 'native.dialog',
      durationMs: performance.now() - started,
      status: selectedPath ? 'ok' : 'cancelled'
    });
    return typeof selectedPath === 'string' ? selectedPath : null;
  },
  async chooseDirectoryPath(options = {}) {
    if (!isAvailable) return null;
    const started = performance.now();
    const selectedPath = await showOpenDialog({
      title: String(options.title || '选择目录'),
      multiple: false,
      directory: true,
      defaultPath: String(options.defaultPath || '').trim() || undefined
    });
    window.markdownEditorPerf?.record('native.open-directory-dialog', {
      category: 'native.dialog',
      durationMs: performance.now() - started,
      status: selectedPath ? 'ok' : 'cancelled'
    });
    return typeof selectedPath === 'string' ? selectedPath : null;
  },
  async chooseSavePath(preferredName, options = {}) {
    if (!isAvailable) return null;
    const extension = String(options.extension || 'md').replace(/^\./, '') || 'md';
    const acceptedExtensions = (Array.isArray(options.extensions) && options.extensions.length
      ? options.extensions
      : [extension])
      .map(item => String(item).replace(/^\./, '').trim())
      .filter(Boolean);
    const defaultName = normalizeSaveFileName(preferredName, extension, acceptedExtensions);
    const defaultPath = joinNativePath(options.defaultDirectory, defaultName);
    const started = performance.now();
    const selectedPath = await showSaveDialog({
      title: String(options.title || '另存为'),
      defaultPath,
      filters: [{
        name: String(options.filterName || 'Markdown 文档'),
        extensions: Array.isArray(options.extensions) && options.extensions.length
          ? options.extensions.map(item => String(item).replace(/^\./, '')).filter(Boolean)
          : [extension, 'markdown']
      }]
    });
    window.markdownEditorPerf?.record('native.save-file-dialog', {
      category: 'native.dialog',
      durationMs: performance.now() - started,
      status: selectedPath ? 'ok' : 'cancelled',
      details: { extension }
    });
    if (!selectedPath) return null;
    const hasAcceptedExtension = acceptedExtensions.some(item => new RegExp(`\\.${item}$`, 'i').test(selectedPath));
    return hasAcceptedExtension ? selectedPath : `${selectedPath}.${extension}`;
  },
  async writeTextFile(path, content, details = {}) {
    if (!isAvailable) throw new Error('Tauri runtime is not available');
    const text = String(content ?? '');
    return invokeMeasured('write_local_text_file', {
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
    return invokeMeasured('write_local_binary_file', {
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
    return showConfirmDialog(String(message || ''), {
      title: String(options.title || 'Markdown Editor'),
      kind: options.kind || 'warning',
      okLabel: String(options.okLabel || '确定'),
      cancelLabel: String(options.cancelLabel || '取消')
    });
  },
  async onDragDrop(handler) {
    if (!isAvailable) return null;
    const webview = getCurrentWebview();
    return webview.onDragDropEvent(handler);
  },
  async onCloseRequested(handler) {
    if (!isAvailable) return null;
    return getCurrentWindow().onCloseRequested(handler);
  },
  async startWindowDragging() {
    if (!isAvailable) return;
    return getCurrentWindow().startDragging();
  },
  async minimizeWindow() {
    if (!isAvailable) return;
    return getCurrentWindow().minimize();
  },
  async toggleMaximizeWindow() {
    if (!isAvailable) return false;
    const currentWindow = getCurrentWindow();
    await currentWindow.toggleMaximize();
    return currentWindow.isMaximized();
  },
  async isWindowMaximized() {
    if (!isAvailable) return false;
    return getCurrentWindow().isMaximized();
  },
  async onWindowResized(handler) {
    if (!isAvailable) return null;
    return getCurrentWindow().onResized(handler);
  },
  async closeWindow() {
    if (!isAvailable) return;
    return getCurrentWindow().close();
  },
  async destroyWindow() {
    if (!isAvailable) return;
    return getCurrentWindow().destroy();
  }
};
