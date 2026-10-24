/**
 * Responsibility: Adapt the browser DOM and application ports to the E2E installation and readonly query contracts.
 * Imports: E2E installation and query owners only; no business implementation dependency.
 * Exports: configureMarkdownEditorE2EPorts, installMarkdownEditorE2EBridge and destroyMarkdownEditorE2EBridge via the E2E public entry.
 * State/side effects: One lazy installation owner; importing does not install a global or read browser DOM.
 * Lifecycle: Explicit configure/install and terminal owner destroy; the next explicit request creates a fresh installation.
 */
import { createE2EBridge } from './e2e-bridge.js';
import { createE2EQueryAPI } from './e2e-query-api.js';

let installation = null;
function getInstallation() {
  if (!installation) {
    installation = createE2EBridge({
      readEnvironment: () => ({
        testFlag: Object.getOwnPropertyDescriptor(globalThis, '__MARKDOWN_EDITOR_E2E__')?.value,
        url: globalThis.location?.href || 'http://localhost/'
      }),
      readSlotDescriptor: () => Object.getOwnPropertyDescriptor(globalThis, '__markdownEditorE2E')
        || ('__markdownEditorE2E' in globalThis ? { configurable: false } : undefined),
      defineSlot: descriptor => Object.defineProperty(globalThis, '__markdownEditorE2E', descriptor),
      deleteSlot: () => Reflect.deleteProperty(globalThis, '__markdownEditorE2E')
    });
  }
  return installation;
}

export function configureMarkdownEditorE2EPorts(value) {
  const owner = getInstallation();
  if (!owner.isEnabled()) { owner.configure(null); return; }
  if (typeof value?.readContext !== 'function' || typeof value?.readPreviewStats !== 'function' || typeof value?.editorApi?.getText !== 'function' || typeof value?.importDocument !== 'function') {
    throw new TypeError('E2E providers unavailable');
  }
  const current = Object.freeze({ readContext: value.readContext, readPreviewStats: value.readPreviewStats, setLayout: value.setLayout, editorApi: value.editorApi, importDocument: value.importDocument });
  owner.configure(() => createE2EQueryAPI(createBrowserPorts(current)));
}

function getLayoutMode() {
  const stored = localStorage.getItem('md_editor_layout_mode')
    || localStorage.getItem('md_editor_view_mode')
    || 'both';
  if (document.body.classList.contains('hybrid-view-mode')) return 'hybrid';
  const editorPane = document.querySelector('.f-editor-pane');
  const previewPane = document.querySelector('.f-preview-pane');
  const editorCollapsed = editorPane?.classList.contains('is-collapsed');
  const previewCollapsed = previewPane?.classList.contains('is-collapsed');
  if (editorCollapsed && !previewCollapsed) return 'preview';
  if (!editorCollapsed && previewCollapsed) return 'edit';
  return ['both', 'hybrid', 'edit', 'preview'].includes(stored) ? stored : 'both';
}

function describeActiveElement() {
  const element = document.activeElement;
  if (!(element instanceof Element)) return null;
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    className: String(element.className || ''),
    hybridBlockType: element.closest?.('[data-hybrid-block-type]')?.getAttribute?.('data-hybrid-block-type') || null
  };
}

function getComponentDomSnapshot() {
  return Array.from(document.querySelectorAll('[data-hybrid-block-type]')).map((element, index) => ({
    index,
    type: element.getAttribute('data-hybrid-block-type') || '',
    directEditing: Boolean(element.querySelector('[data-hybrid-code-editor], [data-hybrid-table-cell-input]')),
    sourceVisible: false,
    connected: element.isConnected
  }));
}

function readSnapshot(editor) {
  return {
    pendingMermaid: document.querySelectorAll('[data-mermaid-rendering="true"], .cm-hybrid-mermaid-status:not(.is-error)').length,
    ready: document.documentElement.classList.contains('app-ready'),
    layout: getLayoutMode(),
    presentationMode: editor?.getPresentationMode?.() || null,
    documentLength: editor.getTextLength(),
    selectionStart: editor.getSelection().start,
    selectionEnd: editor.getSelection().end,
    selectedText: editor.sliceText(editor.getSelection().start, editor.getSelection().end),
    presentationStats: editor?.getPresentationStats?.() || null,
    componentStates: editor?.getHybridComponentStates?.() || [],
    components: getComponentDomSnapshot(),
    activeElement: describeActiveElement()
  };
}

function createBrowserPorts(current) {
  return {
    readContext: () => current.readContext(),
    readPreviewStats: () => current.readPreviewStats(),
    readSnapshot: () => readSnapshot(current.editorApi),
    readText: () => current.editorApi.getText(),
    async importDocument(content, name, isCurrent) {
      const loaded = await current.importDocument(content, name);
      if (!isCurrent()) return { loaded: false };
      return { loaded: loaded === true, context: current.readContext() };
    },
    setLayout: mode => {
      if (typeof current.setLayout !== 'function') throw new Error('E2E layout unavailable');
      current.setLayout(mode);
    },
    setVisualEditing: options => {
      const editor = current.editorApi;
      if (!editor) throw new Error('E2E editor unavailable');
      if (options.code !== undefined) {
        editor.setHybridCodeVisualEditing?.(options.code);
        localStorage.setItem('md_editor_code_visual_editing', options.code ? 'true' : 'false');
      }
      if (options.table !== undefined) {
        editor.setHybridTableVisualEditing?.(options.table);
        localStorage.setItem('md_editor_table_visual_editing', options.table ? 'true' : 'false');
      }
    },
    focus: () => current.editorApi.focus({ preventScroll: true }),
    select: position => current.editorApi.setSelection(position, position),
    scroll: (position, behavior, ratio) => current.editorApi.scrollPositionIntoView?.(position, behavior, ratio),
    findText: (query, from, options) => current.editorApi.findText?.(query, from, options),
    clearStorage: () => localStorage.clear(),
    now: () => performance.now(),
    schedule: (callback, ms) => setTimeout(callback, ms),
    cancel: id => clearTimeout(id),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id)
  };
}

export function installMarkdownEditorE2EBridge() {
  return getInstallation().install();
}

export function destroyMarkdownEditorE2EBridge() {
  const owner = installation;
  installation = null;
  return owner?.destroy() ?? true;
}
