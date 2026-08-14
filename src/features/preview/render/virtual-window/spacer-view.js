/**
 * Responsibility: Own only the virtual preview top/bottom spacer DOM nodes.
 * Imports: None.
 * Exports: createVirtualSpacerView.
 * State/side effects: Mutates only its two spacer nodes.
 * Lifecycle: mount/update/destroy.
 */

export function createVirtualSpacerView({ documentRef }) {
  if (!documentRef?.createElement) throw new TypeError('documentRef is required.');
  const top = documentRef.createElement('div');
  top.className = 'virtual-preview-spacer virtual-preview-spacer-top';
  top.setAttribute('aria-hidden', 'true');
  const bottom = documentRef.createElement('div');
  bottom.className = 'virtual-preview-spacer virtual-preview-spacer-bottom';
  bottom.setAttribute('aria-hidden', 'true');
  let destroyed = false;

  function assertAlive() {
    if (destroyed) throw new Error('Virtual spacer view is destroyed.');
  }

  return Object.freeze({
    top,
    bottom,
    appendTo(fragmentOrBody) {
      assertAlive();
      fragmentOrBody.append(top, bottom);
    },
    update(topHeight, bottomHeight) {
      assertAlive();
      top.style.height = Math.max(0, Number(topHeight) || 0) + 'px';
      bottom.style.height = Math.max(0, Number(bottomHeight) || 0) + 'px';
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      top.remove?.();
      bottom.remove?.();
    }
  });
}
