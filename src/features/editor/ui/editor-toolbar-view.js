/**
 * Responsibility: Bind editor command controls, own only toolbar dropdown visibility, and dispatch editing/layout intents to injected boundaries.
 * Imports: Shared DOM event scope only.
 * Exports: createEditorToolbarView.
 * State/side effects: Owns toolbar listeners plus heading/view menu visibility; no editor/document state.
 * Lifecycle: Explicit View with idempotent destroy(); closes owned menus and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';

export function createEditorToolbarView({
  root,
  commandRoots = [],
  commands,
  dialogs = {},
  tableView = null,
  getLayoutMode = () => 'both',
  formatLayoutLabel = mode => String(mode || '')
} = {}) {
  if (!root?.ownerDocument) throw new TypeError('Editor Toolbar View requires a toolbar root.');
  if (!commands || typeof commands.execute !== 'function') throw new TypeError('Editor Toolbar View requires an execute command boundary.');
  const events = createEventScope();
  const headingMenu = root.querySelector('#heading-menu');
  const viewMenu = root.querySelector('#view-menu');
  const roots = [root, ...commandRoots.filter(value => value && value !== root)];
  let destroyed = false;

  const closeMenus = () => {
    headingMenu?.classList.remove('show');
    viewMenu?.classList.remove('show');
  };
  const refreshLayoutLabel = mode => {
    const value = mode || getLayoutMode() || 'both';
    const label = root.querySelector('#view-dropdown > button [data-i18n="view"]');
    if (label) label.textContent = formatLayoutLabel(value) || formatLayoutLabel('both');
  };
  const execute = (action, payload) => commands.execute(action, payload);
  const route = (action, trigger) => {
    if (action === 'toggle-heading-menu') {
      const willOpen = !headingMenu?.classList.contains('show');
      closeMenus();
      if (willOpen) headingMenu?.classList.add('show');
      return;
    }
    if (action === 'heading') {
      execute('heading', Number(trigger.dataset.level) || 1);
      closeMenus();
      return;
    }
    if (action === 'toggle-view-menu') {
      const willOpen = !viewMenu?.classList.contains('show');
      closeMenus();
      if (willOpen) viewMenu?.classList.add('show');
      return;
    }
    if (action === 'layout') {
      const mode = trigger.dataset.mode || trigger.value;
      execute('layout', mode);
      refreshLayoutLabel(mode);
      closeMenus();
      return;
    }
    if (action === 'page-fullscreen' || action === 'system-fullscreen') { execute(action); closeMenus(); return; }
    if (action === 'open-link') return dialogs.link?.open?.();
    if (action === 'open-image') return dialogs.image?.open?.();
    if (action === 'open-find') return dialogs.find?.open?.(false);
    if (action === 'open-replace') return dialogs.find?.open?.(true);
    if (action === 'open-mermaid') return dialogs.mermaid?.open?.();
    if (action === 'toggle-table') return tableView?.toggle?.();
    if (action === 'insert-table') return tableView?.insert?.(Number(trigger.dataset.rows) || 3, Number(trigger.dataset.cols) || 3);
    if (action === 'inline-math') return dialogs.math?.insertInline?.();
    if (action === 'block-math') return dialogs.math?.insertBlock?.();
    execute(action);
  };

  for (const commandRoot of roots) {
    events.listen(commandRoot, 'click', event => {
      const trigger = event.target?.closest?.('[data-editor-action]');
      if (!trigger || trigger.disabled || !commandRoot.contains(trigger)) return;
      const action = trigger.dataset.editorAction;
      if (!action) return;
      event.preventDefault?.();
      route(action, trigger);
      if (commandRoot !== root) execute('close-app-menus');
    });
    events.listen(commandRoot, 'change', event => {
      const trigger = event.target?.closest?.('[data-editor-change-action]');
      if (!trigger || !commandRoot.contains(trigger)) return;
      if (trigger.dataset.editorChangeAction === 'layout') route('layout', trigger);
    });
  }
  events.listen(root.ownerDocument, 'mousedown', event => {
    if (event.target?.closest?.('#heading-dropdown, #view-dropdown')) return;
    closeMenus();
  });

  refreshLayoutLabel();
  return Object.freeze({
    closeMenus,
    refreshLayoutLabel,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeMenus();
      events.destroy();
    }
  });
}
