import { createE2EQueryAPI } from '../features/e2e/index.js';

function isE2EEnabled() {
  try {
    return globalThis.__MARKDOWN_EDITOR_E2E__ === true
      || new URL(globalThis.location?.href || 'http://localhost/').searchParams.get('e2e') === '1';
  } catch (_) {
    return false;
  }
}

// Composition-only providers; no model, controller or platform object is published.
let providers = null;
let installed = null;
let previousDescriptor = null;

export function configureMarkdownEditorE2EPorts(value) {
  if (!isE2EEnabled()) return;
  if (installed) throw new Error('E2E already installed');
  if (typeof value?.readContext !== 'function' || typeof value?.readPreviewStats !== 'function') {
    throw new TypeError('E2E providers unavailable');
  }
  providers = Object.freeze({ readContext: value.readContext, readPreviewStats: value.readPreviewStats });
}

function getEditor() {
  return document.getElementById('editor');
}

function getLayoutMode() {
  const stored = localStorage.getItem('md_editor_layout_mode')
    || localStorage.getItem('md_editor_view_mode')
    || 'both';
  if (document.body.classList.contains('hybrid-view-mode')) return 'hybrid';
  const editorPane = document.querySelector('.editor-pane');
  const previewPane = document.querySelector('.preview-pane');
  const editorCollapsed = editorPane?.classList.contains('collapsed');
  const previewCollapsed = previewPane?.classList.contains('collapsed');
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

function readSnapshot() {
  const editor = getEditor();
  return {
    pendingMermaid: document.querySelectorAll('[data-mermaid-rendering="true"], .cm-hybrid-mermaid-status:not(.is-error)').length,
    ready: document.documentElement.classList.contains('app-ready'),
    layout: getLayoutMode(),
    presentationMode: editor?.virtualEditor?.getPresentationMode?.() || null,
    documentLength: editor?.textLength || 0,
    selectionStart: editor?.selectionStart || 0,
    selectionEnd: editor?.selectionEnd || 0,
    selectedText: editor?.value?.slice?.(editor.selectionStart || 0, editor.selectionEnd || 0) || '',
    presentationStats: editor?.virtualEditor?.getPresentationStats?.() || null,
    componentStates: editor?.virtualEditor?.getHybridComponentStates?.() || [],
    components: getComponentDomSnapshot(),
    activeElement: describeActiveElement()
  };
}

function createBrowserPorts(current) {
  return {
    readContext: () => current.readContext(),
    readPreviewStats: () => current.readPreviewStats(),
    readSnapshot,
    readText: () => getEditor()?.value || '',
    async importDocument(content, name, isCurrent) {
      const commands = document.getElementById('compatibility-business-ports')?.markdownEditorDocumentUiCommandPort;
      if (!commands?.has('importTextContent')) throw new Error('E2E import unavailable');
      const loaded = await commands.invoke('importTextContent', name, content, '');
      if (!isCurrent()) return { loaded: false };
      return { loaded: loaded === true, context: current.readContext() };
    },
    setLayout: mode => {
      if (typeof globalThis.setLayoutMode !== 'function') throw new Error('E2E layout unavailable');
      globalThis.setLayoutMode(mode, false);
    },
    setVisualEditing: options => {
      const editor = getEditor();
      if (!editor?.virtualEditor) throw new Error('E2E editor unavailable');
      if (options.code !== undefined) {
        editor.virtualEditor.setHybridCodeVisualEditing?.(options.code);
        localStorage.setItem('md_editor_code_visual_editing', options.code ? 'true' : 'false');
      }
      if (options.table !== undefined) {
        editor.virtualEditor.setHybridTableVisualEditing?.(options.table);
        localStorage.setItem('md_editor_table_visual_editing', options.table ? 'true' : 'false');
      }
    },
    focus: () => getEditor().focus({ preventScroll: true }),
    select: position => getEditor().setSelectionRange(position, position),
    scroll: (position, behavior, ratio) => getEditor().virtualEditor.scrollPositionIntoView?.(position, behavior, ratio),
    findText: (query, from, options) => getEditor().virtualEditor.findText?.(query, from, options),
    clearStorage: () => localStorage.clear(),
    now: () => performance.now(),
    schedule: (callback, ms) => setTimeout(callback, ms),
    cancel: id => clearTimeout(id),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id)
  };
}

export function installMarkdownEditorE2EBridge() {
  if (!isE2EEnabled() || globalThis.__markdownEditorE2E) return null;
  if (!providers) throw new Error('E2E providers unavailable');
  // Existing method names delegate to the sole semantic owner.
  const bridge = createE2EQueryAPI(createBrowserPorts(providers));
  previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__markdownEditorE2E');
  try {
    Object.defineProperty(globalThis, '__markdownEditorE2E', { configurable: true, value: bridge });
    installed = bridge;
  } catch (_) { bridge.destroy(); previousDescriptor = null; throw new Error('E2E installation unavailable'); }
  return bridge;
}

export function destroyMarkdownEditorE2EBridge() {
  const bridge = installed;
  installed = null;
  providers = null;
  if (!bridge) return;
  bridge.destroy();
  let restored = true;
  try {
    if (Object.getOwnPropertyDescriptor(globalThis, '__markdownEditorE2E')?.value === bridge) {
      if (previousDescriptor) Object.defineProperty(globalThis, '__markdownEditorE2E', previousDescriptor);
      else delete globalThis.__markdownEditorE2E;
    }
  } catch (_) { restored = false; }
  finally { previousDescriptor = null; }
  // A locked host slot must not block application feature teardown; its owner is already terminal.
  return restored;
}
