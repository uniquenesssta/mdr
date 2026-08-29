/**
 * Responsibility: Own Help open/close/navigation, first-run visibility, locale refresh and shown-state persistence.
 * Imports: Bounded UI event/element validation only; feature dependencies are injected.
 * Exports: createHelpController() and the preserved storage key.
 * State/side effects: Owns locale/menu subscriptions and the Help shown write. Lifecycle: explicit destroyable instance.
 */
import { createEventScope, requireElementRef } from '../../ui/dom/index.js';

export const HELP_SHOWN_STORAGE_KEY = 'md_editor_help_shown';

function assertI18n(i18n) {
  if (!i18n || typeof i18n.locale !== 'string' || typeof i18n.subscribe !== 'function') {
    throw new TypeError('Help controller requires an active I18n service.');
  }
}

function assertStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('Help controller requires Web Storage semantics.');
  }
}

function assertPort(value, methods, label) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(`Help controller requires ${label}.`);
  }
}

export function createHelpController({
  i18n,
  contentRegistry,
  state,
  dialogView,
  navigationView,
  storage,
  openTrigger
}) {
  assertI18n(i18n);
  assertStorage(storage);
  assertPort(contentRegistry, ['get'], 'a content registry');
  assertPort(state, ['navigate', 'destroy'], 'Help state');
  assertPort(dialogView, ['renderDocument', 'renderPage', 'open', 'close', 'isOpen', 'destroy'], 'a dialog view');
  assertPort(navigationView, ['render', 'setActive', 'getActiveButton', 'destroy'], 'a navigation view');
  requireElementRef(openTrigger, 'Help open trigger');

  const events = createEventScope();
  let destroyed = false;
  let currentDocument = null;
  let disposeLocaleSubscription = null;

  const assertActive = () => {
    if (destroyed) throw new Error('Help controller has been destroyed.');
  };

  const markShown = () => storage.setItem(HELP_SHOWN_STORAGE_KEY, 'true');

  function renderLocale(locale) {
    currentDocument = contentRegistry.get(locale);
    const page = state.activePage;
    dialogView.renderDocument(currentDocument);
    navigationView.render(currentDocument, page);
    dialogView.renderPage(currentDocument.pages[page]);
  }

  function navigate(page) {
    assertActive();
    const nextPage = state.navigate(page);
    navigationView.setActive(nextPage);
    dialogView.renderPage(currentDocument.pages[nextPage]);
    return nextPage;
  }

  function open(page = state.activePage) {
    assertActive();
    navigate(page);
    return dialogView.open({
      initialFocus: navigationView.getActiveButton(),
      onClose: markShown
    });
  }

  function close(reason = 'feature-close') {
    assertActive();
    return dialogView.close(reason);
  }

  try {
    renderLocale(i18n.locale);
    disposeLocaleSubscription = i18n.subscribe(event => renderLocale(event.locale));
    events.listen(openTrigger, 'click', () => open());
  } catch (error) {
    const errors = [error];
    const dispose = disposeLocaleSubscription;
    disposeLocaleSubscription = null;
    try { dispose?.(); } catch (cleanupError) { errors.push(cleanupError); }
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    currentDocument = null;
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Help controller cleanly.');
  }

  return Object.freeze({
    get activePage() {
      assertActive();
      return state.activePage;
    },
    open,
    close,
    navigate,
    openFirstRun() {
      assertActive();
      if (storage.getItem(HELP_SHOWN_STORAGE_KEY)) return false;
      open();
      return true;
    },
    isOpen() {
      assertActive();
      return dialogView.isOpen();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      const dispose = disposeLocaleSubscription;
      disposeLocaleSubscription = null;
      try { dispose?.(); } catch (error) { errors.push(error); }
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { navigationView.destroy(); } catch (error) { errors.push(error); }
      try { dialogView.destroy(); } catch (error) { errors.push(error); }
      try { state.destroy(); } catch (error) { errors.push(error); }
      currentDocument = null;
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Help controller cleanly.');
    }
  });
}
