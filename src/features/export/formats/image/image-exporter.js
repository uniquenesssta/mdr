import { createExportRequest } from '../../application/export-request.js';
import { ExportCancelledError } from '../../task/export-cancellation.js';

/** Final image workflow owner: source-bound PNG cache, preparation, irreversible
 * conversion and guarded binary publication. Surface owns DOM/leases; File Writer
 * owns dialog/output policy over existing Platform binary I/O. No classic globals, model internals or vendor import.
 * destroy interrupts cancellable waits, suppresses late results and observes
 * already-started PNG/write promises through settlement (it cannot abort them).
 */
export function createImageExporter({ documentModel, documents, builder, enhancer, assets, surface,
  encodeDataUrl, loadDomToImage, taskController, fileWriter } = {}) {
  if (typeof documentModel?.getDocumentVersion !== 'function'
    || !['getRecord', 'isCurrentGeneration'].every(key => typeof documents?.[key] === 'function')
    || !['build', 'getSourceContext'].every(key => typeof builder?.[key] === 'function')
    || typeof enhancer?.enhance !== 'function' || typeof assets?.prepare !== 'function'
    || !['mount', 'publish', 'clearPreview'].every(key => typeof surface?.[key] === 'function')
    || typeof encodeDataUrl !== 'function' || typeof loadDomToImage !== 'function'
    || !['begin', 'finish', 'cancel'].every(key => typeof taskController?.[key] === 'function')
    || typeof fileWriter?.write !== 'function') throw new TypeError('Image exporter requires public image, document, task and output capabilities.');
  let destroyed = false, revision = 0, preview = null;
  const pending = new Set();
  const alive = () => { if (destroyed) throw new ExportCancelledError('destroyed'); };
  const sourceCurrent = source => documents.activeId === source.documentId
    && documents.isCurrentGeneration(source.generation) && Boolean(documents.getRecord(source.documentId))
    && documentModel.getDocumentVersion() === source.documentVersion;
  const clearPreview = () => { preview = null; surface.clearPreview(); };
  const normalize = input => {
    alive();
    const request = createExportRequest(input && { ...input, imageOptions: input.imageOptions === null ? undefined : input.imageOptions });
    if (request.format !== 'image') throw new TypeError('Image Exporter received a different format.');
    if (!documents.getRecord(request.documentId)) throw new TypeError('Image export document does not exist.');
    if (request.documentId !== documents.activeId) throw new ExportCancelledError('document-changed');
    return request;
  };
  function operation(task, source, operationRevision = revision) {
    let stop;
    const stopped = new Promise((_resolve, reject) => { stop = () => reject(new ExportCancelledError('destroyed')); });
    // An irreversible operation may never use this race; still observe destruction.
    stopped.catch(() => {});
    const entry = { task, stop, revision: operationRevision }; pending.add(entry);
    const assertSource = () => {
      alive();
      if (!sourceCurrent(source)) throw new ExportCancelledError('document-changed');
      if (operationRevision !== revision) throw new ExportCancelledError('replaced');
    };
    return { entry, assertSource, assertCurrent() { assertSource(); task.token.throwIfCancelled(); },
      wait: value => Promise.race([task.token.waitFor(value), stopped]) };
  }
  async function render({ request: input } = {}) {
    const request = normalize(input);
    const source = Object.freeze({ documentId: request.documentId, documentVersion: documentModel.getDocumentVersion(), generation: documents.generation });
    const task = taskController.begin('正在生成图片预览');
    if (!task) return Object.freeze({ status: 'busy', name: request.name });
    // begin notifications may synchronously start a newer render. An obsolete
    // caller must not advance the cache revision or clear that caller's preview.
    try { task.token.throwIfCancelled(); }
    catch (error) { taskController.finish(task, 'failed'); throw error; }
    const op = operation(task, source, ++revision);
    let outcome = 'completed', finished = false, capture;
    try {
      clearPreview(); op.assertCurrent();
      task.update(5, '正在加载图片导出模块…', 'loading'); op.assertCurrent();
      const renderer = await op.wait(loadDomToImage()); op.assertCurrent();
      if (typeof renderer?.toPng !== 'function') throw new Error('图片导出模块不可用');
      let candidate;
      try {
        const body = await op.wait(builder.build({ task, documentId: request.documentId })); op.assertCurrent();
        const context = builder.getSourceContext(body);
        if (context.documentId !== source.documentId || context.documentVersion !== source.documentVersion) throw new ExportCancelledError('document-changed');
        capture = surface.mount(body, request.imageOptions); op.assertCurrent();
        await op.wait(enhancer.enhance({ root: body, task, documentId: request.documentId })); op.assertCurrent();
        task.update(90, '正在准备图片资源…', 'images'); op.assertCurrent();
        await op.wait(assets.prepare({ root: capture.root, task, isCurrent: () => !destroyed && sourceCurrent(source) })); op.assertCurrent();
        const geometry = capture.measure(); op.assertCurrent();
        // The vendor has no abort API. Lock before invoking toPng, retain the
        // capture leases until its actual promise settles, then recheck source.
        task.lockCancellation('encoding'); op.assertCurrent();
        task.update(96, '正在生成 PNG，此阶段完成前不能立即取消…', 'encoding'); op.assertCurrent();
        const dataUrl = await renderer.toPng(capture.root, { width: geometry.width, height: geometry.captureHeight,
          bgcolor: capture.background(), cacheBust: true, imagePlaceholder: assets.placeholder });
        op.assertCurrent();
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new TypeError('图片编码未返回 PNG');
        const bytes = encodeDataUrl(dataUrl); op.assertCurrent();
        if (!(bytes instanceof Uint8Array) || bytes.length < 8
          || ![137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) throw new TypeError('图片编码未返回 PNG 字节');
        candidate = { source, request, dataUrl, bytes: bytes.slice(), revision };
      } finally { capture?.release(); }
      op.assertCurrent();
      task.update(100, '图片预览已生成'); op.assertCurrent();
      finished = true; taskController.finish(task, outcome); op.assertSource();
      preview = candidate;
      surface.publish(candidate.dataUrl); op.assertSource();
      return Object.freeze({ status: 'ready', name: request.name, dataUrl: candidate.dataUrl });
    } catch (error) {
      outcome = 'failed';
      // Normalize even a late vendor rejection after disposal/replacement.
      try { if (finished) op.assertSource(); else op.assertCurrent(); } catch (cancelled) { error = cancelled; }
      if (preview?.revision === op.entry.revision) clearPreview();
      throw error;
    } finally { pending.delete(op.entry); if (!finished) taskController.finish(task, outcome); }
  }
  async function save({ request: input } = {}) {
    const request = normalize(input), cached = preview;
    if (!cached) return Object.freeze({ status: 'no-preview', name: request.name });
    if (!sourceCurrent(cached.source)) { clearPreview(); throw new ExportCancelledError('document-changed'); }
    if (request.imageOptions.ratio !== cached.request.imageOptions.ratio || request.imageOptions.cropFit !== cached.request.imageOptions.cropFit || request.imageOptions.background !== cached.request.imageOptions.background) {
      throw new ExportCancelledError('image-options-changed');
    }
    const bytes = cached.bytes.slice();
    const task = taskController.begin('正在保存图片');
    if (!task) return Object.freeze({ status: 'busy', name: request.name });
    const op = operation(task, cached.source, cached.revision);
    let outcome = 'completed';
    try {
      op.assertCurrent();
      task.update(70, '请选择图片保存路径…', 'preparing'); op.assertCurrent();
      const result = await fileWriter.write({ request, content: bytes, task,
        assertCurrent: op.assertCurrent, wait: op.wait });
      op.assertCurrent();
      if (result.status === 'cancelled') return result;
      op.assertCurrent(); task.update(100, '图片已保存'); op.assertCurrent();
      return result;
    } catch (error) {
      outcome = 'failed';
      try { op.assertCurrent(); } catch (cancelled) { error = cancelled; }
      throw error;
    }
    finally { pending.delete(op.entry); taskController.finish(task, outcome); }
  }
  return Object.freeze({ render, save,
    getPreview() {
      alive();
      if (preview && !sourceCurrent(preview.source)) clearPreview();
      return preview ? Object.freeze({ dataUrl: preview.dataUrl, name: preview.request.name,
        documentId: preview.source.documentId, documentVersion: preview.source.documentVersion,
        imageOptions: preview.request.imageOptions, revision: preview.revision }) : null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; ++revision;
      try { clearPreview(); } finally {
        for (const { task, stop } of pending) { stop(); if (task.current && task.cancelable) taskController.cancel(); }
      }
    }
  });
}
