const SUPPORTED_FILE_EXTENSIONS = new Set(['md', 'markdown', 'txt']);

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function isWindowsLikePath(value) {
  const path = String(value || '');
  return /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path);
}

function comparableNativePath(value) {
  const normalized = normalizePath(value);
  if (!normalized) return '';
  return isWindowsLikePath(value) ? normalized.toLocaleLowerCase() : normalized;
}

export function isSameNativePath(left, right) {
  const normalizedLeft = comparableNativePath(left);
  const normalizedRight = comparableNativePath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isNativePathWithinDirectory(filePath, directoryPath) {
  const file = comparableNativePath(filePath);
  const directory = comparableNativePath(directoryPath);
  if (!file || !directory) return false;
  return file === directory || file.startsWith(`${directory}/`);
}

export function getNativeParentPath(value) {
  const path = String(value || '').trim().replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (separatorIndex < 0) return '';
  if (separatorIndex === 2 && /^[a-z]:/i.test(path)) return path.slice(0, 3);
  if (separatorIndex === 0) return path.slice(0, 1);
  return path.slice(0, separatorIndex);
}

function getExtension(name) {
  const match = String(name || '').toLocaleLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

function createIcon(symbolId, className = 'icon icon-sm') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.appendChild(use);
  return svg;
}

function sortTreeNodes(nodes) {
  return Array.from(nodes || []).sort((left, right) => {
    const leftDirectory = left?.kind === 'directory';
    const rightDirectory = right?.kind === 'directory';
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
    return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

function normalizeTreeNode(node) {
  const kind = node?.kind === 'directory' ? 'directory' : 'file';
  const name = String(node?.name || '').trim();
  const path = String(node?.path || '').trim();
  if (!name || !path) return null;
  if (kind === 'file' && !SUPPORTED_FILE_EXTENSIONS.has(getExtension(name))) return null;
  const normalized = { kind, name, path };
  if (kind === 'directory') {
    normalized.children = sortTreeNodes(node?.children).map(normalizeTreeNode).filter(Boolean);
  }
  return normalized;
}

export function normalizeFolderFileTreeResult(result) {
  const rootPath = String(result?.rootPath || '').trim();
  const rootName = String(result?.rootName || '').trim() || rootPath;
  return {
    rootPath,
    rootName,
    nodes: sortTreeNodes(result?.nodes).map(normalizeTreeNode).filter(Boolean),
    fileCount: Math.max(0, Number(result?.fileCount) || 0),
    directoryCount: Math.max(0, Number(result?.directoryCount) || 0),
    skippedCount: Math.max(0, Number(result?.skippedCount) || 0),
    truncated: Boolean(result?.truncated)
  };
}

export function createFolderFileTreeController(options = {}) {
  const panel = options.panel || document.getElementById('sidebar-files-panel');
  const list = options.list || document.getElementById('folder-file-tree');
  const rootLabel = options.rootLabel || document.getElementById('folder-file-tree-root');
  const summary = options.summary || document.getElementById('folder-file-tree-summary');
  const refreshButton = options.refreshButton || document.getElementById('folder-file-tree-refresh');
  const nativeApi = options.nativeApi || window.markdownEditorNative;
  const getCurrentContext = typeof options.getCurrentContext === 'function'
    ? options.getCurrentContext
    : () => window.markdownEditorRuntimeContext?.getCurrentDocumentContext?.() || {};
  const openFile = typeof options.openFile === 'function'
    ? options.openFile
    : path => window.openFolderTreeFile?.(path);

  let active = false;
  let loadingSequence = 0;
  let currentDocumentPath = '';
  let currentDirectoryPath = '';
  let currentTree = null;
  let loading = false;
  const expandedDirectories = new Set();

  function renderMessage(message, className = 'sidebar-empty') {
    if (!list) return;
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = className;
    empty.textContent = message;
    list.appendChild(empty);
  }

  function updateHeader(tree = currentTree) {
    if (rootLabel) {
      const label = tree?.rootName || (currentDocumentPath ? getNativeParentPath(currentDocumentPath) : '未关联文件夹');
      rootLabel.textContent = label || '未关联文件夹';
      rootLabel.title = tree?.rootPath || getNativeParentPath(currentDocumentPath) || '';
    }
    if (summary) {
      if (loading) {
        summary.textContent = '正在读取…';
      } else if (!tree) {
        summary.textContent = '';
      } else {
        const parts = [`${tree.fileCount} 个文件`];
        if (tree.truncated) parts.push('结果已截断');
        else if (tree.skippedCount) parts.push(`${tree.skippedCount} 项不可读取`);
        summary.textContent = parts.join(' · ');
      }
    }
    if (refreshButton) refreshButton.disabled = loading || !currentDocumentPath || !nativeApi?.isAvailable;
  }

  function setDirectoryExpanded(path, expanded) {
    const normalized = normalizePath(path);
    if (!normalized) return;
    if (expanded) expandedDirectories.add(normalized);
    else expandedDirectories.delete(normalized);
  }

  function isDirectoryExpanded(path, depth) {
    const normalized = normalizePath(path);
    if (expandedDirectories.has(normalized)) return true;
    return depth === 0;
  }

  function renderNode(node, depth) {
    if (node.kind === 'directory') {
      const item = document.createElement('li');
      item.className = 'folder-tree-node folder-tree-directory';
      const expanded = isDirectoryExpanded(node.path, depth);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'folder-tree-row folder-tree-directory-row';
      row.style.setProperty('--tree-depth', String(depth));
      row.setAttribute('aria-expanded', String(expanded));
      row.title = node.path;

      const chevron = createIcon(expanded ? 'icon-chevron-down' : 'icon-chevron-right', 'icon folder-tree-chevron');
      const folder = createIcon('icon-folder', 'icon icon-sm folder-tree-kind-icon');
      const label = document.createElement('span');
      label.className = 'folder-tree-name';
      label.textContent = node.name;
      row.append(chevron, folder, label);

      const children = document.createElement('ul');
      children.className = 'folder-tree-children';
      children.hidden = !expanded;
      for (const child of node.children || []) children.appendChild(renderNode(child, depth + 1));

      row.addEventListener('click', () => {
        const nextExpanded = row.getAttribute('aria-expanded') !== 'true';
        row.setAttribute('aria-expanded', String(nextExpanded));
        children.hidden = !nextExpanded;
        chevron.querySelector('use')?.setAttribute('href', nextExpanded ? '#icon-chevron-down' : '#icon-chevron-right');
        setDirectoryExpanded(node.path, nextExpanded);
      });
      item.append(row, children);
      return item;
    }

    const item = document.createElement('li');
    item.className = 'folder-tree-node folder-tree-file';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'folder-tree-row folder-tree-file-row';
    row.style.setProperty('--tree-depth', String(depth));
    row.title = node.path;
    row.dataset.path = node.path;
    row.classList.toggle('active', isSameNativePath(node.path, currentDocumentPath));
    row.setAttribute('aria-current', isSameNativePath(node.path, currentDocumentPath) ? 'page' : 'false');

    const spacer = document.createElement('span');
    spacer.className = 'folder-tree-chevron-spacer';
    const fileIcon = createIcon('icon-menu-file', 'icon icon-sm folder-tree-kind-icon');
    const label = document.createElement('span');
    label.className = 'folder-tree-name';
    label.textContent = node.name;
    row.append(spacer, fileIcon, label);

    row.addEventListener('click', async () => {
      if (isSameNativePath(node.path, currentDocumentPath)) return;
      row.disabled = true;
      try {
        const opened = await openFile(node.path);
        if (opened !== false) {
          currentDocumentPath = node.path;
          updateActiveFileRows();
        }
      } finally {
        row.disabled = false;
      }
    });
    item.appendChild(row);
    return item;
  }

  function updateActiveFileRows() {
    list?.querySelectorAll('.folder-tree-file-row[data-path]').forEach(row => {
      const selected = isSameNativePath(row.dataset.path, currentDocumentPath);
      row.classList.toggle('active', selected);
      row.setAttribute('aria-current', selected ? 'page' : 'false');
    });
  }

  function renderTree() {
    updateHeader();
    if (!list) return;
    if (!currentTree) {
      if (!nativeApi?.isAvailable) renderMessage('文件树仅在桌面版中可用');
      else if (!currentDocumentPath) renderMessage('打开或保存本地 Markdown/TXT 文件后显示同目录文件树');
      else renderMessage('当前文件夹中没有可读取的 Markdown 或 TXT 文件');
      return;
    }
    list.replaceChildren();
    if (!currentTree.nodes.length) {
      renderMessage('当前文件夹中没有可读取的 Markdown 或 TXT 文件');
      return;
    }
    const tree = document.createElement('ul');
    tree.className = 'folder-tree-root';
    for (const node of currentTree.nodes) tree.appendChild(renderNode(node, 0));
    list.appendChild(tree);
  }

  async function refresh(force = false) {
    const context = getCurrentContext() || {};
    const documentPath = String(context.filePath || '').trim();
    currentDocumentPath = documentPath;
    const directoryPath = getNativeParentPath(documentPath);
    if (!nativeApi?.isAvailable || typeof nativeApi.listTextFileTree !== 'function') {
      currentTree = null;
      currentDirectoryPath = '';
      renderTree();
      return null;
    }
    if (!documentPath || !directoryPath) {
      currentTree = null;
      currentDirectoryPath = '';
      renderTree();
      return null;
    }
    if (!force && currentTree && isNativePathWithinDirectory(documentPath, currentDirectoryPath)) {
      updateActiveFileRows();
      updateHeader();
      return currentTree;
    }

    const sequence = ++loadingSequence;
    loading = true;
    updateHeader();
    renderMessage('正在读取同目录文件…', 'sidebar-empty folder-tree-loading');
    const startedAt = performance.now();
    try {
      const result = await nativeApi.listTextFileTree(documentPath);
      if (sequence !== loadingSequence) return null;
      currentTree = normalizeFolderFileTreeResult(result);
      currentDirectoryPath = currentTree.rootPath || directoryPath;
      window.markdownEditorPerf?.record?.('sidebar.file-tree-loaded', {
        category: 'sidebar.file-tree',
        durationMs: performance.now() - startedAt,
        status: currentTree.truncated ? 'partial' : 'ok',
        details: {
          rootPath: currentDirectoryPath,
          files: currentTree.fileCount,
          directories: currentTree.directoryCount,
          skipped: currentTree.skippedCount,
          truncated: currentTree.truncated
        }
      });
      renderTree();
      return currentTree;
    } catch (error) {
      if (sequence !== loadingSequence) return null;
      currentTree = null;
      currentDirectoryPath = directoryPath;
      renderMessage(error?.message || '无法读取当前文件夹');
      window.markdownEditorPerf?.record?.('sidebar.file-tree-load-error', {
        category: 'sidebar.file-tree',
        durationMs: performance.now() - startedAt,
        status: 'error',
        details: { rootPath: directoryPath, error: error?.message || String(error) }
      });
      return null;
    } finally {
      if (sequence === loadingSequence) {
        loading = false;
        updateHeader();
      }
    }
  }

  function syncCurrentDocument(context = getCurrentContext()) {
    const nextPath = String(context?.filePath || '').trim();
    const nextDirectory = getNativeParentPath(nextPath);
    const insideCurrentRoot = isNativePathWithinDirectory(nextPath, currentDirectoryPath);
    const directoryChanged = Boolean(nextDirectory) && !insideCurrentRoot;
    currentDocumentPath = nextPath;
    if (!active) {
      updateHeader();
      return;
    }
    if (!nextPath || directoryChanged || !currentTree) refresh(directoryChanged);
    else updateActiveFileRows();
  }

  function activate() {
    active = true;
    return refresh(false);
  }

  function deactivate() {
    active = false;
  }

  refreshButton?.addEventListener('click', () => refresh(true));
  panel?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const row = event.target.closest?.('.folder-tree-directory-row');
    if (!row) return;
    const shouldExpand = event.key === 'ArrowRight';
    if ((row.getAttribute('aria-expanded') === 'true') !== shouldExpand) row.click();
    event.preventDefault();
  });
  renderTree();

  return {
    activate,
    deactivate,
    refresh,
    syncCurrentDocument,
    getState() {
      return {
        active,
        loading,
        currentDocumentPath,
        currentDirectoryPath,
        fileCount: currentTree?.fileCount || 0,
        truncated: Boolean(currentTree?.truncated)
      };
    }
  };
}
