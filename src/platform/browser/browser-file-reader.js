export class BrowserFileReadCancelledError extends Error {
  constructor(message = 'Browser file read was cancelled') {
    super(message);
    this.name = 'BrowserFileReadCancelledError';
    this.code = 'BROWSER_FILE_READ_CANCELLED';
  }
}

function resolveFileReaderClass(explicitClass) {
  const FileReaderClass = explicitClass ?? globalThis.FileReader;
  if (typeof FileReaderClass !== 'function') throw new Error('Browser FileReader is unavailable');
  return FileReaderClass;
}

/** Browser FileReader adapter with explicit abort rejection and original read errors preserved. */
export function createBrowserFileReader(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('browser file reader options must be an object');
  }

  const FileReaderClass = resolveFileReaderClass(options.FileReaderClass);

  function read(file, method, { signal } = {}) {
    const cancellation = () => new BrowserFileReadCancelledError(options.cancelErrorMessage);
    if (signal?.aborted) return Promise.reject(cancellation());
    if (!file) return Promise.reject(new TypeError('browser file reader requires a file'));
    const reader = new FileReaderClass();
    if (typeof reader?.[method] !== 'function') {
      return Promise.reject(new Error(`Browser FileReader requires ${method}()`));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onSignalAbort);
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
        callback(value);
      };
      const onSignalAbort = () => {
        finish(reject, cancellation());
        if (reader.readyState === 1) reader.abort();
      };
      signal?.addEventListener('abort', onSignalAbort, { once: true });
      if (signal?.aborted) { onSignalAbort(); return; }
      reader.onload = () => finish(resolve, reader.result ?? '');
      reader.onerror = () => finish(reject, reader.error || new Error(options.readErrorMessage || 'Browser file read failed'));
      reader.onabort = () => finish(reject, cancellation());
      try {
        reader[method](file);
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function readText(file, readOptions) {
    return read(file, 'readAsText', readOptions);
  }

  function readDataUrl(file, readOptions) {
    return read(file, 'readAsDataURL', readOptions);
  }

  return Object.freeze({ readText, readDataUrl });
}
