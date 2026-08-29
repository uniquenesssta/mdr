import { createEventScope } from './event-scope.js';
import { requireElementRef } from './required-refs.js';

function assertClassList(element) {
  if (!element.classList
    || typeof element.classList.add !== 'function'
    || typeof element.classList.remove !== 'function'
    || typeof element.classList.contains !== 'function') {
    throw new TypeError('Transition visibility requires an element with classList support.');
  }
}

export function createTransitionVisibility(element, {
  visibleClass = 'show',
  hiddenAttribute = 'aria-hidden',
  timeout = 200
} = {}) {
  requireElementRef(element, 'transition visibility element');
  assertClassList(element);
  const normalizedClass = String(visibleClass || '').trim();
  const normalizedAttribute = String(hiddenAttribute || '').trim();
  if (!normalizedClass) throw new TypeError('Transition visibility class must not be empty.');
  if (!normalizedAttribute) throw new TypeError('Transition visibility hidden attribute must not be empty.');
  if (!Number.isFinite(timeout) || timeout < 0) throw new TypeError('Transition visibility timeout must be a non-negative number.');

  let destroyed = false;
  let pending = null;

  function setHiddenState(hidden) {
    element.setAttribute(normalizedAttribute, hidden ? 'true' : 'false');
  }

  function cancelPending() {
    pending?.cancel();
    pending = null;
  }

  function assertActive() {
    if (destroyed) throw new Error('Transition visibility has been destroyed.');
  }

  function show() {
    assertActive();
    cancelPending();
    setHiddenState(false);
    element.classList.add(normalizedClass);
    return true;
  }

  function hide() {
    assertActive();
    cancelPending();
    element.classList.remove(normalizedClass);
    setHiddenState(true);

    return new Promise(resolve => {
      const events = createEventScope();
      let settled = false;
      let timer = null;
      const finish = completed => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        events.destroy();
        if (pending?.finish === finish) pending = null;
        resolve(completed);
      };
      events.listen(element, 'transitionend', event => {
        if (!event || event.target === element) finish(true);
      });
      timer = setTimeout(() => finish(true), timeout);
      pending = Object.freeze({ finish, cancel: () => finish(false) });
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelPending();
    element.classList.remove(normalizedClass);
    setHiddenState(true);
  }

  return Object.freeze({
    show,
    hide,
    destroy,
    isVisible: () => !destroyed && element.classList.contains(normalizedClass),
    isDestroyed: () => destroyed
  });
}
