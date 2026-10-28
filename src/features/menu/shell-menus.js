/**
 * Responsibility: Own dropdown/context-menu dismissal and transient toast presentation.
 * Imports: Explicit caller capabilities and application lifetime management.
 * Exports: createShellMenus.
 * State/side effects: Owns only this feature's projections, listeners and pending UI work.
 * Lifecycle: Explicit construction, rollback on failure and idempotent destroy.
 */
import { createApplicationLifetime } from '../../bootstrap/application-lifetime.js';

export function createShellMenus({ document, window, toast, coreSubmenuPositionerPort, coreEditorUiCommandPort }) {
  const lifetime = createApplicationLifetime();
  const setTimeout = lifetime.setTimeout, clearTimeout = lifetime.clearTimeout;
  try {
    function positionTopLevelAppMenu(menu) {
      if (!menu || !menu.parentElement?.classList.contains('menu-dropdown')) return;
      const trigger = menu.parentElement.querySelector(':scope > .menu-trigger, :scope > button');
      if (!trigger) return;
      const triggerRect = trigger.getBoundingClientRect();
      const margin = 8;
      menu.style.position = 'fixed';
      menu.style.right = 'auto';
      menu.style.top = Math.round(triggerRect.bottom + 4) + 'px';
      menu.style.left = Math.round(triggerRect.left) + 'px';
      const menuRect = menu.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
      menu.style.left = Math.round(Math.max(margin, Math.min(triggerRect.left, maxLeft))) + 'px';
      if (triggerRect.bottom + 4 + menuRect.height > window.innerHeight - margin) {
        menu.style.top = Math.round(Math.max(margin, Math.min(triggerRect.top - menuRect.height - 4, maxTop))) + 'px';
      }
    }

    function resetTopLevelAppMenuPosition(menu) {
      if (!menu || !menu.parentElement?.classList.contains('menu-dropdown')) return;
      menu.style.removeProperty('position');
      menu.style.removeProperty('left');
      menu.style.removeProperty('right');
      menu.style.removeProperty('top');
    }

    function toggleAppMenu(menuId) {
      const target = document.getElementById(menuId);
      if (!target) return;
      const willShow = !target.classList.contains('show');
      if (!willShow) { closeAppMenus(); return; }
      openAppMenu(menuId);
    }

    function openAppMenu(menuId) {
      const target = document.getElementById(menuId);
      if (!target || target.classList.contains('show')) return;
      closeAppMenus();
      target.classList.add('show');
      const trigger = target.parentElement?.querySelector(':scope > .menu-trigger, :scope > button');
      trigger?.setAttribute('aria-expanded', 'true');
      positionTopLevelAppMenu(target);
    }

    function closeAppMenus() {
      document.querySelectorAll('.menu-dropdown-list.show').forEach(menu => {
        menu.classList.remove('show');
        resetTopLevelAppMenuPosition(menu);
      });
      coreSubmenuPositionerPort.closeAll();
      document.querySelectorAll('.menu-trigger[aria-expanded="true"]').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
      });
    }

    function showContextMenu(menu, event) {
      if (!menu || !event) return;
      event.preventDefault();
      event.stopPropagation();
      closeContextMenus();
      menu.style.display = 'block';
      menu.classList.add('show');
      const width = menu.offsetWidth || 180;
      const height = menu.offsetHeight || 220;
      const x = Math.min(event.clientX, window.innerWidth - width - 8);
      const y = Math.min(event.clientY, window.innerHeight - height - 8);
      menu.style.left = Math.max(8, x) + 'px';
      menu.style.top = Math.max(8, y) + 'px';
    }

    function closeContextMenus() {
      const menu = document.getElementById('outline-context-menu');
      menu?.classList.remove('show');
      if (menu) menu.style.display = 'none';
    }
    let toastTimer = 0;
    function showToast(msg) {
      if (!lifetime.alive) return;
      toast.textContent = msg; toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
    }
    lifetime.own(() => { toast.classList.remove('show'); closeContextMenus(); closeAppMenus(); });
    lifetime.own(coreEditorUiCommandPort.register({ notify: showToast, closeAppMenus, showContextMenu, closeContextMenus }));
    for (const trigger of document.querySelectorAll('[data-menu-toggle]')) {
      lifetime.listen(trigger, 'pointerenter', event => {
        if (event.pointerType === 'touch' || event.buttons) return;
        if (!document.querySelectorAll('.menu-dropdown-list.show').length) return;
        const id = trigger.dataset.menuToggle;
        if (document.getElementById(id)?.classList.contains('show')) return;
        openAppMenu(id);
      });
      lifetime.listen(trigger, 'click', () => toggleAppMenu(trigger.dataset.menuToggle));
    }
    return Object.freeze({ showToast, closeAppMenus, closeContextMenus, toggleAppMenu, destroy: lifetime.destroy });
  } catch (error) { lifetime.destroy(); throw error; }
}
