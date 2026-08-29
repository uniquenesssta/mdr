/**
 * Responsibility: Adapt canonical Menu command IDs to the remaining classic application command surface during staged rewrite.
 * Imports: Stable Menu command IDs only; Menu declaration/state/view internals are forbidden.
 * Exports: createClassicMenuCommandAdapter().
 * State/side effects: Owns only registrations in MenuCommandBindings; it never owns document/editor/layout state.
 * Lifecycle: Explicit start/destroy; classic global lookup is lazy and therefore never copied into Menu Model state.
 */
import { MENU_COMMAND_IDS as C } from '../menu-command-bindings.js';

function requirePort(host, property, command) {
  const port = host?.[property];
  if (!port || typeof port.has !== 'function' || typeof port.invoke !== 'function' || !port.has(command)) {
    throw new Error(`Menu compatibility command is unavailable: ${property}.${command}.`);
  }
  return port;
}

function requireRecentFilesPort(host) {
  const port = host?.markdownEditorRecentFilesPort;
  if (!port || typeof port.clear !== 'function') {
    throw new Error('Menu compatibility command is unavailable: markdownEditorRecentFilesPort.clear.');
  }
  return port;
}

function normalizeRecentPath(host, value) {
  const port = host?.markdownEditorDocumentDomainPort;
  if (!port || typeof port.normalizeRecentPath !== 'function') {
    throw new Error('Menu compatibility command is unavailable: markdownEditorDocumentDomainPort.normalizeRecentPath.');
  }
  return port.normalizeRecentPath(value);
}

export function createClassicMenuCommandAdapter({ bindings, host, globalObject = globalThis }) {
  if (!bindings || typeof bindings.registerMany !== 'function') throw new TypeError('Classic Menu adapter requires MenuCommandBindings.');
  if (!host || typeof host !== 'object') throw new TypeError('Classic Menu adapter requires the compatibility host.');
  let destroyed = false;
  let unregister = null;

  const assertActive = () => {
    if (destroyed) throw new Error('ClassicMenuCommandAdapter is destroyed.');
  };

  const invokeGlobal = (name, ...args) => {
    const handler = globalObject?.[name];
    if (typeof handler !== 'function') throw new Error(`Classic Menu command is unavailable: ${name}.`);
    return handler(...args);
  };
  const invokeEditor = (name, ...args) => requirePort(host, 'markdownEditorEditorUiCommandPort', name).invoke(name, ...args);
  const invokeDocument = (name, ...args) => requirePort(host, 'markdownEditorDocumentUiCommandPort', name).invoke(name, ...args);

  const baseHandlers = {
    [C.DOCUMENT_NEW]: () => invokeDocument('newDocument'),
    [C.FILE_OPEN]: () => invokeGlobal('triggerImportFile'),
    [C.DOCUMENT_SAVE]: () => invokeGlobal('saveCurrentFile'),
    [C.DOCUMENT_SAVE_AS]: () => invokeGlobal('saveAsMarkdown'),
    [C.DOCUMENT_RENAME_ACTIVE]: () => invokeGlobal('renameCurrentDocument'),
    [C.RECENT_FILE_OPEN]: payload => {
      const path = normalizeRecentPath(host, payload?.path);
      if (!path) return false;
      return invokeGlobal('handleNativeDroppedPath', path);
    },
    [C.RECENT_FILES_CLEAR]: () => {
      const result = requireRecentFilesPort(host).clear();
      invokeGlobal('showToast', '已清空最近打开记录');
      return result;
    },
    [C.IMPORT_WEB]: () => invokeGlobal('openUrlModal'),
    [C.EXPORT_MARKDOWN]: () => invokeGlobal('exportFile'),
    [C.EXPORT_WORD]: () => invokeGlobal('exportWord'),
    [C.EXPORT_PDF]: () => invokeGlobal('exportPDF'),
    [C.EXPORT_HTML]: () => invokeGlobal('exportHTML'),
    [C.EXPORT_IMAGE]: () => invokeGlobal('openExportImageModal'),
    [C.EDITOR_UNDO]: () => invokeEditor('executeEditorAction', 'undo'),
    [C.EDITOR_REDO]: () => invokeEditor('executeEditorAction', 'redo'),
    [C.EDITOR_BOLD]: () => invokeEditor('executeEditorAction', 'bold'),
    [C.EDITOR_ITALIC]: () => invokeEditor('executeEditorAction', 'italic'),
    [C.EDITOR_UNDERLINE]: () => invokeEditor('executeEditorAction', 'underline'),
    [C.EDITOR_FIND]: () => invokeEditor('openFind', false),
    [C.DOCUMENT_CLEAR_ACTIVE]: () => invokeEditor('executeEditorAction', 'clear'),
    [C.LAYOUT_TOGGLE_SIDEBAR]: () => invokeGlobal('toggleSidebar'),
    [C.LAYOUT_MODE_BOTH]: () => invokeEditor('executeEditorAction', 'layout', 'both'),
    [C.LAYOUT_MODE_EDIT]: () => invokeEditor('executeEditorAction', 'layout', 'edit'),
    [C.LAYOUT_MODE_PREVIEW]: () => invokeEditor('executeEditorAction', 'layout', 'preview'),
    [C.PAGE_FULLSCREEN_TOGGLE]: () => invokeEditor('executeEditorAction', 'page-fullscreen'),
    [C.SYSTEM_FULLSCREEN_TOGGLE]: () => invokeEditor('executeEditorAction', 'system-fullscreen'),
    [C.EDITOR_HEADING_1]: () => invokeEditor('executeEditorAction', 'heading', 1),
    [C.EDITOR_HEADING_2]: () => invokeEditor('executeEditorAction', 'heading', 2),
    [C.EDITOR_HEADING_3]: () => invokeEditor('executeEditorAction', 'heading', 3),
    [C.EDITOR_HEADING_4]: () => invokeEditor('executeEditorAction', 'heading', 4),
    [C.EDITOR_HEADING_5]: () => invokeEditor('executeEditorAction', 'heading', 5),
    [C.EDITOR_HEADING_6]: () => invokeEditor('executeEditorAction', 'heading', 6),
    [C.EDITOR_LINK_OPEN]: () => invokeEditor('openLink'),
    [C.EDITOR_IMAGE_OPEN]: () => invokeEditor('openImage'),
    [C.EDITOR_TABLE_INSERT_3X3]: () => invokeEditor('insertTable', 3, 3),
    [C.EDITOR_TABLE_VISUAL_TOGGLE]: { handler: payload => invokeGlobal('toggleTableVisualEditing', payload?.event), closeMenu: false },
    [C.EDITOR_CODE_VISUAL_TOGGLE]: { handler: payload => invokeGlobal('toggleCodeVisualEditing', payload?.event), closeMenu: false },
    [C.EDITOR_MATH_INLINE]: () => invokeEditor('insertInlineMath'),
    [C.EDITOR_MATH_BLOCK]: () => invokeEditor('insertBlockMath'),
    [C.EDITOR_MERMAID_OPEN]: () => invokeEditor('openMermaid')
  };

  return Object.freeze({
    start() {
      assertActive();
      if (unregister) return false;
      unregister = bindings.registerMany(baseHandlers);
      return true;
    },
    closeMenus() {
      assertActive();
      const port = host?.markdownEditorEditorUiCommandPort;
      if (!port?.has?.('closeAppMenus')) return false;
      return port.invoke('closeAppMenus');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const dispose = unregister;
      unregister = null;
      dispose?.();
    }
  });
}
