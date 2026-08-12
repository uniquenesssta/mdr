/**
 * Responsibility: Project Menu Model command metadata onto existing Menu DOM and own command click delegation.
 * Imports: Stable Menu command IDs only; business functions, submenu geometry and recent-file data are forbidden.
 * Exports: createMenuView().
 * State/side effects: Owns only command-element metadata, enabled/visible projection and one capture click listener.
 * Lifecycle: Explicit start/destroy; destroy removes the listener and runtime command metadata.
 */
import { MENU_COMMAND_IDS as C } from './menu-command-bindings.js';

const command = id => Object.freeze({ type: 'command', id });
const separator = Object.freeze({ type: 'separator' });
const passthrough = id => Object.freeze({ type: 'passthrough', id });
const submenu = children => Object.freeze({ type: 'submenu', children: Object.freeze(children) });

const MENU_LAYOUT = Object.freeze({
  'file-menu': Object.freeze([
    command(C.DOCUMENT_NEW), command(C.FILE_OPEN), command(C.DOCUMENT_SAVE), command(C.DOCUMENT_SAVE_AS),
    command(C.DOCUMENT_RENAME_ACTIVE), command(C.SETTINGS_OPEN), passthrough('recent-files-menu-item'), separator,
    command(C.IMPORT_WEB), separator,
    submenu([command(C.EXPORT_MARKDOWN), command(C.EXPORT_WORD), command(C.EXPORT_PDF), command(C.EXPORT_HTML), command(C.EXPORT_IMAGE)])
  ]),
  'edit-menu': Object.freeze([
    command(C.EDITOR_UNDO), command(C.EDITOR_REDO), separator,
    command(C.EDITOR_BOLD), command(C.EDITOR_ITALIC), command(C.EDITOR_UNDERLINE), command(C.EDITOR_FIND), separator,
    command(C.DOCUMENT_CLEAR_ACTIVE)
  ]),
  'app-view-menu': Object.freeze([
    command(C.LAYOUT_TOGGLE_SIDEBAR), separator,
    command(C.LAYOUT_MODE_BOTH), command(C.LAYOUT_MODE_EDIT), command(C.LAYOUT_MODE_PREVIEW), separator,
    command(C.PAGE_FULLSCREEN_TOGGLE), command(C.SYSTEM_FULLSCREEN_TOGGLE)
  ]),
  'insert-menu': Object.freeze([
    submenu([
      command(C.EDITOR_HEADING_1), command(C.EDITOR_HEADING_2), command(C.EDITOR_HEADING_3),
      command(C.EDITOR_HEADING_4), command(C.EDITOR_HEADING_5), command(C.EDITOR_HEADING_6)
    ]),
    command(C.EDITOR_LINK_OPEN), command(C.EDITOR_IMAGE_OPEN), command(C.EDITOR_TABLE_INSERT_3X3),
    command(C.EDITOR_TABLE_VISUAL_TOGGLE), command(C.EDITOR_CODE_VISUAL_TOGGLE),
    submenu([command(C.EDITOR_MATH_INLINE), command(C.EDITOR_MATH_BLOCK)]),
    command(C.EDITOR_MERMAID_OPEN)
  ]),
  'help-menu': Object.freeze([command(C.HELP_OPEN)])
});

function assertRoot(root) {
  if (!root || typeof root.querySelector !== 'function' || typeof root.addEventListener !== 'function') {
    throw new TypeError('MenuView requires a Menu root element.');
  }
}

function directSubmenuList(owner) {
  for (const child of owner?.children || []) {
    if (child?.classList?.contains?.('menu-submenu-list')) return child;
  }
  return null;
}

function bindLayoutList(list, nodes, declarationById, commandElements) {
  const children = [...(list?.children || [])];
  if (children.length !== nodes.length) {
    throw new Error(`Menu DOM shape mismatch for ${list?.id || '<submenu>'}: expected ${nodes.length}, got ${children.length}.`);
  }
  nodes.forEach((node, index) => {
    const element = children[index];
    if (node.type === 'separator') {
      if (!element?.classList?.contains?.('menu-separator')) throw new Error('Menu separator shape mismatch.');
      return;
    }
    if (node.type === 'passthrough') {
      if (element?.id !== node.id) throw new Error(`Menu passthrough slot mismatch: ${node.id}.`);
      return;
    }
    if (node.type === 'submenu') {
      if (!element?.classList?.contains?.('menu-submenu')) throw new Error('Menu submenu shape mismatch.');
      const nested = directSubmenuList(element);
      if (!nested) throw new Error('Menu submenu list is missing.');
      bindLayoutList(nested, node.children, declarationById, commandElements);
      return;
    }
    const descriptor = declarationById.get(node.id);
    if (!descriptor) throw new Error(`Menu declaration is missing command: ${node.id}.`);
    if (!element?.classList?.contains?.('menu-item')) throw new Error(`Menu item shape mismatch: ${node.id}.`);
    element.dataset.menuCommand = descriptor.commandId;
    element.dataset.menuLabelKey = descriptor.labelKey;
    element.dataset.menuShortcut = descriptor.shortcut;
    element.removeAttribute?.('onclick');
    commandElements.set(descriptor.commandId, element);
  });
}

export function createMenuView({ root }) {
  assertRoot(root);
  let destroyed = false;
  let started = false;
  let onCommand = null;
  let clickListener = null;
  const commandElements = new Map();

  const assertActive = () => {
    if (destroyed) throw new Error('MenuView is destroyed.');
  };

  function bindDeclaration(declaration) {
    assertActive();
    if (!Array.isArray(declaration)) throw new TypeError('MenuView requires a Menu declaration array.');
    const declarationById = new Map(declaration.map(item => [item.commandId, item]));
    commandElements.clear();
    for (const [menuId, nodes] of Object.entries(MENU_LAYOUT)) {
      const list = root.querySelector(`#${menuId}`);
      if (!list) throw new Error(`Menu list is missing: ${menuId}.`);
      bindLayoutList(list, nodes, declarationById, commandElements);
    }
    if (commandElements.size !== declaration.length) {
      throw new Error(`Menu declaration/DOM command count mismatch: ${declaration.length}/${commandElements.size}.`);
    }
    return commandElements.size;
  }

  function setCommandState(commandId, { enabled, visible }) {
    assertActive();
    const element = commandElements.get(String(commandId || ''));
    if (!element) throw new Error(`MenuView command element is unavailable: ${commandId}.`);
    element.hidden = !visible;
    element.classList.toggle('disabled', !enabled);
    element.setAttribute?.('aria-disabled', enabled ? 'false' : 'true');
  }

  return Object.freeze({
    bindDeclaration,
    setCommandState,
    start(listener) {
      assertActive();
      if (started) return false;
      if (typeof listener !== 'function') throw new TypeError('MenuView command listener must be a function.');
      onCommand = listener;
      clickListener = event => {
        const target = event?.target?.closest?.('[data-menu-command]');
        if (!target || !root.contains?.(target)) return;
        if (target.hidden || target.classList?.contains?.('disabled') || target.getAttribute?.('aria-disabled') === 'true') {
          event.preventDefault?.();
          event.stopImmediatePropagation?.();
          return;
        }
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        onCommand(Object.freeze({ commandId: target.dataset.menuCommand, event, element: target }));
      };
      root.addEventListener('click', clickListener, true);
      started = true;
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started && clickListener) root.removeEventListener('click', clickListener, true);
      started = false;
      clickListener = null;
      onCommand = null;
      for (const element of commandElements.values()) {
        delete element.dataset.menuCommand;
        delete element.dataset.menuLabelKey;
        delete element.dataset.menuShortcut;
        element.classList?.remove?.('disabled');
        element.removeAttribute?.('aria-disabled');
        element.hidden = false;
      }
      commandElements.clear();
    }
  });
}
