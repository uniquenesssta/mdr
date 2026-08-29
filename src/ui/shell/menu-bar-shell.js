import { createSafeElement } from '../dom/index.js';

export function createMenuBarShell(documentRef) {
  return createSafeElement(documentRef, 'nav', {
    className: 'l-menu-bar menu-bar',
    attributes: {
      'aria-label': '应用菜单',
      'data-ui-slot': 'menu'
    }
  });
}
