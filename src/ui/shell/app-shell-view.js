import { createSafeElement } from '../dom/index.js';
import { createMenuBarShell } from './menu-bar-shell.js';
import { createOverlayRoot } from './overlay-root.js';
import { createSidebarShell } from './sidebar-shell.js';
import { createStatusBarShell } from './status-bar-shell.js';
import { createToolbarShell } from './toolbar-shell.js';
import { createWorkspaceShell } from './workspace-shell.js';

export function createAppShellView(documentRef) {
  const app = createSafeElement(documentRef, 'div', {
    className: 'app',
    attributes: { 'data-ui-shell': 'app' }
  });
  const menu = createMenuBarShell(documentRef);
  const toolbar = createToolbarShell(documentRef);
  const sidebar = createSidebarShell(documentRef);
  const workspace = createWorkspaceShell(documentRef, sidebar);
  const status = createStatusBarShell(documentRef);
  const overlay = createOverlayRoot(documentRef);

  app.append(menu, toolbar, workspace.element, status);
  return Object.freeze({
    app,
    overlay,
    refs: Object.freeze({
      menu,
      toolbar,
      sidebar,
      editor: workspace.editor,
      preview: workspace.preview,
      status,
      overlay
    })
  });
}
