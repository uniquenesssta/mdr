function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createSidebarShell requires a document.');
  }
}

export function createSidebarShell(documentRef) {
  assertDocument(documentRef);
  const sidebar = documentRef.createElement('aside');
  sidebar.id = 'sidebar';
  sidebar.className = 'sidebar';
  sidebar.setAttribute('aria-label', '工作区导航');
  sidebar.setAttribute('data-ui-slot', 'sidebar');
  return sidebar;
}
