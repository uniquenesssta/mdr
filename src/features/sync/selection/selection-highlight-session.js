/**
 * Responsibility: Authoritative R9-09 preview selection highlight presentation and lifecycle.
 * Imports: Injected preview/document/CSS Highlight capabilities only; no model, mapping, feedback, retry or scroll policy.
 * Exports: SelectionHighlightSession and factory.
 * State/side effects: Owns active CSS Highlight ranges, atomic classes, text fallback wrappers and one remount restore intent.
 * Lifecycle: Explicit clear/destroy; destroy removes every owned range/effect and is terminal/idempotent.
 */

const TEXT_NODE = 3;
const HIGHLIGHT_NAME = 'preview-selection-sync';
const ATOMIC_CLASS = 'preview-atomic-selection-highlight';
const FALLBACK_CLASS = 'preview-text-highlight';

function assertCapability(condition, message) {
  if (!condition) throw new TypeError(message);
}

function normalizePlan(plan = {}) {
  return {
    ranges: Array.from(plan?.ranges || []).filter(Boolean),
    atomicElements: Array.from(plan?.atomicElements || []).filter(Boolean)
  };
}

export class SelectionHighlightSession {
  constructor({
    previewElement,
    documentRef = previewElement?.ownerDocument,
    highlightRegistry = null,
    HighlightCtor = null,
    reportError = (message, error) => console.warn(message, error)
  } = {}) {
    assertCapability(previewElement && typeof previewElement.contains === 'function', 'SelectionHighlightSession requires previewElement');
    assertCapability(documentRef && typeof documentRef.createElement === 'function' && typeof documentRef.createTextNode === 'function', 'SelectionHighlightSession requires documentRef DOM creation capabilities');
    if (highlightRegistry) {
      assertCapability(typeof highlightRegistry.set === 'function' && typeof highlightRegistry.delete === 'function', 'SelectionHighlightSession highlightRegistry requires set/delete');
    }
    if (HighlightCtor !== null) assertCapability(typeof HighlightCtor === 'function', 'SelectionHighlightSession HighlightCtor must be a constructor');
    assertCapability(typeof reportError === 'function', 'SelectionHighlightSession requires reportError');

    this.previewElement = previewElement;
    this.documentRef = documentRef;
    this.highlightRegistry = highlightRegistry;
    this.HighlightCtor = HighlightCtor;
    this.reportError = reportError;
    this.ranges = [];
    this.atomicElements = new Set();
    this.fallbackMarks = new Set();
    this.restoreFactory = null;
    this.destroyed = false;
    this.restoreCount = 0;
  }

  canPresent(plan = {}) {
    if (this.destroyed) return false;
    const normalized = normalizePlan(plan);
    if (!normalized.ranges.every(range => this.ownsRange(range))) return false;
    if (!normalized.atomicElements.every(element => this.ownsElement(element))) return false;
    if (!normalized.ranges.length) return normalized.atomicElements.length > 0;
    if (this.supportsCssHighlights()) return true;
    return normalized.ranges.length === 1 && this.canWrapTextRange(normalized.ranges[0]);
  }

  show(plan = {}, { restore = null } = {}) {
    this.assertUsable();
    if (restore !== null && typeof restore !== 'function') {
      throw new TypeError('SelectionHighlightSession restore must be a function or null');
    }
    this.clearEffects();
    this.restoreFactory = restore;
    if (!this.canPresent(plan)) return false;
    return this.applyPlan(plan);
  }

  restore() {
    if (this.destroyed || typeof this.restoreFactory !== 'function') return false;
    const restoreFactory = this.restoreFactory;
    this.clearEffects();
    let plan = null;
    try {
      plan = restoreFactory();
    } catch (error) {
      this.reportError('Selection highlight remount restore failed.', error);
      return false;
    }
    if (!plan || !this.canPresent(plan)) return false;
    const applied = this.applyPlan(plan);
    if (applied) this.restoreCount += 1;
    return applied;
  }

  clear() {
    if (this.destroyed) return;
    this.clearEffects();
    this.restoreFactory = null;
  }

  getState() {
    return Object.freeze({
      active: this.ranges.length > 0 || this.atomicElements.size > 0 || this.fallbackMarks.size > 0,
      rangeCount: this.ranges.length,
      atomicCount: this.atomicElements.size,
      fallbackCount: this.fallbackMarks.size,
      hasRestore: typeof this.restoreFactory === 'function',
      restoreCount: this.restoreCount,
      destroyed: this.destroyed
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.previewElement = null;
    this.documentRef = null;
    this.highlightRegistry = null;
    this.HighlightCtor = null;
    this.reportError = null;
  }

  supportsCssHighlights() {
    return Boolean(this.highlightRegistry && this.HighlightCtor);
  }

  ownsElement(element) {
    return Boolean(element && this.previewElement.contains(element));
  }

  ownsRange(range) {
    const start = range?.startContainer;
    const end = range?.endContainer;
    if (!start || !end) return false;
    return this.ownsNode(start) && this.ownsNode(end);
  }

  ownsNode(node) {
    const element = node?.nodeType === TEXT_NODE ? node.parentNode : node;
    return Boolean(element && (element === this.previewElement || this.previewElement.contains(element)));
  }

  canWrapTextRange(range) {
    if (!this.ownsRange(range)) return false;
    if (range.startContainer !== range.endContainer || range.startContainer?.nodeType !== TEXT_NODE) return false;
    const length = Number(range.startContainer.nodeValue?.length) || 0;
    const start = Math.max(0, Math.min(length, Number(range.startOffset) || 0));
    const end = Math.max(start, Math.min(length, Number(range.endOffset) || 0));
    return end > start && typeof range.startContainer.splitText === 'function';
  }

  applyPlan(plan) {
    const { ranges, atomicElements } = normalizePlan(plan);
    let presented = ranges.length === 0;
    if (ranges.length && this.supportsCssHighlights()) {
      this.highlightRegistry.set(HIGHLIGHT_NAME, new this.HighlightCtor(...ranges));
      presented = true;
    } else if (ranges.length === 1) {
      const mark = this.wrapTextRange(ranges[0]);
      if (mark) {
        this.fallbackMarks.add(mark);
        presented = true;
      }
    }
    if (!presented) return false;
    for (const element of atomicElements) {
      element.classList?.add?.(ATOMIC_CLASS);
      this.atomicElements.add(element);
    }
    this.ranges = ranges;
    return ranges.length > 0 || atomicElements.length > 0;
  }

  wrapTextRange(range) {
    if (!this.canWrapTextRange(range)) return null;
    const node = range.startContainer;
    const length = node.nodeValue.length;
    const start = Math.max(0, Math.min(length, Number(range.startOffset) || 0));
    const end = Math.max(start, Math.min(length, Number(range.endOffset) || 0));
    const selected = node.splitText(start);
    selected.splitText(end - start);
    const mark = this.documentRef.createElement('span');
    mark.className = FALLBACK_CLASS;
    mark.textContent = selected.nodeValue || '';
    selected.replaceWith(mark);
    return mark;
  }

  clearEffects() {
    this.highlightRegistry?.delete?.(HIGHLIGHT_NAME);
    for (const element of this.atomicElements) element.classList?.remove?.(ATOMIC_CLASS);
    this.atomicElements.clear();
    for (const mark of this.fallbackMarks) {
      const parent = mark?.parentNode;
      if (!parent) continue;
      const text = this.documentRef.createTextNode(mark.textContent || '');
      mark.replaceWith(text);
      parent.normalize?.();
    }
    this.fallbackMarks.clear();
    this.ranges = [];
  }

  assertUsable() {
    if (this.destroyed) throw new Error('SelectionHighlightSession is destroyed');
  }
}

export function createSelectionHighlightSession(options = {}) {
  return new SelectionHighlightSession(options);
}
