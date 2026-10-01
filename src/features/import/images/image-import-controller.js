/**
 * Responsibility: Own cancellable File/native image reads and image insertion requests.
 * Imports: Pure Image Policy. Readers are injected; no DOM or Markdown formatting.
 * State/side effects: One active read and generation per controller; no shared dialog/drop state.
 * Lifecycle: cancel invalidates and aborts; destroy is terminal and idempotent.
 */
import { assessBrowserImage } from './image-policy.js';

export const isImageImportCancelled = error => error?.code === 'IMAGE_IMPORT_CANCELLED' || error?.code === 'BROWSER_FILE_READ_CANCELLED';
const cancelled = () => Object.assign(new Error('图片读取已取消'), { code: 'IMAGE_IMPORT_CANCELLED' });

export function createImageImportController({ readBrowserImage, readNativeImage } = {}) {
  if (typeof readBrowserImage !== 'function') throw new TypeError('Image Import requires a browser reader.');
  let destroyed = false, generation = 0, active = null;
  const assertActive = () => { if (destroyed) throw new Error('Image Import is destroyed.'); };
  function cancel() {
    generation++;
    const previous = active;
    active = null;
    previous?.abort();
  }
  async function read(load, signal) {
    assertActive();
    cancel();
    const id = generation, abort = new AbortController();
    active = abort;
    const forwardAbort = () => abort.abort();
    const onAbort = () => rejectAbort(cancelled());
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    abort.signal.addEventListener('abort', onAbort, { once: true });
    signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      if (signal?.aborted) abort.abort();
      // Attach both outcomes even for a pre-cancelled request; do not start its I/O.
      const value = await Promise.race([aborted, abort.signal.aborted ? Promise.reject(cancelled()) : load(abort.signal)]);
      if (destroyed || id !== generation || abort.signal.aborted) throw cancelled();
      return Object.freeze(value);
    } catch (error) {
      if (destroyed || id !== generation || abort.signal.aborted) throw cancelled();
      throw error;
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      abort.signal.removeEventListener('abort', onAbort);
      if (active === abort) active = null;
    }
  }
  return Object.freeze({
    readFile(file, { source = 'drop', confirmLargeFile = () => true, signal } = {}) {
      return read(async ownSignal => {
        const decision = assessBrowserImage(file, { source });
        if (!decision.allowed) throw Object.assign(new Error(decision.reason === 'too-large' ? '图片不能超过 5MB' : '请选择图片文件'), {
          code: decision.reason === 'too-large' ? 'IMAGE_IMPORT_TOO_LARGE' : 'IMAGE_IMPORT_UNSUPPORTED'
        });
        if (decision.requiresConfirmation && !confirmLargeFile(file)) throw cancelled();
        if (ownSignal.aborted) throw cancelled();
        const url = await readBrowserImage(file, { signal: ownSignal });
        return { url: String(url || ''), name: String(file.name || '') };
      }, signal);
    },
    readPath(path, { signal } = {}) {
      return read(async ownSignal => {
        if (typeof readNativeImage !== 'function') throw new Error('Native image reading is unavailable.');
        const url = await readNativeImage(path, { signal: ownSignal });
        return { url: String(url || ''), name: String(path).split(/[\\/]/).pop() || '' };
      }, signal);
    },
    createInsertion(url, options = {}) {
      assertActive();
      const source = String(url || '').trim();
      if (!source) return null;
      return Object.freeze({ url: source, options: Object.freeze({ ...options }) });
    },
    cancel,
    destroy() { if (destroyed) return; destroyed = true; cancel(); }
  });
}
