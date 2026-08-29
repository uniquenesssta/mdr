/**
 * Responsibility: Own document/sidebar context-menu presentation state and send selected actions through an injected command boundary.
 * Imports: Shared DOM event scope only.
 * Exports: createDocumentContextMenuView.
 * State/side effects: Owns current context document id, menu visibility/position and listeners; no document state.
 * Lifecycle: Explicit View with idempotent destroy(); closes menus and removes all listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';

function positionMenu(menu, event) {
  if (!menu || !event) return;
  event.preventDefault?.();
  event.stopPropagation?.();
  menu.style.display = 'block';
  menu.classList.add('show');
  const viewport = menu.ownerDocument?.defaultView;
  const width = menu.offsetWidth || 180;
  const height = menu.offsetHeight || 220;
  const maxX = Math.max(8, Number(viewport?.innerWidth || 0) - width - 8);
  const maxY = Math.max(8, Number(viewport?.innerHeight || 0) - height - 8);
  menu.style.left = `${Math.max(8, Math.min(Number(event.clientX) || 0, maxX))}px`;
  menu.style.top = `${Math.max(8, Math.min(Number(event.clientY) || 0, maxY))}px`;
}

export function createDocumentContextMenuView({ documentMenu, sidebarMenu, docsPanel, commands } = {}) {
  if (!documentMenu?.ownerDocument || !sidebarMenu?.ownerDocument || !docsPanel?.ownerDocument) {
    throw new TypeError('Document Context Menu View requires document/sidebar menus and docs panel.');
  }
  if (!commands || typeof commands.invoke !== 'function') throw new TypeError('Document Context Menu View requires a command boundary.');
  const events = createEventScope();
  const documentRef = documentMenu.ownerDocument;
  let contextDocumentId = null;
  let destroyed = false;

  const close = () => {
    for (const menu of [documentMenu, sidebarMenu]) {
      menu.classList.remove('show');
      menu.style.display = 'none';
    }
  };
  const openDocument = (documentId, event) => {
    contextDocumentId = String(documentId || '');
    close();
    positionMenu(documentMenu, event);
  };
  const openSidebar = event => {
    if (event?.target?.closest?.('.document-item')) return;
    contextDocumentId = null;
    close();
    positionMenu(sidebarMenu, event);
  };

  events.listen(documentMenu, 'click', event => {
    const action = event.target?.closest?.('[data-document-action]')?.dataset?.documentAction;
    if (!action) return;
    event.preventDefault?.();
    close();
    commands.invoke(action, contextDocumentId);
  });
  events.listen(sidebarMenu, 'click', event => {
    const action = event.target?.closest?.('[data-sidebar-action]')?.dataset?.sidebarAction;
    if (!action) return;
    event.preventDefault?.();
    close();
    commands.invoke(action);
  });
  events.listen(docsPanel, 'contextmenu', openSidebar);
  events.listen(documentRef, 'mousedown', event => {
    if (event.target?.closest?.('.context-menu')) return;
    close();
  });
  events.listen(documentRef, 'keydown', event => { if (event.key === 'Escape') close(); });

  return Object.freeze({
    openDocument,
    openSidebar,
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      events.destroy();
      contextDocumentId = null;
    }
  });
}
