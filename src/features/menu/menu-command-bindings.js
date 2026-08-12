/**
 * Responsibility: Define stable Menu command IDs and own runtime command-handler registrations.
 * Imports: None; business features, DOM, persistence and platform APIs are forbidden.
 * Exports: MENU_COMMAND_IDS and createMenuCommandBindings().
 * State/side effects: Owns only handler registrations and close-after-execute policy; no business or UI state.
 * Lifecycle: Explicit idempotent destroy; terminal after destroy.
 */
export const MENU_COMMAND_IDS = Object.freeze({
  DOCUMENT_NEW: 'document.new',
  FILE_OPEN: 'file.open',
  DOCUMENT_SAVE: 'document.save',
  DOCUMENT_SAVE_AS: 'document.save-as',
  DOCUMENT_RENAME_ACTIVE: 'document.rename-active',
  SETTINGS_OPEN: 'settings.open',
  IMPORT_WEB: 'import.web',
  EXPORT_MARKDOWN: 'export.markdown',
  EXPORT_WORD: 'export.word',
  EXPORT_PDF: 'export.pdf',
  EXPORT_HTML: 'export.html',
  EXPORT_IMAGE: 'export.image',
  EDITOR_UNDO: 'editor.undo',
  EDITOR_REDO: 'editor.redo',
  EDITOR_BOLD: 'editor.bold',
  EDITOR_ITALIC: 'editor.italic',
  EDITOR_UNDERLINE: 'editor.underline',
  EDITOR_FIND: 'editor.find',
  DOCUMENT_CLEAR_ACTIVE: 'document.clear-active',
  LAYOUT_TOGGLE_SIDEBAR: 'layout.toggle-sidebar',
  LAYOUT_MODE_BOTH: 'layout.mode.both',
  LAYOUT_MODE_EDIT: 'layout.mode.edit',
  LAYOUT_MODE_PREVIEW: 'layout.mode.preview',
  PAGE_FULLSCREEN_TOGGLE: 'layout.fullscreen.page-toggle',
  SYSTEM_FULLSCREEN_TOGGLE: 'layout.fullscreen.system-toggle',
  EDITOR_HEADING_1: 'editor.heading.1',
  EDITOR_HEADING_2: 'editor.heading.2',
  EDITOR_HEADING_3: 'editor.heading.3',
  EDITOR_HEADING_4: 'editor.heading.4',
  EDITOR_HEADING_5: 'editor.heading.5',
  EDITOR_HEADING_6: 'editor.heading.6',
  EDITOR_LINK_OPEN: 'editor.link.open',
  EDITOR_IMAGE_OPEN: 'editor.image.open',
  EDITOR_TABLE_INSERT_3X3: 'editor.table.insert-3x3',
  EDITOR_TABLE_VISUAL_TOGGLE: 'editor.table.visual-toggle',
  EDITOR_CODE_VISUAL_TOGGLE: 'editor.code.visual-toggle',
  EDITOR_MATH_INLINE: 'editor.math.inline',
  EDITOR_MATH_BLOCK: 'editor.math.block',
  EDITOR_MERMAID_OPEN: 'editor.mermaid.open',
  HELP_OPEN: 'help.open'
});

const COMMAND_ID_SET = new Set(Object.values(MENU_COMMAND_IDS));

export function isMenuCommandId(value) {
  return COMMAND_ID_SET.has(String(value || ''));
}

export function createMenuCommandBindings() {
  const handlers = new Map();
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('MenuCommandBindings is destroyed.');
  };

  function register(commandId, handler, { closeMenu = true } = {}) {
    assertActive();
    const id = String(commandId || '');
    if (!isMenuCommandId(id)) throw new Error(`Unknown Menu command ID: ${id || '<empty>'}.`);
    if (typeof handler !== 'function') throw new TypeError(`Menu command ${id} requires a handler.`);
    if (handlers.has(id)) throw new Error(`Menu command already registered: ${id}.`);
    const entry = Object.freeze({ handler, closeMenu: Boolean(closeMenu) });
    handlers.set(id, entry);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (handlers.get(id) === entry) handlers.delete(id);
    };
  }

  return Object.freeze({
    register,
    registerMany(values) {
      assertActive();
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError('Menu command registrations must be an object.');
      }
      const unregister = [];
      try {
        for (const [commandId, value] of Object.entries(values)) {
          if (typeof value === 'function') unregister.push(register(commandId, value));
          else unregister.push(register(commandId, value?.handler, { closeMenu: value?.closeMenu }));
        }
      } catch (error) {
        for (const dispose of unregister.reverse()) dispose();
        throw error;
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        for (const dispose of unregister.reverse()) dispose();
      };
    },
    has(commandId) {
      assertActive();
      return handlers.has(String(commandId || ''));
    },
    execute(commandId, payload) {
      assertActive();
      const id = String(commandId || '');
      const entry = handlers.get(id);
      if (!entry) throw new Error(`Menu command is unavailable: ${id || '<empty>'}.`);
      return Object.freeze({
        result: entry.handler(payload),
        closeMenu: entry.closeMenu
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      handlers.clear();
    }
  });
}
