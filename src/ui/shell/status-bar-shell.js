function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createStatusBarShell requires a document.');
  }
}

export function createStatusBarShell(documentRef) {
  assertDocument(documentRef);
  const status = documentRef.createElement('div');
  status.className = 'statusbar';
  status.setAttribute('aria-label', '状态栏');
  status.setAttribute('data-ui-slot', 'status');
  return status;
}
