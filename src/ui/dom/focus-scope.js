import { createEventScope } from './event-scope.js';
import { isElementRef, requireElementRef } from './required-refs.js';

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function canReceiveFocus(element) {
  if (!isElementRef(element) || typeof element.focus !== 'function') return false;
  if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
  if (element.disabled) return false;
  if (element.isConnected === false) return false;
  return true;
}

function collectTabbable(root) {
  if (typeof root.querySelectorAll !== 'function') return [];
  return [...root.querySelectorAll(TABBABLE_SELECTOR)].filter(canReceiveFocus);
}

export function createFocusScope(root, {
  initialFocus = null,
  returnFocus = root?.ownerDocument?.activeElement || null,
  trap = false
} = {}) {
  requireElementRef(root, 'focus scope root');
  if (initialFocus !== null && !isElementRef(initialFocus)) {
    throw new TypeError('Focus scope initialFocus must be an element reference or null.');
  }
  if (returnFocus !== null && !isElementRef(returnFocus)) returnFocus = null;
  if (typeof trap !== 'boolean') throw new TypeError('Focus scope trap must be a boolean.');

  const events = createEventScope();
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error('Focus scope has been destroyed.');
  }

  function focusInitial(options = { preventScroll: true }) {
    assertActive();
    const target = canReceiveFocus(initialFocus)
      ? initialFocus
      : collectTabbable(root)[0] || (canReceiveFocus(root) ? root : null);
    if (!target) return false;
    target.focus(options);
    return true;
  }

  function contain(event) {
    assertActive();
    if (!event || event.key !== 'Tab') return false;
    const tabbable = collectTabbable(root);
    if (!tabbable.length) {
      if (!canReceiveFocus(root)) return false;
      event.preventDefault?.();
      root.focus({ preventScroll: true });
      return true;
    }

    const active = root.ownerDocument?.activeElement || null;
    const currentIndex = tabbable.indexOf(active);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? tabbable.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex === tabbable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault?.();
    tabbable[nextIndex].focus({ preventScroll: true });
    return true;
  }

  function restore(options = { preventScroll: true }) {
    if (!canReceiveFocus(returnFocus)) return false;
    returnFocus.focus(options);
    return true;
  }

  if (trap) events.listen(root, 'keydown', contain);

  function destroy({ restoreFocus = true } = {}) {
    if (destroyed) return;
    destroyed = true;
    events.destroy();
    if (restoreFocus) restore();
    initialFocus = null;
    returnFocus = null;
  }

  return Object.freeze({
    focusInitial,
    contain,
    restore,
    destroy,
    isDestroyed: () => destroyed
  });
}
