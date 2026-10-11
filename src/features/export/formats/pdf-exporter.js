import { createExportRequest } from '../application/export-request.js';
import { ExportCancelledError } from '../task/export-cancellation.js';

/** PDF owns preparation/task identity; a separate surface owns only the temporary print document. */
export function createPdfExporter({ documentModel, documents, builder, enhancer, assets, surface, taskController } = {}) {
  if (typeof documentModel?.getDocumentVersion !== 'function'
    || !['getRecord', 'isCurrentGeneration'].every(key => typeof documents?.[key] === 'function')
    || !['build', 'getSourceContext'].every(key => typeof builder?.[key] === 'function')
    || typeof enhancer?.enhance !== 'function' || typeof assets?.load !== 'function'
    || typeof surface?.mount !== 'function' || !['begin', 'finish'].every(key => typeof taskController?.[key] === 'function')) {
    throw new TypeError('PDF exporter requires public body, assets, print and task capabilities.');
  }
  let destroyed = false;
  const pending = new Set();
  async function exportDocument({ request: input } = {}) {
    if (destroyed) throw new ExportCancelledError('destroyed');
    const request = createExportRequest(input && { ...input, imageOptions: input.imageOptions === null ? undefined : input.imageOptions });
    if (request.format !== 'pdf') throw new TypeError('PDF Exporter received a different format.');
    if (!documents.getRecord(request.documentId)) throw new TypeError('PDF export document does not exist.');
    const generation = documents.generation, documentId = documents.activeId, version = documentModel.getDocumentVersion();
    if (request.documentId !== documentId) throw new ExportCancelledError('document-changed');
    const task = taskController.begin('正在准备 PDF');
    if (!task) return Object.freeze({ status: 'busy', name: request.name });
    let stop, lease, outcome = 'completed';
    const stopped = new Promise((_resolve, reject) => { stop = () => reject(new ExportCancelledError('destroyed')); });
    pending.add(stop);
    const wait = value => Promise.race([task.token.waitFor(value), stopped]);
    const assertCurrent = () => {
      if (destroyed) throw new ExportCancelledError('destroyed');
      task.token.throwIfCancelled();
      if (!documents.isCurrentGeneration(generation) || documents.activeId !== documentId
        || !documents.getRecord(documentId) || documentModel.getDocumentVersion() !== version) throw new ExportCancelledError('document-changed');
    };
    try {
      assertCurrent();
      const body = await wait(builder.build({ task, documentId }));
      assertCurrent();
      const source = builder.getSourceContext(body);
      if (source.documentId !== documentId || source.documentVersion !== version) throw new ExportCancelledError('document-changed');
      await wait(enhancer.enhance({ root: body, task, documentId }));
      assertCurrent();
      const fontCss = await wait(assets.load());
      assertCurrent();
      task.update(92, '正在准备独立打印文档…', 'serializing');
      assertCurrent();
      lease = surface.mount({ body, name: request.name, fontCss });
      await wait(lease.ready);
      assertCurrent();
      const completion = await wait(lease.print({ beforePrint() {
        assertCurrent();
        task.lockCancellation('printing');
        assertCurrent();
        task.update(100, '请在打印窗口选择另存为 PDF', 'printing');
        assertCurrent();
      } }));
      if (destroyed) throw new ExportCancelledError('destroyed');
      // Once printing was issued, completion only releases its own surface; it never resets a newer document.
      return Object.freeze({ status: 'printed', name: request.name, completion });
    } catch (error) { outcome = 'failed'; throw error; }
    finally {
      pending.delete(stop);
      try { lease?.release(); } finally { taskController.finish(task, outcome); }
    }
  }
  return Object.freeze({ export: exportDocument, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const stop of pending) stop();
    pending.clear();
  } });
}
