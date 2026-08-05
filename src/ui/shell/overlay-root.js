function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createOverlayRoot requires a document.');
  }
}

export function createOverlayRoot(documentRef) {
  assertDocument(documentRef);
  const overlay = documentRef.createElement('div');
  overlay.id = 'overlay-root';
  overlay.className = 'overlay-root';
  overlay.setAttribute('data-ui-slot', 'overlay');
  return overlay;
}
