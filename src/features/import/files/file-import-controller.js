/**
 * Responsibility: Coordinate browser/native text reads into one immutable FileImportResult.
 * Imports: Pure import classification only; readers are injected platform capabilities.
 * State/side effects: Owns the current read and cancellation, never document/session/UI state.
 * Lifecycle: cancel/destroy reject pending reads; late native results cannot escape cancellation.
 */
import { classifyImportPath, IMPORT_KINDS } from './file-type-classifier.js';

export class FileImportCancelledError extends Error {
  constructor() { super('文档读取已取消'); this.name = 'FileImportCancelledError'; this.code = 'FILE_IMPORT_CANCELLED'; }
}

export function createFileImportController({ readBrowserText, readNativeText } = {}) {
  if (typeof readBrowserText !== 'function' || typeof readNativeText !== 'function') {
    throw new TypeError('File Import requires browser and native text readers.');
  }
  let destroyed = false;
  let pending = null;
  const assertActive = () => { if (destroyed) throw new Error('File Import is destroyed.'); };
  const cancel = () => {
    if (!pending) return false;
    pending.abort();
    return true;
  };

  function read(name, filePath, load) {
    assertActive();
    cancel();
    const operation = new AbortController();
    pending = operation;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        operation.signal.removeEventListener('abort', onAbort);
        if (pending === operation) pending = null;
        callback(value);
      };
      const onAbort = () => finish(reject, new FileImportCancelledError());
      operation.signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve().then(() => {
        if (operation.signal.aborted) throw new FileImportCancelledError();
        return load(operation.signal);
      }).then(content => {
        if (settled) return;
        if (typeof content !== 'string') {
          finish(reject, new TypeError('File Import reader must return text.'));
          return;
        }
        finish(resolve, Object.freeze({ kind: IMPORT_KINDS.TEXT, name, filePath, content }));
      }, error => finish(reject, error));
    });
  }

  return Object.freeze({
    readBrowserFile(file) {
      assertActive();
      if (!file) return Promise.reject(new TypeError('File Import requires a file.'));
      return read(String(file.name || ''), '', signal => readBrowserText(file, { signal }));
    },
    readPath(path) {
      assertActive();
      const filePath = typeof path === 'string' ? path.trim() : '';
      if (classifyImportPath(filePath) !== IMPORT_KINDS.TEXT) {
        return Promise.reject(new TypeError('File Import requires a supported text path.'));
      }
      return read(filePath.split(/[\\/]/).pop(), filePath, () => readNativeText(filePath));
    },
    cancel() { assertActive(); return cancel(); },
    destroy() { if (destroyed) return; destroyed = true; cancel(); }
  });
}
