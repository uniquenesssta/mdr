function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createWorkspaceShell requires a document.');
  }
}

function assertSidebar(sidebar) {
  if (!sidebar || sidebar.id !== 'sidebar') {
    throw new TypeError('createWorkspaceShell requires the sidebar shell.');
  }
}

function createSeparator(documentRef, { className, id, label, title = label }) {
  const separator = documentRef.createElement('div');
  separator.className = className;
  separator.id = id;
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-orientation', 'vertical');
  separator.setAttribute('aria-label', label);
  separator.title = title;
  return separator;
}

export function createWorkspaceShell(documentRef, sidebar) {
  assertDocument(documentRef);
  assertSidebar(sidebar);

  const workspace = documentRef.createElement('div');
  workspace.className = 'workspace';
  workspace.setAttribute('data-ui-region', 'workspace');

  const sidebarResizer = createSeparator(documentRef, {
    className: 'sidebar-resizer',
    id: 'sidebar-resizer',
    label: '调整侧边栏宽度',
    title: '拖动调整侧边栏宽度'
  });
  const main = documentRef.createElement('div');
  main.className = 'main';
  main.setAttribute('data-ui-region', 'workspace-main');

  const editor = documentRef.createElement('div');
  editor.className = 'pane editor-pane';
  editor.setAttribute('role', 'region');
  editor.setAttribute('aria-label', '编辑区');
  editor.setAttribute('data-ui-slot', 'editor');

  const paneResizer = createSeparator(documentRef, {
    className: 'resizer',
    id: 'resizer',
    label: '调整编辑与预览区域宽度'
  });

  const preview = documentRef.createElement('div');
  preview.className = 'pane preview-pane';
  preview.setAttribute('role', 'region');
  preview.setAttribute('aria-label', '预览区');
  preview.setAttribute('data-ui-slot', 'preview');

  main.append(editor, paneResizer, preview);
  workspace.append(sidebar, sidebarResizer, main);
  return Object.freeze({ element: workspace, editor, preview });
}
