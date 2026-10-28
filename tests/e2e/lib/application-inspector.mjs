// DevTools-only access to the actual application owners for integration tests.
// No product hook, DOM property, global slot, source evaluation or replacement implementation.
// Opaque inspector handles stay in this test process and are released with its session.
import { readRemoteString } from './cdp-result-reader.mjs';
let sequence = 0;
const inspectors = new WeakMap();

function collectOwners() {
  const values = Array.from(this);
  const descriptor = (value, key) => {
    try { return value && Object.getOwnPropertyDescriptor(value, key); } catch { return undefined; }
  };
  const own = (value, key) => descriptor(value, key)?.value;
  const methods = (value, ...names) => names.every(name => typeof own(value, name) === 'function');
  const one = (label, predicate) => {
    const matches = values.filter(predicate);
    if (matches.length !== 1) throw new Error('Inspector expected one actual ' + label + '; found ' + matches.length
      + ' (' + matches.map(value => typeof value === 'function' ? value.name : Object.keys(value).join(',')).join(';') + ')');
    return matches[0];
  };
  const editorApi = one('Editor API', value => methods(value, 'runProgrammaticChange', 'loadDocument', 'subscribeDocumentChanges'));
  const model = one('DocumentModel', value => own(value, 'api') === editorApi && descriptor(value, 'journal') && descriptor(value, 'consumerVersions'));
  const owners = one('Export format owners', value => ['markdown','html','word','pdf'].every(key => methods(own(value, key), 'export', 'destroy'))
    && methods(own(value, 'image'), 'render', 'save', 'getPreview'));
  const platform = one('Platform', value => descriptor(value, 'capabilities') && methods(own(value, 'files'), 'readText', 'writeBinary')
    && own(value, 'clipboard') && own(value, 'fullscreen') && own(value, 'print'));
  const registered = command => value => {
    if (!methods(value, 'register', 'has', 'invoke')) return false;
    try { return value.has(command); } catch { return false; }
  };
  const presentation = one('Markdown presentation', value => methods(own(value, 'markdown'), 'parse', 'lexer')
    && methods(own(value, 'math'), 'renderTree') && methods(own(value, 'mermaid'), 'renderDiagram') && own(value, 'code'));
  const functionSource = value => {
    if (typeof value !== 'function') return '';
    try { return Function.prototype.toString.call(value); } catch { return ''; }
  };
  const encode = one('Image Data URL encoder', value => {
    const source = functionSource(value);
    return /^function\s+[\w$]+\s*\([^,)]*\)\s*\{/.test(source) && value !== collectOwners
      && source.includes('TextEncoder') && source.includes('16384') && source.includes('data:') && source.includes('atob(');
  });
  const loadDomToImage = one('DOM image loader', value => {
    const source = functionSource(value);
    return /^function\s+[\w$]+\s*\(/.test(source) && value !== collectOwners
      && source.includes('dom-to-image-more') && /\bimport\s*\(/.test(source) && /\.catch\s*\(/.test(source);
  });
  const capabilities = {
    markdownEditorPlatformPort: platform,
    markdownEditorDocumentControllerPort: one('Document Controller', value => methods(value, 'newDocument', 'readDocumentContent', 'isStaleError')),
    markdownEditorDocumentSessionPort: one('Document Session', value => methods(value, 'insertRecord', 'replaceRecords', 'getActiveRecord')),
    markdownEditorEditorControllerPort: one('Editor Controller', value => methods(value, 'setText', 'subscribeTransactions', 'appendImportedMarkdown')),
    markdownEditorEditorUiCommandPort: one('Editor commands', registered('getLayoutMode')),
    markdownEditorDocumentUiCommandPort: one('Document commands', registered('importTextContent')),
    markdownEditorExportCommandPort: one('Export commands', value => methods(value, 'has', 'invoke', 'destroy') && !descriptor(value, 'register')),
    markdownEditorExportRequestPort: one('Export request policy', value => methods(value, 'createRequest') && descriptor(value, 'imageRatios')),
    markdownEditorExportTaskPort: one('Export Task Controller', value => methods(value, 'begin', 'finish', 'getSnapshot', 'isCancelled')),
    markdownEditorExportDocumentPort: one('Export Builder', value => methods(value, 'build', 'getSourceContext', 'destroy')),
    markdownEditorExportEnhancementPort: one('Export Enhancer', value => methods(value, 'enhance', 'destroy')),
    markdownEditorExportStylePort: one('Export stylesheet', value => methods(value, 'getCss', 'apply', 'destroy')),
    markdownEditorImageAssetPort: one('Image assets', value => methods(value, 'prepare', 'destroy') && descriptor(value, 'placeholder')),
    markdownEditorImageLayoutPort: one('Image layout', value => methods(value, 'mount', 'destroy')
      && functionSource(own(value, 'mount')).includes('Image layout root')),
    // Namespaces contain the actual pure functions, without an algorithm or cache in this test helper.
    markdownEditorImageDataPort: Object.freeze({ encode }),
    markdownEditorPresentationPort: Object.freeze({ ...presentation, loadDomToImage }),
    markdownEditorPreviewCommandPort: one('Preview commands', value => methods(value, 'update', 'scheduleUpdate', 'resolvePerformanceMode') && descriptor(value, 'virtual')),
    markdownEditorPreviewRendererPort: one('Preview Renderer', value => methods(value, 'patchBlocks', 'renderMath', 'renderMermaid', 'start')),
    markdownEditorLayoutStatePort: one('Layout State', value => methods(value, 'setSidebar', 'setSplit', 'setCompact', 'setResize')),
    markdownEditorRecentFilesPort: one('Recent Files', value => methods(value, 'add', 'clear', 'load', 'subscribe')),
    markdownEditorSettingsStorePort: one('Settings Store', value => methods(value, 'openDraft', 'updateDraft', 'commit', 'get')),
    markdownEditorI18nPort: one('I18n', value => methods(value, 't', 'setLocale', 'subscribe')),
    markdownEditorHelpPort: one('Help', value => methods(value, 'open', 'close', 'navigate', 'openFirstRun')),
    markdownEditorSidebarControllerPort: one('Sidebar tabs', value => methods(value, 'registerLifecycle', 'select', 'isActive')),
    markdownEditorOutlineControllerPort: one('Outline', value => methods(value, 'replaceIndex', 'replacePreviewBlocks', 'updateActiveLine')),
    markdownEditorFolderTreeControllerPort: one('Folder Tree', value => methods(value, 'syncCurrentDocument', 'refresh', 'activate')),
    markdownEditorMarkdownExportPort: owners.markdown,
    markdownEditorHtmlExportPort: owners.html,
    markdownEditorWordExportPort: owners.word,
    markdownEditorPdfExportPort: owners.pdf,
    markdownEditorImageExportPort: owners.image
  };
  const selectionSync = one('Selection sync', value => own(value, 'editorApi') === editorApi
    && own(value, 'highlightSession') && typeof value.buildPreviewHighlightPlan === 'function');
  return { capabilities, editorApi, model, selectionSync };
}

function checked(response) {
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result;
}

// Preserve CDP completion for expressions and allow setup/cleanup statement scripts.
// Parsing happens in the test process; no eval or source rewriting runs in the app.
function evaluationBody(expression) {
  const source = String(expression).trim().replace(/;+$/, '');
  try { new Function('return (' + source + ');'); return 'return (' + source + ');'; }
  catch { return source; }
}

export function createApplicationInspector(connection) {
  if (typeof connection?.send !== 'function') throw new TypeError('Application inspector requires DevTools.');
  const group = 'mdr-integration-inspector-' + ++sequence;
  let handle = null, pending = null, destroyed = false, generation = 0;
  const reset = () => { generation++; handle = null; pending = null; };
  const unsubscribe = connection.on?.('Runtime.executionContextsCleared', reset);
  async function capture() {
    if (destroyed) throw new Error('Application inspector is destroyed.');
    if (handle) return handle;
    if (pending) return pending;
    const startedGeneration = generation;
    const transition = (async () => {
      const temporary = group + '-heap-' + startedGeneration;
      try {
        const prototype = checked(await connection.send('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: temporary }));
        const query = await connection.send('Runtime.queryObjects', { prototypeObjectId: prototype.objectId, objectGroup: temporary });
        const result = checked(await connection.send('Runtime.callFunctionOn', { objectId: query.objects.objectId,
          functionDeclaration: collectOwners.toString(), objectGroup: group }));
        if (destroyed || generation !== startedGeneration) {
          if (result.objectId) await connection.send('Runtime.releaseObject', { objectId: result.objectId });
          throw new Error('Application inspector context changed during capture.');
        }
        handle = result.objectId;
        if (!handle) throw new Error('Application inspector did not capture its actual owners.');
        return handle;
      } finally { await connection.send('Runtime.releaseObjectGroup', { objectGroup: temporary }); }
    })();
    pending = transition;
    try { return await transition; } finally { if (pending === transition) pending = null; }
  }
  return Object.freeze({
    async evaluate(expression, options = {}) {
      const objectId = await capture();
      const declarations = 'const applicationCapabilities=this.capabilities,editorApi=this.editorApi,documentModel=this.model,selectionSync=this.selectionSync;';
      if (options.awaitPromise !== false && options.returnByValue !== false) {
        const snapshot = checked(await connection.send('Runtime.callFunctionOn', { objectId,
          functionDeclaration: 'async function(){' + declarations + 'const value=await(async()=>{' + evaluationBody(expression) + '})();return {value:JSON.stringify({value})};}',
          awaitPromise: true, returnByValue: false, userGesture: options.userGesture !== false }));
        return JSON.parse(await readRemoteString(connection, snapshot.objectId)).value;
      }
      const result = checked(await connection.send('Runtime.callFunctionOn', { objectId,
        functionDeclaration: 'function(){' + declarations + evaluationBody(expression) + '}',
        awaitPromise: options.awaitPromise !== false, returnByValue: options.returnByValue !== false, userGesture: options.userGesture !== false }));
      return result?.value;
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true; reset(); unsubscribe?.();
      await connection.send('Runtime.releaseObjectGroup', { objectGroup: group });
    }
  });
}

export function evaluateApplication(page, expression, options) {
  if (!inspectors.has(page)) inspectors.set(page, createApplicationInspector(page.connection));
  return inspectors.get(page).evaluate(typeof expression === 'function' ? '(' + expression.toString() + ')()' : expression, options);
}

export async function releaseApplicationInspector(page) {
  const inspector = inspectors.get(page); inspectors.delete(page);
  await inspector?.destroy();
}

export async function waitForApplication(page, predicate, options = {}) {
  const until = Date.now() + (options.timeoutMs || 10000);
  do {
    if (await evaluateApplication(page, predicate)) return;
    await new Promise(resolve => setTimeout(resolve, options.intervalMs || 50));
  } while (Date.now() < until);
  throw new Error('Timed out waiting for ' + (options.description || 'application predicate'));
}
