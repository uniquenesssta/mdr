/**
 * Responsibility: Read CodeMirror/DOM caret, visible-line and pointer geometry needed to resolve document boundaries without owning selection policy.
 * Imports: No module imports; consumes only the injected CodeMirror view/event and their DOM APIs, never document/session/persistence state.
 * Exports: Caret/line geometry readers, including content-free rendered/source line diagnostic context.
 * State/side effects: No owned state; performs bounded DOM/CodeMirror geometry reads only.
 * Lifecycle: Pure-with-view helper module; no start/destroy lifecycle.
 */
const POINTER_EXCLUSION_SELECTOR = [
  '.cm-hybrid-block-widget',
  '.cm-hybrid-inline-math',
  '.cm-hybrid-prefix',
  '.cm-hybrid-horizontal-rule',
  'button',
  'a',
  'input',
  'textarea',
  'select'
].join(',');

export function clampDocumentPosition(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function isElement(view, value) {
  const ElementCtor = view?.dom?.ownerDocument?.defaultView?.Element || globalThis.Element;
  return typeof ElementCtor === 'function' && value instanceof ElementCtor;
}

function readLineRecord(view, element) {
  if (!element || !view.contentDOM.contains(element)) return null;
  try {
    const domPosition = view.posAtDOM(element, 0);
    if (!Number.isInteger(domPosition) || domPosition < 0 || domPosition > view.state.doc.length) return null;
    const mappedLine = view.state.doc.lineAt(domPosition);
    const previousBlock = element.previousElementSibling?.matches('.cm-hybrid-block-widget')
      ? element.previousElementSibling : null;
    const lineBlock = previousBlock ? view.lineBlockAt(domPosition) : null;
    const blocks = Array.isArray(lineBlock?.type) ? lineBlock.type : lineBlock ? [lineBlock] : [];
    const blockEnd = blocks.find(block => block.widget && block.to === domPosition)?.to;
    const trailingBlockBoundary = Boolean(previousBlock && !element.textContent
      && domPosition === blockEnd);
    const needsTrailingLine = trailingBlockBoundary && mappedLine.number === view.state.doc.lines;
    const line = trailingBlockBoundary && !needsTrailingLine ? view.state.doc.line(mappedLine.number + 1) : mappedLine;
    return { element, line, mappedLine, position: domPosition, needsTrailingLine, trailingBlockBoundary,
      previousBlockType: previousBlock?.dataset.hybridBlockType || '',
      paragraphBoundary: Boolean(previousBlock && ['table', 'image', 'math', 'html'].includes(previousBlock.dataset.hybridBlockType)),
      tableBoundary: trailingBlockBoundary && previousBlock.dataset.hybridBlockType === 'table',
      boundaryPosition: trailingBlockBoundary && !needsTrailingLine ? line.from : null,
      rect: element.getBoundingClientRect() };
  } catch (_) {
    return null;
  }
}

export function readTargetLine(view, event) {
  const target = isElement(view, event.target) ? event.target : null;
  if (target?.closest(POINTER_EXCLUSION_SELECTOR)) return null;

  const documentRoot = view.dom.ownerDocument;
  const pointElements = documentRoot.elementsFromPoint?.(event.clientX, event.clientY) || [];
  for (const pointElement of pointElements) {
    const element = isElement(view, pointElement) ? pointElement.closest('.cm-line') : null;
    const record = readLineRecord(view, element);
    if (record) return record;
  }

  // Pointer capture may keep event.target on the line where dragging started.
  // Resolve the current visual line from geometry instead of trusting that
  // stale target, especially when the pointer is over the blank right side.
  let best = null;
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  for (const element of view.contentDOM.querySelectorAll('.cm-line')) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) continue;
    const dy = event.clientY < rect.top
      ? rect.top - event.clientY
      : event.clientY > rect.bottom
        ? event.clientY - rect.bottom
        : 0;
    const dx = event.clientX < rect.left
      ? rect.left - event.clientX
      : event.clientX > rect.right
        ? event.clientX - rect.right
        : 0;
    const score = dy * 4096 + dx;
    if (!best || score < best.score) best = { element, score };
  }
  return best ? readLineRecord(view, best.element) : null;
}

/** Keep the rendered row separate from its source mapping at replaced block edges. */
export function readPointerLineContext(view, event) {
  const target = readTargetLine(view, event);
  if (!target) return null;
  const { element, line, mappedLine, rect, trailingBlockBoundary, tableBoundary, paragraphBoundary, needsTrailingLine } = target;
  const viewport = view.scrollDOM.getBoundingClientRect();
  const visibleLines = Array.from(view.contentDOM.querySelectorAll('.cm-line')).filter(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.height > 0 && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
  });
  return {
    pointerX: event.clientX, pointerY: event.clientY,
    renderedRow: visibleLines.indexOf(element) + 1,
    mappedLine: mappedLine.number, expectedLine: needsTrailingLine
      ? line.number + (paragraphBoundary && line.to > line.from ? 2 : 1) : line.number,
    expectedPosition: needsTrailingLine ? line.to : line.from,
    trailingBlockBoundary,
    tableBoundary,
    targetTop: rect.top, targetBottom: rect.bottom
  };
}

/** Read the same source row after a reveal/collapse has changed its geometry. */
export function readSourceLineRect(view, position) {
  const line = view.state.doc.lineAt(clampDocumentPosition(position, 0, view.state.doc.length));
  for (const element of view.contentDOM?.querySelectorAll?.('.cm-line') || []) {
    const record = readLineRecord(view, element);
    if (record?.line.from === line.from && record.rect.height > 0) return record.rect;
  }
  return null;
}

export function readNativeCaretPosition(view, event) {
  const documentRoot = view.dom.ownerDocument;
  try {
    const caret = documentRoot.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (caret?.offsetNode && view.contentDOM.contains(caret.offsetNode)) {
      return view.posAtDOM(caret.offsetNode, caret.offset);
    }
  } catch (_) {
    // Fall through to the legacy WebKit API.
  }
  try {
    const range = documentRoot.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range?.startContainer && view.contentDOM.contains(range.startContainer)) {
      return view.posAtDOM(range.startContainer, range.startOffset);
    }
  } catch (_) {
    // The CodeMirror coordinate resolver remains the final fallback.
  }
  return null;
}

export function readPositionRect(view, position, assoc = 1) {
  try {
    return view.coordsAtPos(
      clampDocumentPosition(position, 0, view.state.doc.length),
      assoc
    ) || null;
  } catch (_) {
    return null;
  }
}

export function measurePointerDistance(rect, x, y) {
  if (!rect) {
    return { dx: Number.POSITIVE_INFINITY, dy: Number.POSITIVE_INFINITY, score: Number.POSITIVE_INFINITY };
  }
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return { dx, dy, score: dy * 4096 + dx };
}

export function findBestPositionNear(view, line, seed, event) {
  const length = line.to - line.from;
  if (length <= 0) {
    return { pos: line.from, assoc: 1, rect: readPositionRect(view, line.from, 1) };
  }

  const radius = length <= 2048 ? Math.min(length, 384) : 192;
  const start = Math.max(line.from, seed - radius);
  const end = Math.min(line.to, seed + radius);
  let best = null;

  for (let position = start; position <= end; position += 1) {
    for (const assoc of [-1, 1]) {
      const rect = readPositionRect(view, position, assoc);
      const distance = measurePointerDistance(rect, event.clientX, event.clientY);
      if (!Number.isFinite(distance.score)) continue;
      if (!best || distance.score < best.score) {
        best = { pos: position, assoc, rect, ...distance };
      }
    }
  }
  return best || {
    pos: clampDocumentPosition(seed, line.from, line.to),
    assoc: 1,
    rect: null
  };
}

export function readDragBoundaryContext(view, event, start, current) {
  const startLine = view.state.doc.lineAt(
    clampDocumentPosition(start.pos, 0, view.state.doc.length)
  );
  const currentLine = view.state.doc.lineAt(
    clampDocumentPosition(current.pos, 0, view.state.doc.length)
  );
  if (startLine.number === currentLine.number) return null;

  const targetLine = readTargetLine(view, event);
  if (!targetLine || targetLine.line.number !== currentLine.number) return null;

  const rect = targetLine.rect;
  const caretRect = readPositionRect(view, currentLine.from, 1);
  const rowHeight = Math.max(
    8,
    Math.min(rect.height, caretRect?.height || view.defaultLineHeight || 16)
  );

  return {
    startLineNumber: startLine.number,
    currentLineNumber: currentLine.number,
    targetHasText: currentLine.length > 0,
    pointerY: event.clientY,
    targetTop: rect.top,
    targetBottom: rect.bottom,
    rowHeight,
    previousLineEnd: currentLine.number > 1
      ? view.state.doc.line(currentLine.number - 1).to
      : null,
    nextLineFrom: currentLine.number < view.state.doc.lines
      ? view.state.doc.line(currentLine.number + 1).from
      : null
  };
}
