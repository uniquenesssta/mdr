/** Bind workspace document/recent actions to the existing Menu command authority. */
import { createEventScope, createSafeElement } from '../../../ui/dom/index.js';
import { PopoverShell } from '../../../ui/components/popover-shell.js';
import { createRecentFilesMenuController } from '../recent-files-menu-controller.js';
import { MENU_COMMAND_IDS } from '../menu-command-bindings.js';

export function createWorkspaceActionsView({ sidebar, overlayRoot, commands, recentSource, desktopAvailable }) {
  const doc = sidebar.ownerDocument;
  const trigger = sidebar.querySelector('[data-workspace-recent]');
  const root = createSafeElement(doc, 'div', { className: 'c-popover writing-recent-panel', attributes: { 'aria-label': '最近打开' } });
  const list = createSafeElement(doc, 'div', { className: 'writing-recent-list' });
  root.append(list); overlayRoot.append(root);
  const events = createEventScope();
  const popover = new PopoverShell(root, { anchor: trigger });
  const recent = createRecentFilesMenuController({ owner: trigger, list, source: recentSource, commands, available: desktopAvailable });
  try {
    recent.start();
    events.listen(sidebar.querySelector('[data-workspace-new]'), 'click', () => commands.execute(MENU_COMMAND_IDS.DOCUMENT_NEW));
    events.listen(trigger, 'click', () => {
      if (popover.isOpen()) popover.close();
      else popover.open(null, { initialFocus: list.querySelector('[data-recent-files-action]') });
    });
    events.listen(list, 'click', event => { if (event.target.closest('[data-recent-files-action]')) popover.close(); });
  } catch (error) { recent.destroy(); popover.destroy(); events.destroy(); root.remove(); throw error; }
  return Object.freeze({ destroy() { events.destroy(); recent.destroy(); popover.destroy(); root.remove(); } });
}
