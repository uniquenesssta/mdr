/**
 * Atomic 8.3 keyboard source-activation owner.
 * Owns only per-element keyboard gesture recognition and listener cleanup.
 * Source range calculation, editor selection/scroll and Session transitions remain outside this module.
 */

export const HYBRID_SOURCE_ACTIVATION_KEYS = Object.freeze(['Enter', 'F2']);

const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select';

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.(INTERACTIVE_SELECTOR));
}

export function bindSourceActivation(element, onActivate, options = {}) {
  if (!element?.addEventListener || typeof onActivate !== 'function') {
    throw new TypeError('源码激活绑定需要有效元素和处理函数');
  }

  const keys = new Set(options.sourceKeys ?? HYBRID_SOURCE_ACTIVATION_KEYS);
  let disposed = false;
  const handleKeydown = event => {
    if (disposed || !keys.has(event.key) || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    onActivate(event, { trigger: 'keyboard', key: event.key });
  };

  element.addEventListener('keydown', handleKeydown);
  return () => {
    if (disposed) return;
    disposed = true;
    element.removeEventListener('keydown', handleKeydown);
  };
}
