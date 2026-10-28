/** Own a nonmodal, anchored surface; preserve editor selection and allow work outside it. */
import { createEventScope, requireElementRef } from '../dom/index.js';

export class PopoverShell {
  constructor(root, { anchor = null, alignToViewport = false, onClose = () => {} } = {}) {
    requireElementRef(root, 'Popover root');
    this.root = root;
    this.anchor = anchor;
    this.alignToViewport = alignToViewport;
    this.onClose = onClose;
    this.events = createEventScope();
    this.opened = false;
    this.destroyed = false;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    this.events.listen(root.ownerDocument, 'keydown', event => {
      if (!this.opened || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close('escape');
    }, true);
    this.events.listen(root.ownerDocument, 'pointerdown', event => {
      if (!this.opened || root.contains(event.target) || this.anchor?.contains(event.target)) return;
      this.close('outside', false);
    });
    const runtime = root.ownerDocument.defaultView;
    if (runtime) this.events.listen(runtime, 'resize', () => this.position());
  }

  position() {
    if (!this.opened) return;
    const runtime = this.root.ownerDocument.defaultView;
    const box = this.anchor?.getBoundingClientRect();
    const rect = this.root.getBoundingClientRect();
    const width = runtime?.innerWidth || 1440;
    const height = runtime?.innerHeight || 960;
    this.root.style.left = `${Math.max(8, Math.min(box && !this.alignToViewport ? box.right - rect.width : width - rect.width - 24, width - rect.width - 8))}px`;
    const top = box ? (box.bottom + 8 + rect.height <= height - 8 ? box.bottom + 8 : box.top - rect.height - 8) : 112;
    this.root.style.top = `${Math.max(8, Math.min(top, height - rect.height - 8))}px`;
  }

  open(_content, { initialFocus = null, onClose = null } = {}) {
    if (this.destroyed) throw new Error('Popover is destroyed.');
    if (!this.opened) this.returnFocus = this.root.ownerDocument.activeElement;
    this.sessionClose = onClose;
    this.opened = true;
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.classList.add('show');
    this.position();
    initialFocus?.focus?.({ preventScroll: true });
    return true;
  }

  close(reason = 'feature-close', restoreFocus = true) {
    if (!this.opened) return false;
    this.opened = false;
    this.root.hidden = true;
    this.root.classList.remove('show');
    this.root.setAttribute('aria-hidden', 'true');
    if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus?.({ preventScroll: true });
    this.sessionClose?.(reason);
    this.onClose(reason);
    return true;
  }

  isOpen() { return this.opened; }
  destroy() {
    if (this.destroyed) return;
    this.close('destroy', false);
    this.destroyed = true;
    this.events.destroy();
  }
}
