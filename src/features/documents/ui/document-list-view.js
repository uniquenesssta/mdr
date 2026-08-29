/**
 * Responsibility: Render the read-only document-session list and translate item gestures into injected document commands.
 * Imports: DocumentListItemView only; no application/storage/model internals.
 * Exports: createDocumentListView.
 * State/side effects: Owns rendered item Views and one session subscription; never owns session records.
 * Lifecycle: Explicit View with idempotent destroy(); destroys item listeners and unsubscribes session changes.
 */
import { createDocumentListItemView } from './document-list-item-view.js';

export function createDocumentListView({
  root,
  session,
  commands,
  contextMenu = null,
  defaultTitle = '未命名文档',
  emptyText = '暂无文档'
} = {}) {
  if (!root?.ownerDocument || typeof root.replaceChildren !== 'function') throw new TypeError('Document List View requires a root element.');
  if (!session || !Array.isArray(session.records) || typeof session.subscribe !== 'function') throw new TypeError('Document List View requires a read-only session contract.');
  if (!commands || typeof commands.open !== 'function' || typeof commands.close !== 'function') throw new TypeError('Document List View requires open/close commands.');
  let itemViews = [];
  let destroyed = false;

  const clearItems = () => {
    const errors = [];
    for (const view of itemViews.reverse()) {
      try { view.destroy(); } catch (error) { errors.push(error); }
    }
    itemViews = [];
    if (errors.length) throw new AggregateError(errors, 'Document item View cleanup failed.');
  };

  const render = snapshot => {
    if (destroyed) return;
    clearItems();
    const records = Array.isArray(snapshot?.records) ? snapshot.records : session.records;
    const activeId = snapshot?.activeId ?? session.activeId;
    if (!records.length) {
      const empty = root.ownerDocument.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = emptyText;
      root.replaceChildren(empty);
      return;
    }
    itemViews = records.map(record => createDocumentListItemView(root.ownerDocument, record, {
      active: record.id === activeId,
      defaultTitle,
      onOpen: id => commands.open(id),
      onClose: id => commands.close(id),
      onContextMenu: (id, event) => contextMenu?.openDocument?.(id, event)
    }));
    root.replaceChildren(...itemViews.map(view => view.element));
  };

  const unsubscribe = session.subscribe(event => render(event?.snapshot));
  render(session.snapshot || { records: session.records, activeId: session.activeId });

  return Object.freeze({
    refresh() { render(session.snapshot || { records: session.records, activeId: session.activeId }); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      clearItems();
    }
  });
}
