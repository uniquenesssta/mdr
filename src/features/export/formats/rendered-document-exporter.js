import { createExportRequest } from '../application/export-request.js';
import { ExportCancelledError } from '../task/export-cancellation.js';

/** One lifecycle and output barrier for the two actual rendered text-file formats. */
export function createRenderedDocumentExporter({ format, documentModel, documents, builder, enhancer, assets, serializer, taskController, platform } = {}) {
  if (!['html', 'word'].includes(format)) throw new TypeError('Rendered document format must be HTML or Word.');
  const profile = ({ html: { label: 'HTML', filterName: 'HTML 文档', mimeType: 'text/html;charset=utf-8' },
    word: { label: 'Word', filterName: 'Word 文档', mimeType: 'application/msword;charset=utf-8' } })[format];
  const { label, filterName, mimeType } = profile;
  if (typeof documentModel?.getDocumentVersion !== 'function'
    || !['getRecord', 'isCurrentGeneration'].every(key => typeof documents?.[key] === 'function')
    || !['build', 'getSourceContext'].every(key => typeof builder?.[key] === 'function')
    || typeof enhancer?.enhance !== 'function' || typeof assets?.load !== 'function' || typeof serializer?.serialize !== 'function'
    || !['begin', 'finish'].every(key => typeof taskController?.[key] === 'function')
    || !platform?.capabilities || typeof platform.dialogs?.saveFile !== 'function' || typeof platform.files?.writeText !== 'function') {
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
      const nativeDialogs = Boolean(platform.capabilities.desktop?.dialogs), nativeFiles = Boolean(platform.capabilities.desktop?.fileSystem);
      let path = request.name;
      if (nativeDialogs && nativeFiles) {
        path = await wait(platform.dialogs.saveFile(request.name, {
          title: '导出 ' + label, extension: request.extension, extensions: request.extensions,
          filterName, defaultDirectory: request.directory
        }));
        assertCurrent();
        if (path === null || path === '') return Object.freeze({ status: 'cancelled', name: request.name });
        if (typeof path !== 'string') throw new TypeError(label + ' 保存路径无效');
      } else if (nativeDialogs || nativeFiles || !platform.capabilities.browser?.fileDownload) throw new Error(label + ' 文件导出能力不可用');
      assertCurrent();
      task.lockCancellation('writing');
      assertCurrent();
      const options = { extension: request.extension, reason: 'export', ...(!nativeFiles ? { mimeType } : {}) };
      await wait(platform.files.writeText(path, content, options));
      assertCurrent();
      task.update(100, label + ' 文件已生成');
      assertCurrent();
      return Object.freeze({ status: nativeFiles ? 'written' : 'downloaded', name: request.name, path });
    } catch (error) { outcome = 'failed'; throw error; }
    finally { pending.delete(stop); taskController.finish(task, outcome); }
  }
  return Object.freeze({ export: exportDocument, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const stop of pending) stop();
    pending.clear();
  } });
}
