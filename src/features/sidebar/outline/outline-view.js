/**
 * Responsibility: Own Outline DOM projection and Outline-specific list/context-menu listeners.
 * Imports: None; controller actions, context-menu placement and collapse lookups are injected.
 * Exports: createOutlineView.
 * State/side effects: Owns rendered Outline DOM, active-row projection, current context-node ID and listeners on injected Outline elements.
 * Lifecycle: Explicit start/destroy; destroy removes every owned listener and rendered-row reference.
 */

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createOutlineView({
  documentRef,
  panel,
  list,
  contextMenu,
  contextSeparator,
  contextCollapseNodeButton,
  isCollapsed,
  onToggle,
  onNavigate,
  onExpandAll,
  onCollapseAll,
  onCollapseNode,
  openContextMenu,
  closeContextMenus
} = {}) {
  requireObject(documentRef, 'Outline document');
  requireFunction(documentRef.createElement?.bind(documentRef), 'Outline document.createElement');
  requireObject(panel, 'Outline panel');
  requireObject(list, 'Outline list');
  requireObject(contextMenu, 'Outline context menu');
  requireObject(contextSeparator, 'Outline context separator');
  requireObject(contextCollapseNodeButton, 'Outline context collapse-node button');
  requireFunction(panel.addEventListener, 'Outline panel.addEventListener');
  requireFunction(panel.removeEventListener, 'Outline panel.removeEventListener');
  requireFunction(list.addEventListener, 'Outline list.addEventListener');
  requireFunction(list.removeEventListener, 'Outline list.removeEventListener');
  requireFunction(contextMenu.addEventListener, 'Outline context menu.addEventListener');
  requireFunction(contextMenu.removeEventListener, 'Outline context menu.removeEventListener');
  for (const [callback, label] of [
    [isCollapsed, 'isCollapsed'],
    [onToggle, 'onToggle'],
    [onNavigate, 'onNavigate'],
    [onExpandAll, 'onExpandAll'],
    [onCollapseAll, 'onCollapseAll'],
    [onCollapseNode, 'onCollapseNode'],
    [openContextMenu, 'openContextMenu'],
    [closeContextMenus, 'closeContextMenus']
  ]) requireFunction(callback, `Outline view ${label}`);

  const rowByHeadingId = new Map();
  let activeHeadingId = '';
  let contextHeadingId = '';
  let started = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('OutlineView is destroyed.');
  };

  function createToggle(node, collapsed) {
    if (!node.children?.length) {
      const placeholder = documentRef.createElement('span');
      placeholder.className = 'outline-toggle outline-toggle-placeholder';
      return placeholder;
    }
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'outline-toggle';
    button.dataset.outlineAction = 'toggle';
    button.dataset.outlineId = node.id;
    button.setAttribute('aria-label', '折叠/展开');
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.textContent = collapsed ? '▸' : '▾';
    return button;
  }

  function createNode(node) {
    const collapsed = Boolean(node.children?.length && isCollapsed(node.id));
    const item = documentRef.createElement('li');
    item.className = `outline-node outline-level-${node.level}`;
    if (node.children?.length) item.classList.add('has-children');
    if (collapsed) item.classList.add('is-collapsed');
    item.dataset.outlineId = node.id;
    item.dataset.outlineLevel = String(node.level);

    const row = documentRef.createElement('div');
    row.className = 'outline-row';
    row.dataset.line = String(node.line);
    rowByHeadingId.set(node.id, row);
    if (activeHeadingId === node.id) row.classList.add('active');
    row.appendChild(createToggle(node, collapsed));

    const link = documentRef.createElement('button');
    link.type = 'button';
    link.className = 'outline-link';
    link.dataset.outlineAction = 'navigate';
    link.dataset.outlineId = node.id;
    link.dataset.line = String(node.line);
    link.title = `第 ${node.line} 行`;
    link.textContent = node.text;
    row.appendChild(link);
    item.appendChild(row);

    if (node.children?.length) {
      const children = documentRef.createElement('ul');
      children.className = 'outline-children';
      if (collapsed) children.classList.add('collapsed');
      for (const child of node.children) children.appendChild(createNode(child));
      item.appendChild(children);
    }
    return item;
  }

  function renderEmpty() {
    const empty = documentRef.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = '当前文档还没有标题。使用 # 至 ###### 创建标题后会自动生成可折叠大纲。';
    list.replaceChildren(empty);
  }

  function onListClick(event) {
    const action = event?.target?.closest?.('[data-outline-action]');
    if (!action || !list.contains(action)) return;
    const kind = action.dataset.outlineAction;
    if (kind === 'toggle') {
      event.preventDefault?.();
      event.stopPropagation?.();
      onToggle(action.dataset.outlineId || '');
      return;
    }
    if (kind === 'navigate') {
      const line = Math.max(1, Number(action.dataset.line) || 1);
      onNavigate(line, action.dataset.outlineId || '');
    }
  }

  function onPanelContextMenu(event) {
    const node = event?.target?.closest?.('.outline-node');
    contextHeadingId = node?.dataset?.outlineId || '';
    const hasChildren = Boolean(node?.classList?.contains('has-children'));
    contextSeparator.hidden = !hasChildren;
    contextCollapseNodeButton.hidden = !hasChildren;
    openContextMenu(event);
  }

  function onContextMenuClick(event) {
    const action = event?.target?.closest?.('[data-outline-context-action]');
    if (!action || !contextMenu.contains(action)) return;
    const kind = action.dataset.outlineContextAction;
    if (kind === 'expand-all') onExpandAll();
    else if (kind === 'collapse-all') onCollapseAll();
    else if (kind === 'collapse-node' && contextHeadingId) onCollapseNode(contextHeadingId);
    else return;
    closeContextMenus();
  }

  const view = Object.freeze({
    start() {
      assertActive();
      if (started) return view;
      list.addEventListener('click', onListClick);
      panel.addEventListener('contextmenu', onPanelContextMenu);
      contextMenu.addEventListener('click', onContextMenuClick);
      started = true;
      return view;
    },
    render(tree) {
      assertActive();
      rowByHeadingId.clear();
      const nodes = Array.isArray(tree) ? tree : [];
      if (!nodes.length) {
        activeHeadingId = '';
        renderEmpty();
        return Object.freeze({ headings: 0, rows: 0 });
      }
      const root = documentRef.createElement('ul');
      root.className = 'outline-tree';
      for (const node of nodes) root.appendChild(createNode(node));
      list.replaceChildren(root);
      return Object.freeze({ headings: rowByHeadingId.size, rows: rowByHeadingId.size });
    },
    setActiveHeading(id) {
      assertActive();
      const nextId = String(id || '');
      if (activeHeadingId === nextId) return false;
      if (activeHeadingId) rowByHeadingId.get(activeHeadingId)?.classList?.remove('active');
      activeHeadingId = nextId;
      if (activeHeadingId) rowByHeadingId.get(activeHeadingId)?.classList?.add('active');
      return true;
    },
    get snapshot() {
      assertActive();
      return Object.freeze({ activeHeadingId, contextHeadingId, rows: rowByHeadingId.size, started });
    },
    destroy() {
      if (destroyed) return;
      if (started) {
        list.removeEventListener('click', onListClick);
        panel.removeEventListener('contextmenu', onPanelContextMenu);
        contextMenu.removeEventListener('click', onContextMenuClick);
      }
      rowByHeadingId.clear();
      activeHeadingId = '';
      contextHeadingId = '';
      started = false;
      destroyed = true;
    }
  });
  return view;
}
