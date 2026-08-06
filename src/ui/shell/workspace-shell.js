import { createSafeElement, requireElementRef } from '../dom/index.js';

function createSeparator(documentRef, { className, id, label, title = label }) {
  const separator = createSafeElement(documentRef, 'div', {
    id,
    className,
    attributes: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': label
    }
  });
  separator.title = title;
  return separator;
}

export function createWorkspaceShell(documentRef, sidebar) {
  requireElementRef(sidebar, 'workspace sidebar shell');
  if (sidebar.id !== 'sidebar') throw new TypeError('createWorkspaceShell requires the sidebar shell.');

  const workspace = createSafeElement(documentRef, 'div', {
    className: 'l-workspace workspace',
    attributes: { 'data-ui-region': 'workspace' }
  });
  const sidebarResizer = createSeparator(documentRef, {
    className: 'l-sidebar-resizer sidebar-resizer',
    id: 'sidebar-resizer',
    label: '调整侧边栏宽度',
    title: '拖动调整侧边栏宽度'
  });
  const main = createSafeElement(documentRef, 'div', {
    className: 'l-split-pane main',
    attributes: { 'data-ui-region': 'workspace-main' }
  });
  const editor = createSafeElement(documentRef, 'div', {
    className: 'l-pane f-editor-pane pane editor-pane',
    attributes: {
      role: 'region',
      'aria-label': '编辑区',
      'data-ui-slot': 'editor'
    }
  });
  const paneResizer = createSeparator(documentRef, {
    className: 'l-pane-resizer resizer',
    id: 'resizer',
    label: '调整编辑与预览区域宽度'
  });
  const preview = createSafeElement(documentRef, 'div', {
    className: 'l-pane f-preview-pane pane preview-pane',
    attributes: {
      role: 'region',
      'aria-label': '预览区',
      'data-ui-slot': 'preview'
    }
  });

  main.append(editor, paneResizer, preview);
  workspace.append(sidebar, sidebarResizer, main);
  return Object.freeze({ element: workspace, editor, preview });
}
