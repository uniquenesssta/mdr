/**
 * Atomic 8.6 reusable widget button primitive.
 * Owns only button DOM creation plus element-scoped pointer/click behavior.
 */
export function createWidgetButton(label, className, onClick) {
  if (typeof onClick !== 'function') {
    throw new TypeError('Widget button requires a click handler');
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = String(className || '');
  button.textContent = String(label ?? '');
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return button;
}
