function createDestroyedError() {
  const error = new Error('NATIVE_SEARCH_ADAPTER_DESTROYED');
  error.code = 'NATIVE_SEARCH_ADAPTER_DESTROYED';
  return error;
}

/**
 * Owns only the native large-document search request mapping and terminal
 * adapter lifecycle. Search result offsets and backend version are returned
 * exactly as provided by the Platform documentStore command.
 */
export function createNativeSearchAdapter(options = {}) {
  const documentStore = options.documentStore || null;
  const supported = Boolean(options.available && typeof documentStore?.search === 'function');
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw createDestroyedError();
  }

  async function search(documentId, query, from = 0, wrap = true) {
    assertActive();
    if (!supported || !documentId || !query) return null;
    const result = await documentStore.search({
      documentId,
      query: String(query),
      from: Math.max(0, Number(from) || 0),
      wrap: wrap !== false
    });
    assertActive();
    return result;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
  }

  return Object.freeze({
    supported,
    get destroyed() { return destroyed; },
    search,
    destroy
  });
}
