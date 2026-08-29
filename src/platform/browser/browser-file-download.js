function resolveDocument(explicitDocument) {
  const documentObject = explicitDocument ?? globalThis.document;
  if (!documentObject || typeof documentObject.createElement !== 'function' || !documentObject.body) {
    throw new Error('Browser download document surface is unavailable');
  }
  return documentObject;
}

function resolveUrlApi(explicitUrlApi) {
  const urlApi = explicitUrlApi ?? globalThis.URL;
  if (!urlApi) throw new Error('Browser URL API is unavailable');
  return urlApi;
}

/** Browser download adapter. File format, name policy and user messaging remain with callers. */
export function createBrowserFileDownload(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('browser file download options must be an object');
  }

  const documentObject = resolveDocument(options.documentObject);
  const urlApi = resolveUrlApi(options.urlApi);

  function downloadUrl(source, fileName) {
    const anchor = documentObject.createElement('a');
    if (!anchor || typeof anchor.click !== 'function') {
      throw new Error('Browser download anchor is unavailable');
    }
    anchor.href = String(source ?? '');
    anchor.download = String(fileName ?? '');
    documentObject.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove?.();
      if (anchor.parentNode) documentObject.body.removeChild(anchor);
    }
  }

  function downloadBlob(blob, fileName) {
    if (typeof urlApi.createObjectURL !== 'function' || typeof urlApi.revokeObjectURL !== 'function') {
      throw new Error('Browser object URL API is unavailable');
    }
    const objectUrl = urlApi.createObjectURL(blob);
    try {
      downloadUrl(objectUrl, fileName);
    } finally {
      urlApi.revokeObjectURL(objectUrl);
    }
  }

  return Object.freeze({ downloadUrl, downloadBlob });
}
