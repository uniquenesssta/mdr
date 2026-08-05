import { createSafeElement } from '../dom/index.js';

export function createStatusBarShell(documentRef) {
  return createSafeElement(documentRef, 'div', {
    className: 'statusbar',
    attributes: {
      'aria-label': '状态栏',
      'data-ui-slot': 'status'
    }
  });
}
