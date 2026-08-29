/**
 * Atomic 8.6 reusable visual-widget focus policy.
 * Owns only single-primary-click focus behavior and its element-scoped disposer.
 */
export const WIDGET_INTERACTIVE_SELECTOR = 'button, a, input, textarea, select';

export function isWidgetInteractiveTarget(target) {
  return Boolean(target?.closest?.(WIDGET_INTERACTIVE_SELECTOR));
}

export function bindWidgetFocusPolicy(element, options = {}) {
  if (!element?.addEventListener || typeof element.focus !== 'function') {
    throw new TypeError('Widget focus policy requires a focusable element');
  }

  let disposed = false;
  const handleClick = event => {
    if (disposed
      || event.defaultPrevented
      || event.button !== 0
      || Number(event.detail) !== 1
      || isWidgetInteractiveTarget(event.target)
      || options.exclude?.(event)) return;
    element.focus({ preventScroll: options.preventScroll !== false });
  };

  element.addEventListener('click', handleClick);
  return () => {
    if (disposed) return;
    disposed = true;
    element.removeEventListener('click', handleClick);
  };
}
