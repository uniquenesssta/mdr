function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createMenuBarShell requires a document.');
  }
}

export function createMenuBarShell(documentRef) {
  assertDocument(documentRef);
  const menu = documentRef.createElement('nav');
  menu.className = 'menu-bar';
  menu.setAttribute('aria-label', '应用菜单');
  menu.setAttribute('data-ui-slot', 'menu');
  return menu;
}
