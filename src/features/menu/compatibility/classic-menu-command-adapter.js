/**
 * Responsibility: Dispatch canonical Menu command IDs to the scoped feature command capabilities.
 * Imports: Stable Menu command IDs only; Menu declaration/state/view internals are forbidden.
 * Exports: createClassicMenuCommandAdapter().
 * State/side effects: Owns only registrations in MenuCommandBindings; it never owns document/editor/layout state.
 * Lifecycle: Explicit start/destroy; feature lookup is lazy and registrations own no copied feature state.
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

export function createClassicMenuCommandAdapter({ bindings, host }) {
  if (!bindings || typeof bindings.registerMany !== 'function') throw new TypeError('Classic Menu adapter requires MenuCommandBindings.');
  if (!host || typeof host !== 'object') throw new TypeError('Classic Menu adapter requires the compatibility host.');
  let destroyed = false;
  let unregister = null;

  const assertActive = () => {
    if (destroyed) throw new Error('ClassicMenuCommandAdapter is destroyed.');
  };

  const invokeEditor = (name, ...args) => requirePort(host, 'markdownEditorEditorUiCommandPort', name).invoke(name, ...args);
  const invokeExport = (name, payload) => requirePort(host, 'markdownEditorExportCommandPort', name).invoke(name, payload);
  const invokeDocument = (name, ...args) => requirePort(host, 'markdownEditorDocumentUiCommandPort', name).invoke(name, ...args);

  const baseHandlers = {
    [C.DOCUMENT_NEW]: () => invokeDocument('newDocument'),
    [C.FILE_OPEN]: () => invokeDocument('importFile'),
    [C.DOCUMENT_SAVE]: () => invokeEditor('saveCurrentFile'),
    [C.DOCUMENT_SAVE_AS]: () => invokeEditor('saveAsMarkdown'),
    [C.DOCUMENT_RENAME_ACTIVE]: () => invokeDocument('renameDocument'),
    [C.RECENT_FILE_OPEN]: payload => {
      const path = normalizeRecentPath(host, payload?.path);
      if (!path) return false;
      return invokeDocument('openImportPath', path);
    },
    [C.RECENT_FILES_CLEAR]: () => {
      const result = requireRecentFilesPort(host).clear();
      invokeEditor('notify', '已清空最近打开记录');
      return result;
    },
    [C.IMPORT_WEB]: () => invokeDocument('openWebClipper'),
    [C.EXPORT_MARKDOWN]: () => invokeExport('exportMarkdown'),
    [C.EXPORT_WORD]: () => invokeExport('exportWord'),
    [C.EXPORT_PDF]: () => invokeExport('exportPdf'),
    [C.EXPORT_HTML]: () => invokeExport('exportHtml'),
    [C.EXPORT_IMAGE]: () => invokeExport('openImage'),
    [C.EDITOR_UNDO]: () => invokeEditor('executeEditorAction', 'undo'),
    [C.EDITOR_REDO]: () => invokeEditor('executeEditorAction', 'redo'),
    [C.EDITOR_BOLD]: () => invokeEditor('executeEditorAction', 'bold'),
    [C.EDITOR_ITALIC]: () => invokeEditor('executeEditorAction', 'italic'),
    [C.EDITOR_UNDERLINE]: () => invokeEditor('executeEditorAction', 'underline'),
    [C.EDITOR_FIND]: () => invokeEditor('openFind', false),
    [C.DOCUMENT_CLEAR_ACTIVE]: () => invokeEditor('executeEditorAction', 'clear'),
    [C.LAYOUT_TOGGLE_SIDEBAR]: () => invokeEditor('toggleSidebar'),
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
    [C.EDITOR_TABLE_VISUAL_TOGGLE]: { handler: payload => invokeEditor('toggleTableVisualEditing', payload?.event), closeMenu: false },
    [C.EDITOR_CODE_VISUAL_TOGGLE]: { handler: payload => invokeEditor('toggleCodeVisualEditing', payload?.event), closeMenu: false },
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
