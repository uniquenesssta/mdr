function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createToolbarShell requires a document.');
  }
}

export function createToolbarShell(documentRef) {
  assertDocument(documentRef);
  const toolbar = documentRef.createElement('div');
  toolbar.className = 'editor-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '编辑工具栏');
  toolbar.setAttribute('data-ui-slot', 'toolbar');
  return toolbar;
}
