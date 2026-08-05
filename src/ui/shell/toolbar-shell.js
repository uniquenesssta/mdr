import { createSafeElement } from '../dom/index.js';

export function createToolbarShell(documentRef) {
  return createSafeElement(documentRef, 'div', {
    className: 'editor-toolbar',
    attributes: {
      role: 'toolbar',
      'aria-label': '编辑工具栏',
      'data-ui-slot': 'toolbar'
    }
  });
}
