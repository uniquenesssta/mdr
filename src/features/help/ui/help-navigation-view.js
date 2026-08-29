/**
 * Responsibility: Own Help navigation DOM and active-page presentation.
 * Imports: Generic UI DOM primitives and Help page IDs only.
 * Exports: createHelpNavigationView().
 * State/side effects: Owns navigation buttons and one scoped click listener. Lifecycle: explicit destroyable view.
 */
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';
import { HELP_PAGE_IDS, normalizeHelpPage } from '../help-state.js';

function findHelpButton(root, target) {
  let current = target;
  while (current && current !== root) {
    if (current.dataset?.helpPage) return current;
    current = current.parentElement || null;
  }
  return null;
}

export function createHelpNavigationView(root, { onNavigate } = {}) {
  requireElementRef(root, 'help navigation root');
  if (typeof onNavigate !== 'function') throw new TypeError('Help navigation requires a navigate handler.');
  const documentRef = root.ownerDocument;
  const events = createEventScope();
  let buttons = new Map();
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Help navigation view has been destroyed.');
  };

  try {
    events.listen(root, 'click', event => {
      const button = findHelpButton(root, event?.target);
      if (!button) return;
      onNavigate(button.dataset.helpPage);
    });
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Help navigation view cleanly.');
  }

  const api = Object.freeze({
    render(document, activePage = 'start') {
      assertActive();
      const nextButtons = new Map();
      const fragment = documentRef.createDocumentFragment();
      for (const id of HELP_PAGE_IDS) {
        const page = document.pages[id];
        const button = createSafeElement(documentRef, 'button', {
          className: 'preferences-nav-item',
          attributes: { type: 'button', 'aria-selected': 'false' },
          dataset: { helpPage: id }
        });
        button.append(
          createSafeElement(documentRef, 'span', { text: page.title }),
          createSafeElement(documentRef, 'small', { text: page.summary })
        );
        nextButtons.set(id, button);
        fragment.append(button);
      }
      root.replaceChildren(fragment);
      buttons = nextButtons;
      api.setActive(activePage);
    },
    setActive(page) {
      assertActive();
      const activePage = normalizeHelpPage(page);
      for (const [id, button] of buttons) {
        const active = id === activePage;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      }
      return activePage;
    },
    getActiveButton() {
      assertActive();
      return [...buttons.values()].find(button => button.classList.contains('active')) || null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      buttons.clear();
      try { root.replaceChildren(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Help navigation view cleanly.');
    }
  });
  return api;
}
