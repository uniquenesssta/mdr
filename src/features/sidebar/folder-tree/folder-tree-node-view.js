/**
 * Responsibility: Render one Folder Tree node and own only that node's interaction listeners.
 * Imports: Icon view and pure path comparison.
 * Exports: createFolderTreeNodeView.
 * State/side effects: Owns node-local DOM/listeners; expansion authority stays in FolderTreeState.
 * Lifecycle: Explicit idempotent destroy recursively tears down child node views.
 */
import { createIconView, getIconHref } from '../../../ui/components/icon-view.js';
import { isSameNativePath } from './folder-tree-path-policy.js';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createFolderTreeNodeView({
  documentRef,
  node,
  depth = 0,
  currentDocumentPath = '',
  isDirectoryExpanded,
  onToggleDirectory,
  onOpenFile
} = {}) {
  if (!documentRef?.createElement) throw new TypeError('Folder Tree node view requires documentRef.');
  if (!node || typeof node !== 'object') throw new TypeError('Folder Tree node view requires a node.');
  requireFunction(isDirectoryExpanded, 'isDirectoryExpanded');
  requireFunction(onToggleDirectory, 'onToggleDirectory');
  requireFunction(onOpenFile, 'onOpenFile');

  const childViews = [];
  const disposers = [];
  let destroyed = false;
  const item = documentRef.createElement('li');
  item.className = `folder-tree-node ${node.kind === 'directory' ? 'folder-tree-directory' : 'folder-tree-file'}`;

  if (node.kind === 'directory') {
    const expanded = isDirectoryExpanded(node.path, depth);
    const row = documentRef.createElement('button');
    row.type = 'button';
    row.className = 'folder-tree-row folder-tree-directory-row';
    row.style.setProperty('--tree-depth', String(depth));
    row.setAttribute('aria-expanded', String(expanded));
    row.title = node.path;

    const chevron = createIconView(documentRef, expanded ? 'icon-chevron-down' : 'icon-chevron-right', { className: 'icon folder-tree-chevron' });
    const folder = createIconView(documentRef, 'icon-folder', { className: 'icon icon-sm folder-tree-kind-icon' });
    const label = documentRef.createElement('span');
    label.className = 'folder-tree-name';
    label.textContent = node.name;
    row.append(chevron, folder, label);

    const children = documentRef.createElement('ul');
    children.className = 'folder-tree-children';
    children.hidden = !expanded;
    for (const child of node.children || []) {
      const childView = createFolderTreeNodeView({
        documentRef,
        node: child,
        depth: depth + 1,
        currentDocumentPath,
        isDirectoryExpanded,
        onToggleDirectory,
        onOpenFile
      });
      childViews.push(childView);
      children.appendChild(childView.element);
    }

    const onClick = () => {
      if (destroyed) return;
      const nextExpanded = row.getAttribute('aria-expanded') !== 'true';
      row.setAttribute('aria-expanded', String(nextExpanded));
      children.hidden = !nextExpanded;
      chevron.querySelector('use')?.setAttribute('href', getIconHref(nextExpanded ? 'icon-chevron-down' : 'icon-chevron-right'));
      onToggleDirectory(node.path, nextExpanded);
    };
    row.addEventListener('click', onClick);
    disposers.push(() => row.removeEventListener('click', onClick));
    item.append(row, children);
  } else {
    const row = documentRef.createElement('button');
    row.type = 'button';
    row.className = 'folder-tree-row folder-tree-file-row';
    row.style.setProperty('--tree-depth', String(depth));
    row.title = node.path;
    row.dataset.path = node.path;
    const selected = isSameNativePath(node.path, currentDocumentPath);
    row.classList.toggle('active', selected);
    row.setAttribute('aria-current', selected ? 'page' : 'false');

    const spacer = documentRef.createElement('span');
    spacer.className = 'folder-tree-chevron-spacer';
    const fileIcon = createIconView(documentRef, 'icon-menu-file', { className: 'icon icon-sm folder-tree-kind-icon' });
    const label = documentRef.createElement('span');
    label.className = 'folder-tree-name';
    label.textContent = node.name;
    row.append(spacer, fileIcon, label);

    const onClick = async () => {
      if (destroyed || isSameNativePath(node.path, currentDocumentPath)) return;
      row.disabled = true;
      try {
        await onOpenFile(node.path);
      } finally {
        row.disabled = false;
      }
    };
    row.addEventListener('click', onClick);
    disposers.push(() => row.removeEventListener('click', onClick));
    item.appendChild(row);
  }

  return Object.freeze({
    element: item,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const dispose of disposers.splice(0).reverse()) dispose();
      for (const child of childViews.splice(0).reverse()) child.destroy();
    }
  });
}
