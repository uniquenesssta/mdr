import { createTaskListRenderer } from '../../preview/index.js';
import { ExportCancelledError } from '../task/export-cancellation.js';
import { ExportDocumentStaleError } from './export-document-builder.js';

/**
 * Responsibility: Enhance one complete Builder body through the shared code/math/Mermaid presentation capabilities.
 * State: Owns only active enhancement jobs, temporary diagram targets and frame handles; task/model state stays external.
 * Lifecycle: destroy() interrupts waits and prevents late diagram publication; each body has one current enhancement job.
 */
export function createExportPreviewEnhancer({ documentRef, documentModel, getActiveDocumentId,
  builder, presentation, requestFrame, cancelFrame } = {}) {
  if (typeof documentRef?.createElement !== 'function' || typeof documentModel?.getDocumentVersion !== 'function'
    || typeof getActiveDocumentId !== 'function' || typeof builder?.getSourceContext !== 'function'
    || typeof presentation?.code?.renderHighlightedCodeRows !== 'function'
    || typeof presentation?.math?.renderTree !== 'function' || typeof presentation?.mermaid?.renderDiagram !== 'function'
    || typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new TypeError('Export Preview Enhancer requires public Builder, model, presentation and frame capabilities.');
  }
  let destroyed = false;
  const jobs = new Set(), owners = new WeakMap();

  async function enhance({ root, task = null, documentId } = {}) {
    if (destroyed) throw new ExportCancelledError('destroyed');
    task?.token.throwIfCancelled();
    const source = builder.getSourceContext(root);
    if (documentId !== undefined && documentId !== source.documentId) throw new ExportDocumentStaleError();
    const entry = { active: true, reason: null, stop: null };
    const previous = owners.get(root);
    if (previous) { previous.reason = 'replaced'; previous.stop?.(); }
    owners.set(root, entry); jobs.add(entry);
    const invalid = () => destroyed || !entry.active || entry.reason || owners.get(root) !== entry
      || task?.token.cancelled || source.documentId !== getActiveDocumentId()
      || source.documentVersion !== documentModel.getDocumentVersion();
    const assertCurrent = () => {
      if (destroyed) throw new ExportCancelledError('destroyed');
      task?.token.throwIfCancelled();
      if (entry.reason || owners.get(root) !== entry) throw new ExportCancelledError(entry.reason || 'replaced');
      if (source.documentId !== getActiveDocumentId() || source.documentVersion !== documentModel.getDocumentVersion()) {
        throw new ExportDocumentStaleError();
      }
    };
    const wait = async pending => {
      let rejectStopped;
      const stopped = new Promise((_resolve, reject) => { rejectStopped = reject; });
      entry.stop = () => rejectStopped(new ExportCancelledError(destroyed ? 'destroyed' : entry.reason || 'replaced'));
      try {
        const operation = Promise.race([Promise.resolve(pending), stopped]);
        const result = await (task ? task.token.waitFor(operation) : operation);
        assertCurrent();
        return result;
      } finally { entry.stop = null; }
    };
    const frame = async () => {
      let handle;
      try { await wait(new Promise(resolve => { handle = requestFrame(resolve); })); }
      finally { if (handle !== undefined) cancelFrame(handle); }
    };
    let taskLists;
    try {
      assertCurrent();
      taskLists = createTaskListRenderer({ root });
      const children = Array.from(root.children || []);
      for (let start = 0; start < children.length; start += 18) {
        assertCurrent();
        const batch = children.slice(start, start + 18);
        taskLists.render(batch);
        for (const node of batch) {
          assertCurrent();
          const codes = Array.from(node.querySelectorAll?.('pre > code') || []);
          if (node.matches?.('pre')) {
            const code = node.querySelector?.(':scope > code');
            if (code && !codes.includes(code)) codes.unshift(code);
          }
          const languageFor = code => String(code.className || '').split(/\s+/)
            .find(x => x.startsWith('language-'))?.slice(9) || 'text';
          const isDiagram = code => (presentation.code.getNormalizedCodeLanguage?.(languageFor(code))
            || languageFor(code).toLowerCase()) === 'mermaid';
          for (const code of codes) {
            assertCurrent();
            const language = languageFor(code);
            if (isDiagram(code)) continue;
            presentation.code.renderHighlightedCodeRows(code, String(code.textContent || ''), language, {
              variant: 'preview', includeSourceNewlines: true
            });
          }
          assertCurrent();
          if (presentation.math.containsMath?.(node.textContent) ?? String(node.textContent || '').includes('$')) {
            presentation.math.renderTree(node, { delimiters: presentation.math.delimiters, trust: false });
          }
          assertCurrent();
          for (const code of codes.filter(isDiagram)) {
            assertCurrent();
            const pre = code.closest?.('pre') || code.parentElement;
            const text = String(code.textContent || '').trim();
            if (!pre || !text) continue;
            const container = documentRef.createElement('div');
            container.className = 'mermaid';
            const cancelled = () => Boolean(invalid()) || !root.contains(pre) || String(code.textContent || '').trim() !== text;
            const result = await wait(presentation.mermaid.renderDiagram(container, text, {
              theme: presentation.mermaid.getTheme?.(documentRef.body) || 'default',
              cacheKey: `export:${source.documentId}:${source.documentVersion}`,
              renderIdPrefix: 'markdown-editor-export-mermaid', isCancelled: cancelled
            }));
            assertCurrent();
            if (result?.status === 'cancelled' || cancelled()) throw new ExportDocumentStaleError();
            pre.replaceWith(container);
          }
        }
        const end = Math.min(children.length, start + 18);
        task?.update(62 + Math.round((end / children.length) * 28), `正在增强导出内容 ${end}/${children.length}`, 'enhancing');
        assertCurrent();
        if (end < children.length) await frame();
      }
      assertCurrent();
      return root;
    } finally {
      entry.active = false; jobs.delete(entry);
      if (owners.get(root) === entry) owners.delete(root);
      taskLists?.destroy();
    }
  }
  return Object.freeze({ enhance, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of jobs) entry.stop?.();
  } });
}
