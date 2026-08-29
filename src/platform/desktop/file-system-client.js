function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

function fileExtension(path) {
  return String(path || '').split('.').pop()?.toLowerCase() || '';
}

function fileName(path) {
  return String(path || '').split(/[\\/]/).pop() || '';
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

/**
 * Creates the desktop file-system command adapter.
 * It only maps frontend values to the six existing Rust local-file commands;
 * path resolution, file-kind rules, MIME generation and business feedback stay outside this client.
 */
export function createFileSystemClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('file-system client options must be an object');
  }

  const invoke = options.invoke;
  assertFunction(invoke, 'file-system client requires an invoke function');

  async function readDroppedFile(path) {
    return invoke('read_dropped_file', { path }, {
      extension: fileExtension(path)
    });
  }

  async function listTextFileTree(documentPath) {
    const value = String(documentPath || '').trim();
    return invoke('list_text_file_tree', { documentPath: value }, {
      hasDocumentPath: Boolean(value),
      extension: fileExtension(value)
    });
  }

  async function readLocalImage(source, documentPath = '') {
    const value = String(source || '').trim();
    const normalizedDocumentPath = String(documentPath || '').trim();
    return invoke('read_local_image', {
      source: value,
      documentPath: normalizedDocumentPath || null
    }, {
      sourceLength: value.length,
      hasDocumentPath: Boolean(normalizedDocumentPath)
    });
  }

  async function getInitialFilePath() {
    return invoke('initial_file_path', {}, {});
  }

  async function writeTextFile(path, content, details = {}) {
    const normalizedPath = String(path || '');
    const text = String(content ?? '');
    return invoke('write_local_text_file', {
      path: normalizedPath,
      content: text
    }, {
      extension: String(details.extension || 'md'),
      characters: text.length,
      fileName: fileName(normalizedPath),
      reason: String(details.reason || '')
    });
  }

  async function writeBinaryFile(path, content, details = {}) {
    const normalizedPath = String(path || '');
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content || []);
    return invoke('write_local_binary_file', {
      path: normalizedPath,
      contentBase64: bytesToBase64(bytes)
    }, {
      extension: String(details.extension || ''),
      bytes: bytes.byteLength,
      fileName: fileName(normalizedPath),
      reason: String(details.reason || '')
    });
  }

  return Object.freeze({
    readDroppedFile,
    listTextFileTree,
    readLocalImage,
    getInitialFilePath,
    writeTextFile,
    writeBinaryFile
  });
}
