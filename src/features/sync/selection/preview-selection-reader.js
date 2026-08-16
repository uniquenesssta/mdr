/**
 * Responsibility: Read final preview Selection boundaries and own preview selectionchange/pointer stabilization before publishing a stable immutable snapshot.
 * Imports: None; browser Selection, DOM event targets and frame scheduling are injected capabilities.
 * Exports: PreviewSelectionReader and createPreviewSelectionReader.
 * State/side effects: Owns preview pointer-active state, one cancellable stabilization frame chain, subscribers and listener lifecycle only.
 * Lifecycle: start()/stop() are idempotent; destroy() is terminal, cancels stale frame work and removes every owned listener/subscriber.
 */

function assertEventTarget(target, label) {
  if (!target || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') {
    throw new TypeError(`PreviewSelectionReader requires ${label} event target`);
  }
}

function normalizeOffset(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

export class PreviewSelectionReader {
  constructor({ previewElement, documentRef, getSelection, requestFrame, cancelFrame } = {}) {
    assertEventTarget(previewElement, 'previewElement');
    assertEventTarget(documentRef, 'documentRef');
    if (typeof getSelection !== 'function') throw new TypeError('PreviewSelectionReader requires getSelection capability');
    if (typeof requestFrame !== 'function') throw new TypeError('PreviewSelectionReader requires requestFrame capability');
    if (typeof cancelFrame !== 'function') throw new TypeError('PreviewSelectionReader requires cancelFrame capability');

    this.previewElement = previewElement;
    this.documentRef = documentRef;
    this.getSelection = getSelection;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.listeners = new Set();
    this.started = false;
    this.destroyed = false;
    this.pointerActive = false;
    this.selectionDirty = false;
    this.frameId = 0;
    this.frameVersion = 0;

    this.onPointerDown = () => {
      this.pointerActive = true;
      this.selectionDirty = false;
      this.cancelPending();
    };
    this.onPointerEnd = () => {
      if (!this.pointerActive) return;
      this.pointerActive = false;
      this.selectionDirty = false;
      this.scheduleStable('preview-pointerup', { force: true, frames: 2, allowEmpty: true });
    };
    this.onSelectionChange = () => {
      if (!this.read()) return;
      if (this.pointerActive) {
        this.selectionDirty = true;
        return;
      }
      this.scheduleStable('document-selectionchange', { frames: 1 });
    };
  }

  read() {
    if (this.destroyed) return null;
    const selection = this.getSelection?.();
    if (!selection || selection.isCollapsed || Number(selection.rangeCount) < 1) return null;
    const text = String(selection.toString?.() || '');
    if (!text.trim()) return null;
    if (!this.previewElement.contains?.(selection.anchorNode) || !this.previewElement.contains?.(selection.focusNode)) return null;
    let range;
    try {
      const current = selection.getRangeAt(0);
      range = typeof current?.cloneRange === 'function' ? current.cloneRange() : current;
    } catch (_) {
      return null;
    }
    if (!range) return null;
    return Object.freeze({
      anchorNode: selection.anchorNode,
      anchorOffset: normalizeOffset(selection.anchorOffset),
      focusNode: selection.focusNode,
      focusOffset: normalizeOffset(selection.focusOffset),
      text,
      range,
      isCollapsed: false
    });
  }

  subscribe(listener) {
    if (this.destroyed) throw new Error('PreviewSelectionReader is destroyed');
    if (typeof listener !== 'function') throw new TypeError('PreviewSelectionReader subscriber must be a function');
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  start() {
    if (this.destroyed) throw new Error('PreviewSelectionReader is destroyed');
    if (this.started) return this;
    this.started = true;
    this.previewElement.addEventListener('pointerdown', this.onPointerDown, true);
    this.documentRef.addEventListener('pointerup', this.onPointerEnd, true);
    this.documentRef.addEventListener('pointercancel', this.onPointerEnd, true);
    this.documentRef.addEventListener('selectionchange', this.onSelectionChange);
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.pointerActive = false;
    this.selectionDirty = false;
    this.cancelPending();
    this.previewElement.removeEventListener('pointerdown', this.onPointerDown, true);
    this.documentRef.removeEventListener('pointerup', this.onPointerEnd, true);
    this.documentRef.removeEventListener('pointercancel', this.onPointerEnd, true);
    this.documentRef.removeEventListener('selectionchange', this.onSelectionChange);
  }

  scheduleStable(reason, { force = false, frames = 1, allowEmpty = false } = {}) {
    if (this.destroyed || !this.started) return false;
    this.cancelPending();
    const version = ++this.frameVersion;
    let remaining = Math.max(1, Number(frames) || 1);
    const run = () => {
      if (this.destroyed || !this.started || version !== this.frameVersion) return;
      if (--remaining > 0) {
        this.frameId = this.requestFrame(run);
        return;
      }
      this.frameId = 0;
      const snapshot = this.read();
      if (!snapshot && !allowEmpty) return;
      const event = Object.freeze({ reason, force: Boolean(force), snapshot });
      for (const listener of [...this.listeners]) listener(event);
    };
    this.frameId = this.requestFrame(run);
    return true;
  }

  cancelPending() {
    this.frameVersion += 1;
    if (this.frameId) this.cancelFrame(this.frameId);
    this.frameId = 0;
  }

  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.frameVersion += 1;
    this.listeners.clear();
    this.previewElement = null;
    this.documentRef = null;
    this.getSelection = null;
    this.requestFrame = null;
    this.cancelFrame = null;
  }
}

export function createPreviewSelectionReader(options = {}) {
  return new PreviewSelectionReader(options);
}
