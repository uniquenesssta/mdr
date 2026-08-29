import { createSafeElement } from '../dom/index.js';

export function createOverlayRoot(documentRef) {
  return createSafeElement(documentRef, 'div', {
    id: 'overlay-root',
    className: 'l-overlay-root overlay-root',
    attributes: { 'data-ui-slot': 'overlay' }
  });
}
