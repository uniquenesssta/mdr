import { createExportRequest } from '../application/export-request.js';
import { ExportCancelledError } from '../task/export-cancellation.js';

/** One lifecycle and output barrier for the two actual rendered text-file formats. */
export function createRenderedDocumentExporter({ format, documentModel, documents, builder, enhancer, assets, serializer, taskController, fileWriter } = {}) {
  if (!['html', 'word'].includes(format)) throw new TypeError('Rendered document format must be HTML or Word.');
  const label = format === 'html' ? 'HTML' : 'Word';
  if (typeof documentModel?.getDocumentVersion !== 'function'
    || !['getRecord', 'isCurrentGeneration'].every(key => typeof documents?.[key] === 'function')
    || !['build', 'getSourceContext'].every(key => typeof builder?.[key] === 'function')
    || typeof enhancer?.enhance !== 'function' || typeof assets?.load !== 'function' || typeof serializer?.serialize !== 'function'
    || !['begin', 'finish'].every(key => typeof taskController?.[key] === 'function')
    || typeof fileWriter?.write !== 'function') {
    throw new TypeError('Rendered exporter requires public body, assets, task and platform capabilities.');
  }
  const pending = new Set();
  let destroyed = false;
  async function exportDocument({ request: input } = {}) {
    if (destroyed) throw new ExportCancelledError('destroyed');
    const request = createExportRequest(input && { ...input, imageOptions: input.imageOptions === null ? undefined : input.imageOptions });
    if (request.format !== format) throw new TypeError(label + ' Exporter received a different format.');
    if (!documents.getRecord(request.documentId)) throw new TypeError('Rendered export document does not exist.');
    const generation = documents.generation, documentId = documents.activeId, version = documentModel.getDocumentVersion();
    if (request.documentId !== documentId) throw new ExportCancelledError('document-changed');
    const task = taskController.begin('正在导出 ' + label);
    if (!task) return Object.freeze({ status: 'busy', name: request.name });
    let stop;
    const stopped = new Promise((_resolve, reject) => { stop = () => reject(new ExportCancelledError('destroyed')); });
    stopped.catch(() => {});
    pending.add(stop);
    const assertCurrent = () => {
      if (destroyed) throw new ExportCancelledError('destroyed');
      task.token.throwIfCancelled();
      if (!documents.isCurrentGeneration(generation) || documents.activeId !== documentId
        || !documents.getRecord(documentId) || documentModel.getDocumentVersion() !== version) {
        throw new ExportCancelledError('document-changed');
      }
    };
    const wait = value => Promise.race([task.token.waitFor(value), stopped]);
    let outcome = 'completed';
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
      task.update(92, '正在生成 ' + label + ' 文件…', 'serializing');
      assertCurrent();
      const content = serializer.serialize({ bodyHtml: body.innerHTML, name: request.name, fontCss });
      assertCurrent();
      if (typeof content !== 'string') throw new TypeError('Serialized HTML must be text.');
      const result = await fileWriter.write({ request, content, task, assertCurrent, wait });
      assertCurrent();
      if (result.status === 'cancelled') return result;
      task.update(100, label + ' 文件已生成');
      assertCurrent();
      return result;
    } catch (error) { outcome = 'failed'; try { assertCurrent(); } catch (cancelled) { error = cancelled; } throw error; }
    finally { pending.delete(stop); taskController.finish(task, outcome); }
  }
  return Object.freeze({ export: exportDocument, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const stop of pending) stop();
    pending.clear();
  } });
}
