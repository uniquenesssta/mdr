import { createExportRequest } from '../application/export-request.js';
import { ExportCancelledError } from '../task/export-cancellation.js';

/**
 * Responsibility: Export exactly one raw model/document snapshot with the shared name policy.
 * State/lifecycle: Owns pending export waits only; destroy rejects them and suppresses late results.
 * Dependencies: Public Documents/model, Task Controller and the accepted Platform save/write ports.
 * Rendering, browser URL cleanup and native safe replacement remain with their existing owners.
 */
export function createMarkdownExporter({ documentModel, documents, taskController, platform } = {}) {
  if (typeof documentModel?.createSnapshot !== 'function' || typeof documentModel?.getDocumentVersion !== 'function'
    || !['getRecord', 'isCurrentGeneration', 'readDocumentContent'].every(key => typeof documents?.[key] === 'function')
    || !['begin', 'finish'].every(key => typeof taskController?.[key] === 'function')
    || !platform?.capabilities || typeof platform?.dialogs?.saveFile !== 'function'
    || typeof platform?.files?.writeText !== 'function') {
    throw new TypeError('Markdown Exporter requires public document, task and platform capabilities.');
  }
  let destroyed = false;
  const pending = new Set();

  async function exportMarkdown({ request: input, snapshotReason = 'export-markdown' } = {}) {
    if (destroyed) throw new ExportCancelledError('destroyed');
    // The shared policy represents non-image metadata with imageOptions:null in its result.
    const request = createExportRequest(input?.imageOptions === null ? { ...input, imageOptions: undefined } : input);
    if (request.format !== 'markdown') throw new TypeError('Markdown Exporter requires a Markdown request.');
    if (!['export-markdown', 'context-export'].includes(snapshotReason)) throw new TypeError('Unknown Markdown snapshot reason.');
    if (!documents.getRecord(request.documentId)) throw new TypeError('要导出的文档已不存在');
    const generation = documents.generation, activeId = documents.activeId;
    const active = request.documentId === activeId;
    const version = active ? documentModel.getDocumentVersion() : null;
    const task = taskController.begin('正在导出 Markdown');
    if (!task) return Object.freeze({ status: 'busy', name: request.name });
    let stop;
    const stopped = new Promise((resolve, reject) => { stop = () => reject(new ExportCancelledError('destroyed')); });
    // Synchronous capability failures can occur before the first asynchronous wait.
    stopped.catch(() => {});
    pending.add(stop);
    const assertCurrent = () => {
      if (destroyed) throw new ExportCancelledError('destroyed');
      task.token.throwIfCancelled();
      if (!documents.isCurrentGeneration(generation) || documents.activeId !== activeId
        || !documents.getRecord(request.documentId)
        || (active && documentModel.getDocumentVersion() !== version)) {
        throw new ExportCancelledError('document-changed');
      }
    };
    const wait = value => Promise.race([task.token.waitFor(value), stopped]);
    let outcome = 'completed';
    try {
      assertCurrent();
      task.update(15, '正在读取 Markdown 原文…', 'loading');
      assertCurrent();
      let content;
      if (active) content = documentModel.createSnapshot(snapshotReason);
      else {
        const result = await wait(documents.readDocumentContent(request.documentId));
        assertCurrent();
        if (!documents.isCurrentGeneration(result?.generation)) throw new ExportCancelledError('document-changed');
        content = result.content;
      }
      assertCurrent();
      if (typeof content !== 'string') throw new TypeError('Markdown 原文必须是文本');
      task.update(70, '正在准备 Markdown 文件…', 'serializing');
      assertCurrent();
      const nativeDialogs = Boolean(platform.capabilities.desktop?.dialogs);
      const nativeFiles = Boolean(platform.capabilities.desktop?.fileSystem);
      let path = request.name;
      if (nativeDialogs && nativeFiles) {
        path = await wait(platform.dialogs.saveFile(request.name, {
          title: '导出 Markdown', extension: request.extension, extensions: request.extensions,
          filterName: 'Markdown 文档', defaultDirectory: request.directory
        }));
        assertCurrent();
        if (path === null || path === '') return Object.freeze({ status: 'cancelled', name: request.name });
        if (typeof path !== 'string') throw new TypeError('Markdown 保存路径无效');
      } else if (nativeDialogs || nativeFiles || !platform.capabilities.browser?.fileDownload) {
        throw new Error('Markdown 文件导出能力不可用');
      }
      assertCurrent();
      task.lockCancellation('writing');
      assertCurrent();
      const options = nativeFiles ? { extension: request.extension, reason: 'export' }
        : { extension: request.extension, reason: 'export', mimeType: 'text/markdown;charset=utf-8' };
      await wait(platform.files.writeText(path, content, options));
      assertCurrent();
      task.update(100, 'Markdown 文件已生成');
      assertCurrent();
      return Object.freeze({ status: nativeFiles ? 'written' : 'downloaded', name: request.name, path });
    } catch (error) {
      outcome = 'failed';
      throw error;
    } finally {
      pending.delete(stop);
      taskController.finish(task, outcome);
    }
  }
  return Object.freeze({
    export: exportMarkdown,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const stop of pending) stop();
      pending.clear();
    }
  });
}
