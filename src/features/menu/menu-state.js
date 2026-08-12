/**
 * Responsibility: Own the immutable Menu declaration and enabled/visible selector values.
 * Imports: Stable Menu command IDs only; DOM, business handlers and platform APIs are forbidden.
 * Exports: MENU_DECLARATION, MENU_SELECTORS and createMenuState().
 * State/side effects: Owns selector booleans and synchronous immutable subscriptions; no DOM or business side effects.
 * Lifecycle: Explicit idempotent destroy; terminal after destroy.
 */
import { MENU_COMMAND_IDS } from './menu-command-bindings.js';

export const MENU_SELECTORS = Object.freeze({ ALWAYS: 'always' });
const A = MENU_SELECTORS.ALWAYS;

const descriptor = (labelKey, commandId, shortcut = '') => Object.freeze({
  labelKey,
  commandId,
  shortcut,
  enabledSelector: A,
  visibleSelector: A
});

export const MENU_DECLARATION = Object.freeze([
  descriptor('menu.file.newDocument', MENU_COMMAND_IDS.DOCUMENT_NEW, 'Ctrl+N'),
  descriptor('menu.file.open', MENU_COMMAND_IDS.FILE_OPEN, 'Ctrl+O'),
  descriptor('menu.file.save', MENU_COMMAND_IDS.DOCUMENT_SAVE, 'Ctrl+S'),
  descriptor('menu.file.saveAs', MENU_COMMAND_IDS.DOCUMENT_SAVE_AS, 'Ctrl+Shift+S'),
  descriptor('menu.file.renameActive', MENU_COMMAND_IDS.DOCUMENT_RENAME_ACTIVE, 'F2'),
  descriptor('menu.file.settings', MENU_COMMAND_IDS.SETTINGS_OPEN, 'Ctrl+,'),
  descriptor('menu.file.importWeb', MENU_COMMAND_IDS.IMPORT_WEB),
  descriptor('menu.file.exportMarkdown', MENU_COMMAND_IDS.EXPORT_MARKDOWN),
  descriptor('menu.file.exportWord', MENU_COMMAND_IDS.EXPORT_WORD),
  descriptor('menu.file.exportPdf', MENU_COMMAND_IDS.EXPORT_PDF),
  descriptor('menu.file.exportHtml', MENU_COMMAND_IDS.EXPORT_HTML),
  descriptor('menu.file.exportImage', MENU_COMMAND_IDS.EXPORT_IMAGE),
  descriptor('menu.edit.undo', MENU_COMMAND_IDS.EDITOR_UNDO, 'Ctrl+Z'),
  descriptor('menu.edit.redo', MENU_COMMAND_IDS.EDITOR_REDO, 'Ctrl+Y'),
  descriptor('menu.edit.bold', MENU_COMMAND_IDS.EDITOR_BOLD, 'Ctrl+B'),
  descriptor('menu.edit.italic', MENU_COMMAND_IDS.EDITOR_ITALIC, 'Ctrl+I'),
  descriptor('menu.edit.underline', MENU_COMMAND_IDS.EDITOR_UNDERLINE, 'Ctrl+U'),
  descriptor('menu.edit.find', MENU_COMMAND_IDS.EDITOR_FIND, 'Ctrl+F'),
  descriptor('menu.edit.clear', MENU_COMMAND_IDS.DOCUMENT_CLEAR_ACTIVE),
  descriptor('menu.view.toggleSidebar', MENU_COMMAND_IDS.LAYOUT_TOGGLE_SIDEBAR, 'Ctrl+Shift+B'),
  descriptor('menu.view.both', MENU_COMMAND_IDS.LAYOUT_MODE_BOTH),
  descriptor('menu.view.edit', MENU_COMMAND_IDS.LAYOUT_MODE_EDIT),
  descriptor('menu.view.preview', MENU_COMMAND_IDS.LAYOUT_MODE_PREVIEW),
  descriptor('menu.view.pageFullscreen', MENU_COMMAND_IDS.PAGE_FULLSCREEN_TOGGLE, 'F11'),
  descriptor('menu.view.systemFullscreen', MENU_COMMAND_IDS.SYSTEM_FULLSCREEN_TOGGLE),
  descriptor('menu.insert.heading1', MENU_COMMAND_IDS.EDITOR_HEADING_1),
  descriptor('menu.insert.heading2', MENU_COMMAND_IDS.EDITOR_HEADING_2),
  descriptor('menu.insert.heading3', MENU_COMMAND_IDS.EDITOR_HEADING_3),
  descriptor('menu.insert.heading4', MENU_COMMAND_IDS.EDITOR_HEADING_4),
  descriptor('menu.insert.heading5', MENU_COMMAND_IDS.EDITOR_HEADING_5),
  descriptor('menu.insert.heading6', MENU_COMMAND_IDS.EDITOR_HEADING_6),
  descriptor('menu.insert.link', MENU_COMMAND_IDS.EDITOR_LINK_OPEN, 'Ctrl+K'),
  descriptor('menu.insert.image', MENU_COMMAND_IDS.EDITOR_IMAGE_OPEN, 'Ctrl+Shift+K'),
  descriptor('menu.insert.table3x3', MENU_COMMAND_IDS.EDITOR_TABLE_INSERT_3X3),
  descriptor('menu.insert.tableVisual', MENU_COMMAND_IDS.EDITOR_TABLE_VISUAL_TOGGLE),
  descriptor('menu.insert.codeVisual', MENU_COMMAND_IDS.EDITOR_CODE_VISUAL_TOGGLE),
  descriptor('menu.insert.mathInline', MENU_COMMAND_IDS.EDITOR_MATH_INLINE),
  descriptor('menu.insert.mathBlock', MENU_COMMAND_IDS.EDITOR_MATH_BLOCK),
  descriptor('menu.insert.mermaid', MENU_COMMAND_IDS.EDITOR_MERMAID_OPEN),
  descriptor('menu.help.open', MENU_COMMAND_IDS.HELP_OPEN)
]);

const DECLARATION_BY_ID = new Map(MENU_DECLARATION.map(item => [item.commandId, item]));

export function createMenuState({ selectors = {} } = {}) {
  let destroyed = false;
  let selectorValues = Object.freeze({ [A]: true, ...selectors });
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('MenuState is destroyed.');
  };

  const resolve = selector => selector === A || selectorValues[String(selector || '')] === true;

  return Object.freeze({
    get declaration() {
      assertActive();
      return MENU_DECLARATION;
    },
    get selectors() {
      assertActive();
      return selectorValues;
    },
    get(commandId) {
      assertActive();
      return DECLARATION_BY_ID.get(String(commandId || '')) || null;
    },
    isEnabled(commandId) {
      assertActive();
      const item = DECLARATION_BY_ID.get(String(commandId || ''));
      return Boolean(item && resolve(item.enabledSelector));
    },
    isVisible(commandId) {
      assertActive();
      const item = DECLARATION_BY_ID.get(String(commandId || ''));
      return Boolean(item && resolve(item.visibleSelector));
    },
    setSelector(selector, value, reason = 'set') {
      assertActive();
      const key = String(selector || '').trim();
      if (!key || key === A) return selectorValues;
      const nextValue = Boolean(value);
      if (selectorValues[key] === nextValue) return selectorValues;
      const previous = selectorValues;
      selectorValues = Object.freeze({ ...selectorValues, [key]: nextValue });
      const event = Object.freeze({ selector: key, value: nextValue, reason: String(reason || 'set') });
      for (const listener of [...listeners]) listener(selectorValues, previous, event);
      return selectorValues;
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('MenuState listener must be a function.');
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    }
  });
}
