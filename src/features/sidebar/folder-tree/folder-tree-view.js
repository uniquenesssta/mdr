/**
 * Responsibility: Own Folder Tree panel/header/list projection plus refresh and keyboard listeners.
 * Imports: Node View and pure path comparison.
 * Exports: createFolderTreeView.
 * State/side effects: DOM projection only; no platform I/O or business state authority.
 * Lifecycle: Explicit start/destroy with deterministic listener and child-view cleanup.
 */
import { createFolderTreeNodeView } from './folder-tree-node-view.js';
import { getNativeParentPath, isSameNativePath } from './folder-tree-path-policy.js';

function requireElement(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}

export function createFolderTreeView({
  documentRef,
  panel,
  list,
  rootLabel,
  summary,
  refreshButton,
  available = false
} = {}) {
  if (!documentRef?.createElement) throw new TypeError('FolderTreeView requires documentRef.');
  requireElement(panel, 'Folder Tree panel');
  requireElement(list, 'Folder Tree list');
  requireElement(rootLabel, 'Folder Tree root label');
  requireElement(summary, 'Folder Tree summary');
  requireElement(refreshButton, 'Folder Tree refresh button');

  const desktopAvailable = Boolean(available);
  const nodeViews = [];
  let actions = null;
  let started = false;
  let destroyed = false;
  let latestSnapshot = null;

  const assertActive = () => {
    if (destroyed) throw new Error('FolderTreeView is destroyed.');
  };
  const destroyNodes = () => {
    for (const nodeView of nodeViews.splice(0).reverse()) nodeView.destroy();
  };
  const renderMessage = (message, className = 'sidebar-empty') => {
    destroyNodes();
    list.replaceChildren();
    const empty = documentRef.createElement('div');
    empty.className = className;
    empty.textContent = message;
    list.appendChild(empty);
  };
  const updateHeader = snapshot => {
    latestSnapshot = snapshot;
    const tree = snapshot?.tree || null;
    const documentPath = String(snapshot?.currentDocumentPath || '');
    const label = tree?.rootName || (documentPath ? getNativeParentPath(documentPath) : '未关联文件夹');
    rootLabel.textContent = label || '未关联文件夹';
    rootLabel.title = tree?.rootPath || getNativeParentPath(documentPath) || '';
    if (snapshot?.loading) summary.textContent = '正在读取…';
    else if (!tree) summary.textContent = '';
    else {
      const parts = [`${tree.fileCount} 个文件`];
      if (tree.truncated) parts.push('结果已截断');
      else if (tree.skippedCount) parts.push(`${tree.skippedCount} 项不可读取`);
      summary.textContent = parts.join(' · ');
    }
    refreshButton.disabled = Boolean(snapshot?.loading) || !documentPath || !desktopAvailable;
  };
  const render = snapshot => {
    assertActive();
    latestSnapshot = snapshot;
    updateHeader(snapshot);
    if (snapshot?.loading) {
      renderMessage('正在读取同目录文件…', 'sidebar-empty folder-tree-loading');
      return;
    }
    if (snapshot?.errorMessage) {
      renderMessage(snapshot.errorMessage);
      return;
    }
    const tree = snapshot?.tree || null;
    if (!tree) {
      if (!desktopAvailable) renderMessage('文件树仅在桌面版中可用');
      else if (!snapshot?.currentDocumentPath) renderMessage('打开或保存本地 Markdown/TXT 文件后显示同目录文件树');
      else renderMessage('当前文件夹中没有可读取的 Markdown 或 TXT 文件');
      return;
    }
    destroyNodes();
    list.replaceChildren();
    if (!tree.nodes.length) {
      renderMessage('当前文件夹中没有可读取的 Markdown 或 TXT 文件');
      return;
    }
    const root = documentRef.createElement('ul');
    root.className = 'folder-tree-root';
    for (const node of tree.nodes) {
      const nodeView = createFolderTreeNodeView({
        documentRef,
        node,
        depth: 0,
        currentDocumentPath: snapshot.currentDocumentPath,
        isDirectoryExpanded: (path, depth) => actions.isDirectoryExpanded(path, depth),
        onToggleDirectory: (path, expanded) => actions.toggleDirectory(path, expanded),
        onOpenFile: path => actions.openFile(path)
      });
      nodeViews.push(nodeView);
      root.appendChild(nodeView.element);
    }
    list.appendChild(root);
  };
  const updateActive = currentDocumentPath => {
    assertActive();
    list.querySelectorAll('.folder-tree-file-row[data-path]').forEach(row => {
      const selected = isSameNativePath(row.dataset.path, currentDocumentPath);
      row.classList.toggle('active', selected);
      row.setAttribute('aria-current', selected ? 'page' : 'false');
    });
    if (latestSnapshot) updateHeader({ ...latestSnapshot, currentDocumentPath });
  };
  const onRefresh = () => { void actions?.refresh(true); };
  const onKeyDown = event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const row = event.target.closest?.('.folder-tree-directory-row');
    if (!row) return;
    const shouldExpand = event.key === 'ArrowRight';
    if ((row.getAttribute('aria-expanded') === 'true') !== shouldExpand) row.click();
    event.preventDefault();
  };

  return Object.freeze({
    start(nextActions) {
      assertActive();
      if (started) return;
      for (const name of ['refresh', 'isDirectoryExpanded', 'toggleDirectory', 'openFile']) {
        if (typeof nextActions?.[name] !== 'function') throw new TypeError(`FolderTreeView action ${name} is required.`);
      }
      actions = nextActions;
      refreshButton.addEventListener('click', onRefresh);
      panel.addEventListener('keydown', onKeyDown);
      started = true;
    },
    render,
    updateHeader(snapshot) {
      assertActive();
      updateHeader(snapshot);
    },
    updateActive,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started) {
        refreshButton.removeEventListener('click', onRefresh);
        panel.removeEventListener('keydown', onKeyDown);
      }
      destroyNodes();
      actions = null;
      latestSnapshot = null;
      started = false;
    }
  });
}
