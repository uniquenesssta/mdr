function createFallbackTextarea(documentObject, text) {
  if (!documentObject || typeof documentObject.createElement !== 'function' || !documentObject.body) {
    throw new Error('Browser clipboard fallback is unavailable');
  }
  const textarea = documentObject.createElement('textarea');
  textarea.value = String(text ?? '');
  textarea.setAttribute?.('readonly', '');
  if (textarea.style) {
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
  }
  return textarea;
}

/** Browser text clipboard adapter with execCommand fallback owned at the platform boundary. */
export function createBrowserClipboard(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('browser clipboard options must be an object');
  }

  const navigatorObject = Object.hasOwn(options, 'navigatorObject')
    ? options.navigatorObject
    : globalThis.navigator;
  const documentObject = Object.hasOwn(options, 'documentObject')
    ? options.documentObject
    : globalThis.document;

  async function writeText(text) {
    const value = String(text ?? '');
    const nativeWrite = navigatorObject?.clipboard?.writeText;
    if (typeof nativeWrite === 'function') {
      await nativeWrite.call(navigatorObject.clipboard, value);
      return true;
    }

    if (typeof documentObject?.execCommand !== 'function') {
      throw new Error('Browser clipboard is unavailable');
    }

    const textarea = createFallbackTextarea(documentObject, value);
    documentObject.body.appendChild(textarea);
    try {
      textarea.select?.();
      textarea.setSelectionRange?.(0, value.length);
      if (!documentObject.execCommand('copy')) {
        throw new Error('Browser clipboard copy was rejected');
      }
      return true;
    } finally {
      textarea.remove?.();
      if (textarea.parentNode) documentObject.body.removeChild(textarea);
    }
  }

  return Object.freeze({ writeText });
}
