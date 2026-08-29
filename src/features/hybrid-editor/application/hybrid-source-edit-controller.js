import {
  HYBRID_COMPONENT_MODES,
  createHybridComponentKey
} from '../state/hybrid-component-session.js';

const REQUIRED_EDITOR_PORT_METHODS = Object.freeze([
  'getDocumentLength',
  'getScrollViewportMetrics',
  'markProgrammaticScroll',
  'focus',
  'revealSourceRange',
  'inspectUpdate',
  'positionAtCoordinates',
  'setSelection',
  'blur'
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cloneRange(range) {
  return range ? { ...range } : null;
}

function normalizeActiveRange(range) {
  if (!range) return null;
  const from = Math.max(0, Number(range.from) || 0);
  const to = Math.max(from + 1, Number(range.to) || from + 1);
  return {
    ...range,
    from,
    to,
    componentType: String(range.componentType || 'block'),
    componentKey: String(range.componentKey || createHybridComponentKey(range.componentType || 'block', from))
  };
}

function selectionIntersectsRange(selection, range) {
  if (!selection || !range) return false;
  const from = Math.min(Number(selection.anchor) || 0, Number(selection.head) || 0);
  const to = Math.max(Number(selection.anchor) || 0, Number(selection.head) || 0);
  return to >= range.from && from <= range.to;
}

function requireEditorPort(editorPort) {
  if (!editorPort || typeof editorPort !== 'object') {
    throw new TypeError('Source Edit Controller requires an editor port');
  }
  for (const method of REQUIRED_EDITOR_PORT_METHODS) {
    if (typeof editorPort[method] !== 'function') {
      throw new TypeError(`Source Edit Controller editor port requires ${method}()`);
    }
  }
  return editorPort;
}

function requireSession(session) {
  if (!session
    || typeof session.transition !== 'function'
    || typeof session.close !== 'function'
    || typeof session.registerCloser !== 'function') {
    throw new TypeError('Source Edit Controller requires a HybridComponentSession port');
  }
  return session;
}

export class HybridSourceEditController {
  constructor(options = {}) {
    this.editorPort = requireEditorPort(options.editorPort);
    this.session = requireSession(options.session);
    this.requestFrame = typeof options.requestFrame === 'function'
      ? options.requestFrame
      : callback => callback();
    this.scheduleGeometry = typeof options.scheduleGeometry === 'function'
      ? options.scheduleGeometry
      : () => {};
    this.recordClose = typeof options.recordClose === 'function'
      ? options.recordClose
      : () => {};
    this.activeRange = null;
    this.unregisterCloser = () => {};
    this.geometryGeneration = 0;
    this.destroyed = false;
  }

  getActiveRange() {
    return cloneRange(this.activeRange);
  }

  open(descriptor = {}, options = {}) {
    this.#assertAlive();
    const documentLength = Math.max(0, Number(this.editorPort.getDocumentLength()) || 0);
    const blockFrom = clamp(descriptor.from, 0, documentLength);
    const blockTo = clamp(descriptor.to ?? blockFrom, blockFrom, documentLength);
    const selectionFrom = clamp(descriptor.editFrom ?? blockFrom, blockFrom, blockTo);
    const selectionTo = clamp(descriptor.editTo ?? selectionFrom, selectionFrom, blockTo);
    const position = clamp(
      descriptor.preferredPosition ?? selectionFrom,
      selectionFrom,
      Math.max(selectionFrom, selectionTo)
    );
    const viewport = this.editorPort.getScrollViewportMetrics() || {};
    const availableHeight = Math.max(80, Number(viewport.clientHeight) || Number(viewport.height) || 0);
    const anchorTop = Number(options.anchorRect?.top);
    const viewportTop = Number(viewport.top) || 0;
    const relativeTop = Number.isFinite(anchorTop)
      ? anchorTop - viewportTop
      : availableHeight * 0.35;
    const yMargin = clamp(relativeTop, 12, Math.max(12, availableHeight - 56));
    const componentType = String(descriptor.componentType || 'block');
    const componentKey = createHybridComponentKey(componentType, blockFrom);

    this.session.transition({
      key: componentKey,
      type: componentType,
      from: blockFrom,
      mode: HYBRID_COMPONENT_MODES.SOURCE,
      reason: String(descriptor.sourceTrigger || 'source-open'),
      details: { sourceFrom: blockFrom, sourceTo: blockTo }
    });

    this.unregisterCloser();
    this.unregisterCloser = () => {};
    this.activeRange = normalizeActiveRange({
      from: blockFrom,
      to: Math.max(blockFrom + 1, blockTo),
      componentType,
      componentKey
    });
    this.unregisterCloser = this.session.registerCloser(componentKey, request => {
      if (this.activeRange?.componentKey !== componentKey) return;
      this.#clearLocalRange();
      this.#invalidateDeferredGeometry();
      if (request?.reason === 'superseded') {
        this.recordClose({
          trigger: 'superseded',
          sourceFrom: blockFrom,
          sourceTo: Math.max(blockFrom + 1, blockTo),
          nextKey: request.nextKey || null,
          nextMode: request.nextMode || null
        });
      }
    });

    this.editorPort.markProgrammaticScroll('editor', 420);
    this.editorPort.focus();
    this.editorPort.revealSourceRange({
      sourceFrom: blockFrom,
      sourceTo: Math.max(blockFrom + 1, blockTo),
      selectionFrom,
      selectionTo,
      position,
      yMargin
    });
    this.#scheduleDeferredGeometry('source-opened');
    return this.getActiveRange();
  }

  handleEditorUpdate(update) {
    this.#assertAlive();
    if (!this.activeRange) return null;
    const inspected = this.editorPort.inspectUpdate(update, this.activeRange) || {};
    if (inspected.range) this.activeRange = normalizeActiveRange(inspected.range);
    const activeRange = this.activeRange;
    if (activeRange
      && inspected.selectionSet
      && !selectionIntersectsRange(inspected.selection, activeRange)) {
      this.close('selection-left', { trigger: 'selection-left' });
      this.recordClose({
        trigger: 'selection-left',
        sourceFrom: activeRange.from,
        sourceTo: activeRange.to
      });
    }
    return this.getActiveRange();
  }

  close(reason = 'source-closed', details = {}) {
    this.#assertAlive();
    const range = this.activeRange;
    if (!range) return false;
    this.#clearLocalRange();
    this.#invalidateDeferredGeometry();
    this.session.close(
      range.componentKey,
      String(reason || 'source-closed'),
      details && typeof details === 'object' ? details : {},
      HYBRID_COMPONENT_MODES.SOURCE
    );
    return true;
  }

  closeFromPointer(pointer = {}) {
    this.#assertAlive();
    const range = this.activeRange;
    if (!range || Number(pointer.button) !== 0) return false;
    const clickedPosition = this.editorPort.positionAtCoordinates({
      x: Number(pointer.x) || 0,
      y: Number(pointer.y) || 0
    });
    const clickedSourceLine = Boolean(pointer.targetIsEditorLine)
      && Number.isInteger(clickedPosition)
      && clickedPosition >= range.from
      && clickedPosition <= range.to;
    if (clickedSourceLine) return false;

    let fallbackPosition = Number.isInteger(clickedPosition) ? clickedPosition : null;
    if (fallbackPosition !== null
      && fallbackPosition >= range.from
      && fallbackPosition <= range.to) {
      fallbackPosition = null;
    }
    if (fallbackPosition === null) {
      const documentLength = Math.max(0, Number(this.editorPort.getDocumentLength()) || 0);
      if (range.to < documentLength) fallbackPosition = range.to + 1;
      else if (range.from > 0) fallbackPosition = range.from - 1;
    }

    // Frozen ordering: SOURCE must close before the same pointer is resolved against
    // the editor geometry that becomes visible after the close.
    this.close('pointer-outside-source', { trigger: 'pointer-outside-source' });
    pointer.preventDefault?.();
    pointer.stopPropagation?.();
    if (fallbackPosition !== null) this.editorPort.setSelection(fallbackPosition);
    else this.editorPort.blur();
    this.recordClose({
      trigger: 'pointer-outside-source',
      sourceFrom: range.from,
      sourceTo: range.to,
      fallbackPosition,
      immediate: true
    });
    this.#scheduleDeferredGeometry('source-closed-immediate');
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.#clearLocalRange();
    this.#invalidateDeferredGeometry();
    this.editorPort = null;
    this.session = null;
    this.scheduleGeometry = () => {};
    this.recordClose = () => {};
  }

  #clearLocalRange() {
    this.activeRange = null;
    this.unregisterCloser();
    this.unregisterCloser = () => {};
  }

  #invalidateDeferredGeometry() {
    this.geometryGeneration += 1;
  }

  #scheduleDeferredGeometry(reason) {
    const generation = ++this.geometryGeneration;
    this.requestFrame(() => {
      if (this.destroyed || generation !== this.geometryGeneration) return;
      this.scheduleGeometry(reason);
    });
  }

  #assertAlive() {
    if (this.destroyed) throw new Error('HybridSourceEditController is destroyed');
  }
}

export function createHybridSourceEditController(options = {}) {
  return new HybridSourceEditController(options);
}
