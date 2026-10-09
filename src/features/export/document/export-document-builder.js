import { ExportCancelledError } from '../task/export-cancellation.js';

export class ExportDocumentStaleError extends ExportCancelledError {
  constructor() {
    super('document-changed');
    this.name = 'ExportDocumentStaleError';
    this.code = 'EXPORT_DOCUMENT_STALE';
  }
}

/**
 * Responsibility: Build a detached complete Markdown body from synchronized Preview blocks or an explicit model snapshot.
 * State: Owns only active builds and frame handles; never owns document, Worker, task or mounted preview state.
 * Lifecycle: destroy() rejects pending builds and releases frames; later build calls reject.
 * Dependencies: Injected public model, Preview capture, presentation, safe HTML materialization and frame capabilities.
 */
export function createExportDocumentBuilder({ documentRef, documentModel, getActiveDocumentId,
  preview, presentation, createHtmlNodes, requestFrame, cancelFrame,
  reportError = (message, error) => console.error(message, error) } = {}) {
  if (typeof documentRef?.createElement !== 'function' || typeof documentRef?.createDocumentFragment !== 'function'
    || typeof documentModel?.getDocumentVersion !== 'function' || typeof documentModel?.getTextLength !== 'function'
    || typeof documentModel?.createSnapshot !== 'function'
    || typeof getActiveDocumentId !== 'function' || typeof preview?.capture !== 'function'
    || typeof createHtmlNodes !== 'function' || typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new TypeError('Export Document Builder requires public document, Preview and DOM capabilities.');
  }
  let destroyed = false;
  let sourceContexts = new WeakMap();
  const builds = new Set();

  async function build({ task = null, documentId } = {}) {
    if (destroyed) throw new Error('Export Document Builder is destroyed.');
    task?.token.throwIfCancelled();
    if (documentId === undefined) documentId = getActiveDocumentId();
    const version = documentModel.getDocumentVersion();
    if (!documentId || documentId !== getActiveDocumentId()) throw new ExportDocumentStaleError();
    const entry = { stop: null };
    builds.add(entry);
    const assertCurrent = () => {
      if (destroyed) throw new ExportCancelledError('destroyed');
      task?.token.throwIfCancelled();
      if (documentId !== getActiveDocumentId() || version !== documentModel.getDocumentVersion()) {
        throw new ExportDocumentStaleError();
      }
    };
    const frame = async () => {
      let handle, settled = false;
      const pending = new Promise((resolve, reject) => {
        entry.stop = () => { settled = true; reject(new ExportCancelledError('destroyed')); };
        handle = requestFrame(() => { if (!settled) { settled = true; resolve(); } });
      });
      try { await (task ? task.token.waitFor(pending) : pending); }
      finally { settled = true; entry.stop = null; if (handle !== undefined) cancelFrame(handle); }
      assertCurrent();
    };
    try {
      assertCurrent();
      const body = documentRef.createElement('div');
      body.className = 'markdown-body';
      sourceContexts.set(body, Object.freeze({ documentId, documentVersion: version }));
      const source = preview.capture();
      assertCurrent();
      if (source?.blockCount > 0 && source.isCurrent()) {
        const batchSize = documentModel.getTextLength() >= 400000 ? 48 : 96;
        for (let start = 0; start < source.blockCount; start += batchSize) {
          assertCurrent();
          if (!source.isCurrent()) throw new ExportDocumentStaleError();
          const fragment = documentRef.createDocumentFragment();
          const end = Math.min(source.blockCount, start + batchSize);
          for (let index = start; index < end; index += 1) {
            assertCurrent();
            fragment.append(...source.createBlockNodes(index));
          }
          assertCurrent();
          body.append(fragment);
          task?.update(8 + Math.round((end / source.blockCount) * 52), `正在构建导出内容 ${end}/${source.blockCount} 块`, 'building');
          if (end < source.blockCount) await frame();
        }
        assertCurrent();
        if (!source.isCurrent()) throw new ExportDocumentStaleError();
        return body;
      }

      task?.update(12, '正在解析完整文档…', 'building');
      await frame();
      const text = documentModel.createSnapshot('full-preview-export');
      assertCurrent();
      let html = null;
      try {
        if (typeof presentation?.markdown?.parse === 'function') {
          const math = presentation.math;
          const protectedMath = math?.protectSource?.(text, 'EXPORT_MATH') || { text, placeholders: [] };
          const parsed = presentation.markdown.parse(protectedMath.text);
          html = math?.restoreSource?.(parsed, protectedMath.placeholders) ?? parsed;
        }
      } catch (error) { reportError('Export preview render error:', error); }
      assertCurrent();
      if (html === null) {
        const raw = documentRef.createElement('pre');
        raw.className = 'f-raw-fallback';
        raw.textContent = text;
        body.append(raw);
      } else {
        body.append(...createHtmlNodes(html));
      }
      assertCurrent();
      task?.update(60, '完整文档已解析', 'building');
      assertCurrent();
      return body;
    } finally { builds.delete(entry); }
  }

  return Object.freeze({
    build,
    getSourceContext(body) {
      if (destroyed) throw new ExportCancelledError('destroyed');
      const context = sourceContexts.get(body);
      if (!context) throw new TypeError('Export body must originate from this Document Builder.');
      return context;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sourceContexts = new WeakMap();
      for (const entry of builds) entry.stop?.();
    }
  });
}
