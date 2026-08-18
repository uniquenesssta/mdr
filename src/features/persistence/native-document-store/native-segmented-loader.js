const DEFAULT_DOCUMENT_CHUNK_BYTES = 512 * 1024;

function createLoadCancelledError() {
  return new Error('DOCUMENT_LOAD_CANCELLED');
}

function normalizeChunkBytes(value) {
  return Math.max(1, Number(value) || DEFAULT_DOCUMENT_CHUNK_BYTES);
}

/**
 * Owns native segmented-load traversal, content assembly, progress/yield and
 * cancellation-token invalidation without owning save/session/search state.
 */
export function createNativeSegmentedLoader(options = {}) {
  const documentStore = options.documentStore || null;
  const chunkBytes = normalizeChunkBytes(options.chunkBytes);
  const notify = typeof options.notify === 'function' ? options.notify : () => {};
  const yieldControl = typeof options.yieldControl === 'function'
    ? options.yieldControl
    : () => new Promise(resolve => setTimeout(resolve, 0));
  let loadSequence = 0;

  const supported = Boolean(
    documentStore?.loadManifest
    && documentStore?.readChunk
  );

  function beginLoad(loadOptions = {}) {
    const cancellable = loadOptions.cancelPrevious !== false;
    const sequence = cancellable ? ++loadSequence : loadSequence;
    return Object.freeze({ cancellable, sequence });
  }

  function assertCurrent(token) {
    if (token.cancellable && token.sequence !== loadSequence) {
      throw createLoadCancelledError();
    }
  }

  function cancelLoad() {
    loadSequence += 1;
  }

  async function loadSegmented(documentId, token) {
    notify({ state: 'loading-index', documentId, progress: 0 });
    try {
      const manifest = await documentStore.loadManifest(documentId);
      assertCurrent(token);
      if (!manifest) {
        return Object.freeze({ loaded: null, segmented: true, totalBytes: 0 });
      }

      notify({ state: 'manifest', documentId, progress: 0, manifest });
      const chunks = [];
      const totalBytes = Math.max(0, Number(manifest.contentBytes) || 0);
      let byteOffset = 0;

      while (byteOffset < totalBytes) {
        const chunk = await documentStore.readChunk(documentId, byteOffset, chunkBytes);
        assertCurrent(token);
        if (!chunk || Number(chunk.nextByteOffset) <= byteOffset) {
          throw new Error('后台文档分段读取未前进');
        }

        chunks.push(String(chunk.content || ''));
        byteOffset = Number(chunk.nextByteOffset) || totalBytes;
        notify({
          state: 'loading',
          documentId,
          loadedBytes: byteOffset,
          totalBytes,
          progress: totalBytes > 0 ? byteOffset / totalBytes : 1
        });
        await yieldControl();
        assertCurrent(token);
      }

      return Object.freeze({
        loaded: {
          ...manifest,
          contentChunks: chunks,
          segmented: true
        },
        segmented: true,
        totalBytes
      });
    } catch (error) {
      if (error?.message === 'DOCUMENT_LOAD_CANCELLED') throw error;
      notify({
        state: 'load-error',
        documentId,
        message: error?.message || String(error)
      });
      throw error;
    }
  }

  async function load(documentId, loadOptions = {}) {
    const token = beginLoad(loadOptions);
    if (!supported) {
      const loaded = await documentStore.load(documentId);
      assertCurrent(token);
      return Object.freeze({ loaded, segmented: false, totalBytes: 0 });
    }
    return loadSegmented(documentId, token);
  }

  return Object.freeze({
    supported,
    load,
    cancelLoad
  });
}
