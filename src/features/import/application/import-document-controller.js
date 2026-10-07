/**
 * Own Import → Documents/Editor orchestration and the lifetime of one import intent.
 * Readers, document lifecycle and editor commands are public injected contracts.
 * Document bodies, records and persistence remain in Documents/Editor; UI is notified after commit.
 */
import { FileImportCancelledError } from '../files/file-import-controller.js';
import { isImageImportCancelled } from '../images/image-import-controller.js';

export function getImportedTextLength(source) {
  const text = String(source);
  let pairs = 0;
  for (let index = 0; index < text.length - 1; index++) {
    if (text.charCodeAt(index) === 13 && text.charCodeAt(index + 1) === 10) { pairs++; index++; }
  }
  return text.length - pairs;
}

export function createImportDocumentController({ files, images, documents, editor,
  prepareTransition = () => {}, getDocumentOptions = () => ({}),
  afterDocumentOpen = async () => true, addRecentFile = () => {},
  notify = () => {}, translate = key => key, record = () => {} } = {}) {
  if (typeof files?.readBrowserFile !== 'function' || typeof files?.readPath !== 'function'
    || typeof images?.readFile !== 'function' || typeof images?.readPath !== 'function'
    || typeof documents?.openExternalDocument !== 'function' || typeof documents?.captureOperation !== 'function'
    || typeof editor?.insertImage !== 'function' || typeof editor?.appendMarkdown !== 'function') {
    throw new TypeError('Import requires public reader, Documents and Editor contracts.');
  }
  let destroyed = false, generation = 0, pending = null;
  const assertActive = () => { if (destroyed) throw new Error('Import document controller is destroyed.'); };
  const cancel = () => {
    generation++;
    pending?.abort();
    pending = null;
    files.cancel();
    images.cancel();
  };
  const begin = request => {
    assertActive();
    cancel();
    const id = generation, abort = new AbortController();
    pending = abort;
    const forwardAbort = () => abort.abort();
    request?.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (request?.signal?.aborted) abort.abort();
    const current = () => !destroyed && id === generation && !abort.signal.aborted
      && (!request?.isCurrent || request.isCurrent());
    return { signal: abort.signal, current,
      assertCurrent() { if (!current()) throw new FileImportCancelledError(); },
      finish() {
        request?.signal?.removeEventListener('abort', forwardAbort);
        if (pending === abort) pending = null;
      }
    };
  };
  const ignored = (error, operation) => !operation.current()
    || ['FILE_IMPORT_CANCELLED', 'BROWSER_FILE_READ_CANCELLED', 'DOCUMENT_OPERATION_STALE'].includes(error?.code)
    || isImageImportCancelled(error);

  async function openText(name, filePath, read, details, request) {
    const operation = begin(request);
    try {
      operation.assertCurrent();
      prepareTransition('document-import');
      const result = await documents.openExternalDocument({
        ...getDocumentOptions(), title: name, filePath, signal: operation.signal,
        expectedTextLength: getImportedTextLength,
        async loadContent() {
          operation.assertCurrent();
          const value = await read(operation.signal);
          operation.assertCurrent();
          return value.content;
        }
      });
      operation.assertCurrent();
      if (!documents.isCurrentGeneration(result.generation)) return false;
      if (!await afterDocumentOpen(result)) return false;
      operation.assertCurrent();
      if (!documents.isCurrentGeneration(result.generation)) return false;
      if (filePath) addRecentFile(filePath, result.record.title);
      record('document.imported', { category: 'document.operation', status: 'ok', details: {
        documentId: result.record.id, sourceCharacters: result.sourceCharacters,
        editorCharacters: result.editorCharacters,
        normalizedCrLf: result.sourceCharacters - result.editorCharacters, ...details
      } });
      notify(translate('toastFileImported'));
      return true;
    } catch (error) {
      if (ignored(error, operation)) return false;
      record('document.import-error', { category: 'document.error', status: 'error', details: {
        fileName: String(name || ''), message: String(error?.message || error), ...details
      } });
      notify(String(error?.message || error));
      return false;
    } finally { operation.finish(); }
  }

  async function insertImage(read, request) {
    const operation = begin(request);
    const documentOperation = documents.captureOperation('image-import');
    try {
      operation.assertCurrent();
      const value = await read(operation.signal);
      operation.assertCurrent();
      if (!documents.isCurrentGeneration(documentOperation) || !value.url) return false;
      editor.insertImage(value.url, { alt: value.name });
      documents.ensureActiveForEditing(getDocumentOptions());
      notify(translate('toastImageInserted'));
      return true;
    } catch (error) {
      if (ignored(error, operation) || !documents.isCurrentGeneration(documentOperation)) return false;
      notify(error?.code === 'IMAGE_IMPORT_TOO_LARGE' ? translate('toastImageTooLarge')
        : error?.code === 'IMAGE_IMPORT_UNSUPPORTED' ? translate('toastDropUnsupported') : String(error?.message || error));
      return false;
    } finally { operation.finish(); }
  }

  return Object.freeze({
    openBrowserFile(file, request) {
      assertActive();
      if (!file) return Promise.resolve(false);
      return openText(file.name, '', signal => files.readBrowserFile(file, { signal }), { fileBytes: Number(file.size) || 0 }, request);
    },
    openNativeText(path, request) {
      return openText(String(path).split(/[\\/]/).pop(), path, signal => files.readPath(path, { signal }), { nativePath: path }, request);
    },
    openTextContent(name, content, filePath = '', request) {
      const source = String(content ?? '');
      return openText(name, filePath, async () => ({ content: source }), { sourceCharacters: source.length }, request);
    },
    insertBrowserImage: (file, request) => insertImage(signal => images.readFile(file, { signal }), request),
    insertNativeImage: (path, request) => insertImage(signal => images.readPath(path, { signal }), request),
    insertWebMarkdown(markdown) {
      assertActive();
      const source = String(markdown || '');
      if (!source.trim()) return false;
      cancel();
      editor.appendMarkdown(source);
      documents.ensureActiveForEditing(getDocumentOptions());
      return true;
    },
    cancel() { assertActive(); cancel(); },
    destroy() { if (destroyed) return; cancel(); destroyed = true; }
  });
}
