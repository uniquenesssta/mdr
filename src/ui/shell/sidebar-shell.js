import { createSafeElement } from '../dom/index.js';

export function createSidebarShell(documentRef) {
  return createSafeElement(documentRef, 'aside', {
    id: 'sidebar',
    className: 'sidebar',
    attributes: {
      'aria-label': '工作区导航',
      'data-ui-slot': 'sidebar'
    }
  });
}
