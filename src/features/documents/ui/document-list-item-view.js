/**
 * Responsibility: Render one document-session record and bind its open/close/context intents without owning document state.
 * Imports: Shared DOM event scope only.
 * Exports: createDocumentListItemView.
 * State/side effects: Owns one rendered item element and its DOM listeners only.
 * Lifecycle: Explicit View with idempotent destroy(); destroy removes listeners and detaches nothing outside its own element.
 */
import { createEventScope } from '../../../ui/dom/index.js';

export function createDocumentListItemView(documentRef, record, {
  active = false,
  defaultTitle = '未命名文档',
  closeTitle = '关闭文档',
  onOpen = () => {},
  onClose = () => {},
  onContextMenu = () => {}
} = {}) {
  if (!documentRef?.createElement) throw new TypeError('Document list item requires a document.');
  if (!record?.id) throw new TypeError('Document list item requires a record id.');
  const events = createEventScope();
  const item = documentRef.createElement('div');
  item.className = `document-item${active ? ' active' : ''}`;
  item.dataset.documentId = String(record.id);

  const summary = documentRef.createElement('div');
  summary.className = 'document-summary';
  const title = documentRef.createElement('div');
  title.className = 'document-title';
  title.textContent = String(record.title || defaultTitle);
  title.title = String(record.title || '');
  const meta = documentRef.createElement('div');
  meta.className = 'document-meta';
  meta.textContent = record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '';
  summary.append(title, meta);

  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'document-close';
  close.title = closeTitle;
  close.setAttribute('aria-label', `${closeTitle} ${record.title || defaultTitle}`);
  close.textContent = '×';
  item.append(summary, close);

  events.listen(item, 'click', event => {
    if (event.target?.closest?.('.document-close')) return;
    onOpen(String(record.id), event);
  });
  events.listen(item, 'contextmenu', event => onContextMenu(String(record.id), event));
  events.listen(close, 'click', event => {
    event.preventDefault?.();
    event.stopPropagation?.();
    onClose(String(record.id), event);
  });

  let destroyed = false;
  return Object.freeze({
    element: item,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.destroy();
    }
  });
}
