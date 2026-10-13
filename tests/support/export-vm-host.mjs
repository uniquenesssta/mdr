// Characterization host: invoke actual public Export Controller and format owners.
// Old scenario names map to explicit test-only command aliases; no retired product script/global is supplied.
// DOM/vendor/platform doubles prove orchestration only; actual Builder/Enhancer own the complete body.
// Retired Worker/enhancement globals are never supplied. Actual renderer output is checked in built-app tests.
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const mathCss = readFileSync(join(dirname(createRequire(import.meta.url).resolve('katex')), 'katex.css'), 'utf8');
import { createExportController, mountClassicExportCommandPort, createExportFileWriter, createImageExporter, createImageExportSurface, mountClassicImageExportPort, imageDataUrlToBytes, mountClassicImageDataPort, createImageAssetPreloader, mountClassicImageAssetPort, createImageExportLayout, mountClassicImageLayoutPort, createPdfExporter, createPdfPrintSurface, mountClassicPdfExportPort, createWordExporter, createWordDocumentSerializer, mountClassicWordExportPort, createHtmlFontAssets, createHtmlDocumentSerializer, createHtmlExporter, mountClassicHtmlExportPort, createMarkdownExporter, mountClassicMarkdownExportPort, createExportStyleSheet, mountClassicExportStylePort, createExportPreviewEnhancer, mountClassicExportEnhancementPort, createExportDocumentBuilder, mountClassicExportDocumentPort, createExportProgressStore, createExportProgressDialogView, createExportTaskController, mountClassicExportRequestPort, mountClassicExportTaskPort } from '../../src/features/export/index.js';
import { createBrowserPrint, createBrowserFileDownload } from '../../src/platform/index.js';
import { ModalShell } from '../../src/ui/components/modal-shell.js';
import { ExportProgressDocument } from './export-progress-dom.mjs';
import { createExportPrintDom } from './export-print-dom.mjs';

const markdownSource = readFileSync(new URL('../../public/app/core.js', import.meta.url), 'utf8');
const markdownDownload = markdownSource.slice(markdownSource.indexOf('    async function exportContextDocument('), markdownSource.indexOf('    function copyContextDocumentTitle('));

export function createExportVmHost({ desktop = false, sourceText = '原文 😀', name = 'report.md', savePath = 'C:\\exports\\report', failWrite = false, workerBlocks = null, workerVersion = 7, textLength = 20, parseError = false, imageHeight = 100, documentId = 'export-doc', documentIds = [documentId], imageOverrides = {} } = {}) {
  const calls = [], downloads = [], blobs = new Map(), timers = [], events = new Map(), nodes = new Map();
  let urlId = 0, frameCount = 0, onFrame = null;
  const printDom = createExportPrintDom({ onPrint: () => calls.push(['print']) });
  const node = (tag = 'div') => {
    let html = '', children = [];
    const classes = new Set(), attributes = new Map(), priorities = new Map();
    const style = { getPropertyValue(name) { return this[name] || ''; }, getPropertyPriority: name => priorities.get(name) || '',
      setProperty(name, value, priority = '') { this[name] = String(value); priorities.set(name, priority); }, removeProperty(name) { const value = this[name] || ''; delete this[name]; priorities.delete(name); return value; } };
    return {
      tagName: tag.toUpperCase(), style, dataset: {}, value: '', disabled: false, checked: false, scrollHeight: imageHeight,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, force) { const next = force ?? !classes.has(x); next ? classes.add(x) : classes.delete(x); return next; } },
      getAttribute: name => attributes.get(name) ?? null, hasAttribute: name => attributes.has(name),
      setAttribute(name, value) { attributes.set(name, String(value)); }, removeAttribute(name) { attributes.delete(name); if(name === 'src') delete this.src; },
      get children() { return children; },
      get textContent() { return html.replace(/<[^>]*>/g, '') + children.map(x => x.textContent || '').join(''); },
      set textContent(value) { html = escapeHtml(value); children = []; },
      get innerHTML() { return html + children.map(x => x.tagName === 'PRE' ? '<pre class="' + x.className + '">' + x.innerHTML + '</pre>' : x.innerHTML || '').join(''); },
      set innerHTML(value) { html = String(value); children = []; },
      append(...items) { for (const item of items) { if (item.fragment) this.append(...item.children); else { children.push(item); item.parentNode = this; } } },
      appendChild(item) { this.append(item); return item; },
      removeChild(item) { children = children.filter(x => x !== item); item.parentNode = null; },
      replaceChildren(...items) { html = ''; children = []; this.append(...items); },
      querySelector(selector) { return selector === '.markdown-body' ? children.find(x => x.className === 'markdown-body') || null : null; },
      querySelectorAll() { return []; }, matches() { return false; },
      contains(item) { return this === item || children.some(x => x === item || x.contains?.(item)); },
      dispatchEvent(event) { calls.push(['modal', event.type, event.detail?.reason || '']); return true; },
      click() { downloads.push({ name: this.download, href: this.href, blob: blobs.get(this.href) || null }); }
    };
  };
  const getNode = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const body = node('body'), head = node('head');
  const presentation = {
    markdown: { parse(value) { calls.push(['parse', value]); if (parseError) throw new Error('parse failed'); return '<p>' + escapeHtml(value) + '</p>'; } },
    code: { renderHighlightedCodeRows: () => calls.push(['code']) },
    math: { protectSource: text => ({ text, placeholders: [] }), restoreSource: html => html, containsMath: text => String(text || '').includes('$'), renderTree: () => calls.push(['math']), delimiters: [] },
    mermaid: { getTheme: () => 'default', async renderDiagram() { calls.push(['mermaid']); return { status: 'rendered' }; } },
    async loadDomToImage() { return { async toPng(root, options) { calls.push(['png', { ...options }, root.innerHTML]); return 'data:image/png;base64,iVBORw0KGgo='; } }; }
  };
  let viewMode = 'source';
  const previewPort = { getViewMode: () => viewMode, setViewMode(value) { viewMode = value; calls.push(['view', value]); }, reset: () => calls.push(['reset']), deactivateVirtual: () => calls.push(['deactivateVirtual']) };
  const host = {
    markdownEditorPlatformPort: { supports: name => name.startsWith('desktop.') ? desktop : name === 'browser.fileDownload' && !desktop, async call(capability, operation, ...args) { calls.push([operation, ...args]); if (operation === 'saveFile') return savePath; if (failWrite) throw new Error('write denied'); if (operation === 'writeBinary' && !desktop) return browserDownload.downloadBlob(new Blob([args[1]], { type: args[2].mimeType }), args[0]); } },
    markdownEditorPresentationPort: presentation, markdownEditorPreviewCommandPort: previewPort
  };
  for (const key of ['DocumentDomain', 'DocumentSession', 'DocumentController', 'DocumentUiCommand', 'SidebarController']) host['markdownEditor' + key + 'Port'] = {};
  host.markdownEditorDocumentSessionPort = { get activeId() { return documentId; } };
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
    document: { body, head, getElementById: id => id === 'compatibility-business-ports' ? host : getNode(id), createElement: tag => tag === 'iframe' ? printDom.document.createElement(tag) : node(tag), createDocumentFragment() { const result = node(); result.fragment = true; return result; }, querySelectorAll: () => [], querySelector: () => null },
    documentModel: { getDocumentVersion: () => 7, createSnapshot(reason) { calls.push(['snapshot', reason]); return sourceText; } },
    coreExportRequestPort: requestMount.port, coreExportTaskPort: taskMount.port,
    getActiveDocumentId: () => documentId,
    coreDocumentSessionPort: { getRecord: id => documentIds.includes(id) ? { id, title: name } : null },
    coreDocumentControllerPort: { generation: 1, isCurrentGeneration: generation => generation === 1, isStaleError: () => false,
      async readDocumentContent() { return { generation: 1, content: sourceText }; } },
    editor: { textLength, value: 'stale editor value' }, filenameInput: { value: name }, exportDirectory: 'C:\\custom',
    preview: node(),
    requestAnimationFrame(callback) { frameCount++; onFrame?.(frameCount); queueMicrotask(callback); },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    window: { addEventListener(name, callback) { events.set(name, callback); }, print() { calls.push(['print']); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Blob, TextEncoder, Uint8Array, atob, btoa, console: { error: (...args) => calls.push(['error', String(args[0])]) },
    URL: { createObjectURL(blob) { const url = 'blob:fixture-' + ++urlId; blobs.set(url, blob); calls.push(['objectURL', url]); return url; }, revokeObjectURL: url => calls.push(['revoke', url]) },
    showToast: message => calls.push(['toast', message]), t: key => key,
    getComputedStyle: () => ({ backgroundColor: '#ffffff' })
  });
  const browserDownload = createBrowserFileDownload({ documentObject: context.document, urlApi: context.URL });
  const documents = {
    get activeId() { return context.getActiveDocumentId(); },
    get generation() { return context.coreDocumentControllerPort.generation; },
    getRecord: id => context.coreDocumentSessionPort.getRecord(id),
    isCurrentGeneration: generation => context.coreDocumentControllerPort.isCurrentGeneration(generation),
    readDocumentContent: id => context.coreDocumentControllerPort.readDocumentContent(id)
  };
  const outputPlatform = {
    capabilities: { desktop: { get dialogs() { return host.markdownEditorPlatformPort.supports('desktop.dialogs'); }, get fileSystem() { return host.markdownEditorPlatformPort.supports('desktop.fileSystem'); } }, browser: { get fileDownload() { return host.markdownEditorPlatformPort.supports('browser.fileDownload'); } } },
    dialogs: { saveFile: (...args) => host.markdownEditorPlatformPort.call('dialogs', 'saveFile', ...args) },
    files: { writeBinary: (...args) => host.markdownEditorPlatformPort.call('files', 'writeBinary', ...args), writeText: (path, content, options) => desktop
      ? host.markdownEditorPlatformPort.call('files', 'writeText', path, content, options)
      : browserDownload.downloadBlob(new Blob([content], { type: options.mimeType }), path) }
  };
  const fileWriter = createExportFileWriter({ platform: outputPlatform });
  const markdownExporter = createMarkdownExporter({
    documentModel: context.documentModel, taskController,
    documents, fileWriter
  });
  const markdownMount = mountClassicMarkdownExportPort(host, markdownExporter);
  context.coreMarkdownExportPort = markdownMount.port;
  const styles = createExportStyleSheet({ documentRef: context.document, mathCss });
  const styleMount = mountClassicExportStylePort(host, styles);
  const assetTimers = new Map(); let assetTimerId = 0;
  const imageAssets = createImageAssetPreloader({
    createImage: () => new context.Image(), createCanvas: () => context.document.createElement('canvas'),
    setTimer(callback, delay) { const id = ++assetTimerId; assetTimers.set(id, { callback, delay }); return id; },
    clearTimer: id => assetTimers.delete(id),
    requestFrame: callback => context.requestAnimationFrame(callback), cancelFrame: handle => context.cancelAnimationFrame?.(handle)
  });
  const assetMount = mountClassicImageAssetPort(host, imageAssets);
  const dataMount = mountClassicImageDataPort(host, imageDataUrlToBytes);
  const imageLayout = createImageExportLayout();
  const layoutMount = mountClassicImageLayoutPort(host, imageLayout);
  const documentBuilder = createExportDocumentBuilder({
    documentRef: context.document, documentModel: { getDocumentVersion: () => context.documentModel.getDocumentVersion(), getTextLength: () => textLength, createSnapshot: (...args) => context.documentModel.createSnapshot(...args) },
    getActiveDocumentId: () => context.getActiveDocumentId(), presentation,
    preview: { capture: () => workerVersion === 7 && workerBlocks?.length ? Object.freeze({
      blockCount: workerBlocks.length, isCurrent: () => workerVersion === 7,
      createBlockNodes(index) { const block = workerBlocks[index]; calls.push(['block', block.id]); const result = node('p'); result.innerHTML = block.html; return [result]; }
    }) : null },
    createHtmlNodes(html) { const result = node('p'); result.innerHTML = html; return [result]; },
    requestFrame: callback => context.requestAnimationFrame(callback), cancelFrame: handle => context.cancelAnimationFrame?.(handle),
    reportError: (...args) => context.console.error(...args)
  });
  const documentMount = mountClassicExportDocumentPort(host, documentBuilder);
  const enhancer = createExportPreviewEnhancer({ documentRef: context.document,
    documentModel: context.documentModel, getActiveDocumentId: () => context.getActiveDocumentId(),
    builder: documentBuilder, presentation,
    requestFrame: callback => context.requestAnimationFrame(callback), cancelFrame: () => {} });
  const enhancementMount = mountClassicExportEnhancementPort(host, enhancer);
  const fontRoot = join(dirname(createRequire(import.meta.url).resolve('katex')), 'fonts');
  const assets = createHtmlFontAssets({ mathCss, loaders: Object.fromEntries(readdirSync(fontRoot)
    .filter(name => name.endsWith('.woff2')).map(name => [name, async () => 'data:font/woff2;base64,' + readFileSync(join(fontRoot, name)).toString('base64')])) });
  const htmlExporter = createHtmlExporter({ documentModel: context.documentModel, documents,
    builder: documentBuilder, enhancer, assets, serializer: createHtmlDocumentSerializer({ styles }),
    taskController, fileWriter });
  const htmlMount = mountClassicHtmlExportPort(host, htmlExporter);
  const wordExporter = createWordExporter({ documentModel: context.documentModel, documents,
    builder: documentBuilder, enhancer, assets, serializer: createWordDocumentSerializer({ styles }),
    taskController, fileWriter });
  const wordMount = mountClassicWordExportPort(host, wordExporter);
  const printSurface = createPdfPrintSurface({ documentRef: context.document, styles,
    printWindow: frameWindow => createBrowserPrint({ windowObject: frameWindow }).print(), setTimer: printDom.setTimer, clearTimer: printDom.clearTimer });
  const pdfExporter = createPdfExporter({ documentModel: context.documentModel, documents,
    builder: documentBuilder, enhancer, assets, surface: printSurface, taskController });
  const pdfMount = mountClassicPdfExportPort(host, pdfExporter);
  const captureRoots = [];
  const imageSurface = createImageExportSurface({ documentRef: { createElement(tag) {
      const root = context.document.createElement(tag); captureRoots.push(root); return root;
    } }, container: getNode('export-image-content'), stage: getNode('export-image-stage'),
    previewImage: getNode('export-image-preview'), layout: imageLayout, styles,
    readStyle: root => context.getComputedStyle(root) });
  const imageExporter = createImageExporter({ documentModel: context.documentModel, documents,
    builder: documentBuilder, enhancer, assets: imageAssets, surface: imageSurface,
    encodeDataUrl: data => dataMount.port.encode(data), loadDomToImage: () => presentation.loadDomToImage(),
    taskController, fileWriter, ...imageOverrides });
  const imageMount = mountClassicImageExportPort(host, imageExporter);
  context.currentImageRatio = '9:16';
  const imageView = { getOptions: () => ({ratio:context.currentImageRatio,cropFit:Boolean(getNode('image-crop-fit').checked)}),
    setRatio(value) { context.currentImageRatio=value; }, resetCrop() { getNode('image-crop-fit').checked=false; },
    open() { calls.push(['modal','open']); }, close() { return false; } };
  const controller = createExportController({ requests:requestMount.port, tasks:taskMount.port,
    owners:{markdown:markdownExporter,html:htmlExporter,word:wordExporter,pdf:pdfExporter,image:imageExporter},
    imageView,preview:host.markdownEditorPreviewCommandPort,
    readInput:()=>({name:context.filenameInput.value,directory:context.exportDirectory}),
    notify:message=>context.showToast(message),translate:(...args)=>context.t(...args),reportError:error=>context.console.error(error) });
  const commandMount = mountClassicExportCommandPort(host,controller);
  const aliases={exportFile:'exportMarkdown',exportHTML:'exportHtml',exportWord:'exportWord',exportPDF:'exportPdf',renderExportImagePreview:'renderImage',downloadExportImage:'saveImage',openExportImageModal:'openImage',closeExportImageModal:'closeImage'};
  for(const [name,action]of Object.entries(aliases))context[name]=()=>commandMount.port.invoke(action);
  context.selectImageRatio=ratio=>commandMount.port.invoke('selectRatio',{ratio});
  context.exportTaskPort=taskMount.port;context.exportRequestPort=requestMount.port;
  context.beginExportTask=title=>{const task=taskMount.port.begin(title);if(!task)context.showToast('当前导出正在生成文件，请稍候');return task;};
  context.finishExportTask=(...args)=>{try{return taskMount.port.finish(...args);}catch(error){context.showToast('导出清理失败：'+(error?.message||String(error)));return false;}};
  vm.runInContext(markdownDownload, context, {filename:'context-export-fixture',timeout:1000});
  return {
    context, calls, downloads, nodes, timers, events, printDom, commandMount, imageExporter, imageSurface, imageMount, captureRoots, imageAssets, assetMount, dataMount, assetTimers, pdfExporter, printSurface, imageLayout, layoutMount, taskController, documentBuilder, styles, markdownExporter, htmlExporter, wordExporter,
    preload: (root, task) => assetMount.port.prepare({ root, task }),
    enhance: (root, task) => enhancementMount.port.enhance({ root, task, documentId }), createNode: node,
    build: task => documentMount.port.build({ task, documentId }), taskPort: taskMount.port,
    cancel: () => nodes.get('export-progress-cancel').click(),
    destroy() { try { controller.destroy(); commandMount.destroy(); imageExporter.destroy(); imageMount.destroy(); imageSurface.destroy(); pdfExporter.destroy(); pdfMount.destroy(); printSurface.destroy(); wordExporter.destroy(); wordMount.destroy(); htmlExporter.destroy(); htmlMount.destroy(); markdownExporter.destroy(); markdownMount.destroy(); fileWriter.destroy(); taskController.destroy(); } finally { imageAssets.destroy(); assetMount.destroy(); dataMount.destroy(); imageLayout.destroy(); layoutMount.destroy(); enhancer.destroy(); enhancementMount.destroy(); styles.destroy(); styleMount.destroy(); documentBuilder.destroy(); documentMount.destroy(); progressView.destroy(); progressStore.destroy(); taskMount.destroy(); requestMount.destroy(); } },
    async runPdf() { const work = context.exportPDF(); await printDom.untilScheduled(); await printDom.fire(80); printDom.frames.at(-1).contentWindow.dispatchEvent({ type: 'afterprint' }); await work; },
    async renderImage(dataUrl) {
      if (dataUrl !== undefined) presentation.loadDomToImage = async () => ({ async toPng() { return dataUrl; } });
      await context.renderExportImagePreview();
    },
    imageData: () => imageExporter.getPreview()?.dataUrl || '',
    invoke: (name, ...args) => context[name](...args),
    evaluate: expression => vm.runInContext(expression, context),
    setFrameHook(callback) { onFrame = callback; },
    get frameCount() { return frameCount; }
  };
}
