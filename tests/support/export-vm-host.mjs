// Characterization host only: execute the unchanged classic exporter in a fresh VM.
// DOM/vendor/platform doubles expose orchestration, not native I/O or rendered pixels.
// Default hosts supply retired preview bindings to preserve old algorithm contracts;
// supplyRetiredPreviewBindings=false reproduces the current application failure.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createExportProgressStore, createExportProgressDialogView, createExportTaskController, mountClassicExportRequestPort, mountClassicExportTaskPort } from '../../src/features/export/index.js';
import { ModalShell } from '../../src/ui/components/modal-shell.js';
import { ExportProgressDocument } from './export-progress-dom.mjs';

const source = readFileSync(new URL('../../public/app/export.js', import.meta.url), 'utf8');
const markdownSource = readFileSync(new URL('../../public/app/core.js', import.meta.url), 'utf8');
const markdownDownload = markdownSource.slice(markdownSource.indexOf('    function exportMarkdownContent('), markdownSource.indexOf('    function copyContextDocumentTitle('));

export function createExportVmHost({ desktop = false, sourceText = '原文 😀', name = 'report.md', savePath = 'C:\\exports\\report', failWrite = false, workerBlocks = null, workerVersion = 7, textLength = 20, parseError = false, imageHeight = 100, supplyRetiredPreviewBindings = true, documentId = 'export-doc', documentIds = [documentId] } = {}) {
  const calls = [], downloads = [], blobs = new Map(), timers = [], events = new Map(), nodes = new Map();
  let urlId = 0, frameCount = 0, onFrame = null;
  const node = (tag = 'div') => {
    let html = '', children = [];
    const classes = new Set();
    return {
      tagName: tag.toUpperCase(), style: {}, dataset: {}, textContent: '', value: '', disabled: false, checked: false, scrollHeight: imageHeight,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, force) { const next = force ?? !classes.has(x); next ? classes.add(x) : classes.delete(x); return next; } },
      get children() { return children; },
      get innerHTML() { return html + children.map(x => x.innerHTML || '').join(''); },
      set innerHTML(value) { html = String(value); children = []; },
      append(...items) { for (const item of items) { if (item.fragment) children.push(...item.children); else children.push(item); } },
      appendChild(item) { this.append(item); return item; },
      removeChild(item) { children = children.filter(x => x !== item); },
      replaceChildren(...items) { html = ''; children = []; this.append(...items); },
      querySelector(selector) { return selector === '.markdown-body' ? children.find(x => x.className === 'markdown-body') || null : null; },
      querySelectorAll() { return []; }, matches() { return false; },
      dispatchEvent(event) { calls.push(['modal', event.type, event.detail?.reason || '']); return true; },
      click() { downloads.push({ name: this.download, href: this.href, blob: blobs.get(this.href) || null }); }
    };
  };
  const getNode = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const body = node('body');
  const presentation = {
    markdown: { parse(value) { calls.push(['parse', value]); if (parseError) throw new Error('parse failed'); return '<p>' + escapeHtml(value) + '</p>'; } },
    math: { protectSource: text => ({ text, placeholders: [] }), restoreSource: html => html, containsMath: () => false, renderTree: () => calls.push(['math']), delimiters: [] },
    async loadDomToImage() { return { async toPng(root, options) { calls.push(['png', { ...options }, root.innerHTML]); return 'data:image/png;base64,iVBORw0KGgo='; } }; }
  };
  let viewMode = 'source';
  const previewPort = { getViewMode: () => viewMode, setViewMode(value) { viewMode = value; calls.push(['view', value]); }, reset: () => calls.push(['reset']), deactivateVirtual: () => calls.push(['deactivateVirtual']) };
  const host = {
    markdownEditorPlatformPort: { supports: () => desktop, async call(capability, operation, ...args) { calls.push([operation, ...args]); if (operation === 'saveFile') return savePath; if (failWrite) throw new Error('write denied'); } },
    markdownEditorPresentationPort: presentation, markdownEditorPreviewCommandPort: previewPort
  };
  for (const key of ['DocumentDomain', 'DocumentSession', 'DocumentController', 'DocumentUiCommand', 'SidebarController']) host['markdownEditor' + key + 'Port'] = {};
  const taskController = createExportTaskController();
  const progressDocument = new ExportProgressDocument();
  const progressStore = createExportProgressStore(taskController);
  const progressView = createExportProgressDialogView({ overlayRoot: progressDocument.body, store: progressStore,
    onCancel: () => taskController.cancel(), createModalShell(root, options) {
      const shell = new ModalShell(root, options);
      // Fault adapter preserves opening/closing failure scenarios; production uses ModalShell directly.
      root.dispatchEvent = event => { calls.push(['modal', event.type, event.detail?.reason || '']); return true; };
      const request = (type, detail) => {
        root.dispatchEvent({ type: 'markdown-editor:modal-shell-' + type, detail });
        if (detail.error) throw detail.error;
      };
      return { isOpen: () => shell.isOpen(), destroy: () => shell.destroy(),
        open(content, options) { request('open', { options }); return shell.open(content, options); },
        close(reason) { const result = shell.close(reason); request('close', { reason }); return result; } };
    }
  });
  for (const id of ['export-progress-modal', 'export-progress-title', 'export-progress-value', 'export-progress-status', 'export-progress-cancel']) {
    nodes.set(id, progressDocument.getElementById(id));
  }
  const taskMount = mountClassicExportTaskPort(host, taskController);
  const requestMount = mountClassicExportRequestPort(host, { getActiveDocumentId: () => documentId, hasDocument: id => documentIds.includes(id) });
  const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const context = vm.createContext({
    document: { body, getElementById: id => id === 'compatibility-business-ports' ? host : getNode(id), createElement: node, createDocumentFragment() { const result = node(); result.fragment = true; return result; }, querySelectorAll: () => [], querySelector: () => null },
    documentModel: { getDocumentVersion: () => 7, createSnapshot(reason) { calls.push(['snapshot', reason]); return sourceText; } },
    coreExportRequestPort: requestMount.port,
    editor: { textLength, value: 'stale editor value' }, filenameInput: { value: name }, exportDirectory: 'C:\\custom',
    previewWorkerClient: workerBlocks ? { blocks: workerBlocks, workerVersion } : null,
    createPreviewNodesForBlock(block) { calls.push(['block', block.id]); const result = node('p'); result.innerHTML = block.html; return [result]; },
    preview: node(), observedPreviewBody: {}, escapeHtml,
    requestAnimationFrame(callback) { frameCount++; onFrame?.(frameCount); queueMicrotask(callback); },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    window: { addEventListener(name, callback) { events.set(name, callback); }, print() { calls.push(['print']); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Blob, TextEncoder, Uint8Array, atob, btoa, console: { error: (...args) => calls.push(['error', String(args[0])]) },
    URL: { createObjectURL(blob) { const url = 'blob:fixture-' + ++urlId; blobs.set(url, blob); calls.push(['objectURL', url]); return url; }, revokeObjectURL: url => calls.push(['revoke', url]) },
    showToast: message => calls.push(['toast', message]), t: key => key,
    styleTaskLists: () => calls.push(['taskLists']), renderMermaidBlocks: async () => calls.push(['mermaid']), getComputedStyle: () => ({ backgroundColor: '#ffffff' })
  });
  vm.runInContext(markdownDownload + '\n' + source, context, { filename: 'public/app/export.js', timeout: 1000 });
  if (!supplyRetiredPreviewBindings) {
    for (const key of ['previewWorkerClient', 'createPreviewNodesForBlock', 'styleTaskLists', 'renderMermaidBlocks', 'observedPreviewBody']) delete context[key];
  }
  return {
    context, calls, downloads, nodes, timers, events, taskController, taskPort: taskMount.port,
    cancel: () => nodes.get('export-progress-cancel').click(),
    destroy() { try { taskController.destroy(); } finally { progressView.destroy(); progressStore.destroy(); taskMount.destroy(); requestMount.destroy(); } },
    invoke: (name, ...args) => context[name](...args),
    evaluate: expression => vm.runInContext(expression, context),
    setFrameHook(callback) { onFrame = callback; },
    get frameCount() { return frameCount; }
  };
}
