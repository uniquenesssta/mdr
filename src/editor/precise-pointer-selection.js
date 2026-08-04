import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

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

const lastCorrectionLogAt = new WeakMap();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function getLineRecord(view, element) {
  if (!element || !view.contentDOM.contains(element)) return null;
  try {
    const domPosition = view.posAtDOM(element, 0);
    const line = view.state.doc.lineAt(clamp(domPosition, 0, view.state.doc.length));
    return { element, line, rect: element.getBoundingClientRect() };
  } catch (_) {
    return null;
  }
}

function getTargetLine(view, event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(POINTER_EXCLUSION_SELECTOR)) return null;

  const documentRoot = view.dom.ownerDocument;
  const pointElements = documentRoot.elementsFromPoint?.(event.clientX, event.clientY) || [];
  for (const pointElement of pointElements) {
    const element = pointElement instanceof Element ? pointElement.closest('.cm-line') : null;
    const record = getLineRecord(view, element);
    if (record) return record;
  }

  // Pointer capture may keep event.target on the line where dragging started.
  // Resolve the current visual line from geometry instead of trusting that
  // stale target, especially when the pointer is over the blank right side.
  let best = null;
  for (const element of view.contentDOM.querySelectorAll('.cm-line')) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom < view.scrollDOM.getBoundingClientRect().top
      || rect.top > view.scrollDOM.getBoundingClientRect().bottom) continue;
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
    if (!best || score < best.score) best = { element, rect, score };
  }
  return best ? getLineRecord(view, best.element) : null;
}

function getNativeCaretPoint(view, event) {
  const documentRoot = view.dom.ownerDocument;
  try {
    const caret = documentRoot.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (caret?.offsetNode && view.contentDOM.contains(caret.offsetNode)) {
      return { node: caret.offsetNode, offset: caret.offset };
    }
  } catch (_) {
    // Fall through to the legacy WebKit API.
  }
  try {
    const range = documentRoot.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range?.startContainer && view.contentDOM.contains(range.startContainer)) {
      return { node: range.startContainer, offset: range.startOffset };
    }
  } catch (_) {
    // The CodeMirror coordinate resolver remains the final fallback.
  }
  return null;
}

function getPositionRect(view, position, assoc = 1) {
  try {
    return view.coordsAtPos(clamp(position, 0, view.state.doc.length), assoc) || null;
  } catch (_) {
    return null;
  }
}

function distanceToRect(rect, x, y) {
  if (!rect) return Number.POSITIVE_INFINITY;
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return { dx, dy, score: dy * 4096 + dx };
}

function bestPositionNear(view, line, seed, event) {
  const length = line.to - line.from;
  if (length <= 0) return { pos: line.from, assoc: 1, rect: getPositionRect(view, line.from, 1) };

  const radius = length <= 2048 ? Math.min(length, 384) : 192;
  const start = Math.max(line.from, seed - radius);
  const end = Math.min(line.to, seed + radius);
  let best = null;

  for (let position = start; position <= end; position += 1) {
    for (const assoc of [-1, 1]) {
      const rect = getPositionRect(view, position, assoc);
      const distance = distanceToRect(rect, event.clientX, event.clientY);
      if (!Number.isFinite(distance.score)) continue;
      if (!best || distance.score < best.score) {
        best = { pos: position, assoc, rect, ...distance };
      }
    }
  }
  return best || { pos: clamp(seed, line.from, line.to), assoc: 1, rect: null };
}

function recordCorrection(view, details) {
  const now = performance.now();
  const previous = lastCorrectionLogAt.get(view) || 0;
  if (now - previous < 750) return;
  lastCorrectionLogAt.set(view, now);
  globalThis.window?.markdownEditorPerf?.diagnostic?.('editor.pointer-position-corrected', {
    category: 'editor.input',
    status: 'warning',
    dedupeKey: `pointer-position:${details.targetLine}:${details.fallbackLine}:${details.nativeLine}`,
    minIntervalMs: 1200,
    details
  });
}

export function resolvePrecisePointerPosition(view, event, targetLine = getTargetLine(view, event)) {
  const fallback = view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
  if (!targetLine) return fallback;

  const { line } = targetLine;
  let nativePosition = null;
  const caret = getNativeCaretPoint(view, event);
  if (caret) {
    try {
      nativePosition = view.posAtDOM(caret.node, caret.offset);
    } catch (_) {
      nativePosition = null;
    }
  }

  const fallbackLine = view.state.doc.lineAt(clamp(fallback.pos, 0, view.state.doc.length));
  const nativeLine = Number.isInteger(nativePosition)
    ? view.state.doc.lineAt(clamp(nativePosition, 0, view.state.doc.length))
    : null;
  let candidate = Number.isInteger(nativePosition)
    ? clamp(nativePosition, line.from, line.to)
    : clamp(fallback.pos, line.from, line.to);
  let assoc = fallback.assoc || 1;
  let rect = getPositionRect(view, candidate, assoc);
  let distance = distanceToRect(rect, event.clientX, event.clientY);
  const verticalTolerance = Math.max(2, (view.defaultLineHeight || 16) * 0.3);

  const mustCorrect = fallbackLine.number !== line.number
    || (nativeLine && nativeLine.number !== line.number)
    || !Number.isFinite(distance.score)
    || distance.dy > verticalTolerance;

  if (mustCorrect) {
    const originalCandidate = candidate;
    const originalAssoc = assoc;
    const corrected = bestPositionNear(view, line, candidate, event);
    candidate = corrected.pos;
    assoc = corrected.assoc;
    rect = corrected.rect;
    distance = distanceToRect(rect, event.clientX, event.clientY);
    const resolvedLine = view.state.doc.lineAt(candidate).number;
    const positionChanged = candidate !== originalCandidate || assoc !== originalAssoc;
    const lineChanged = fallbackLine.number !== line.number
      || (nativeLine && nativeLine.number !== line.number);
    if (positionChanged || lineChanged) {
      recordCorrection(view, {
        pointerX: Number(event.clientX.toFixed(1)),
        pointerY: Number(event.clientY.toFixed(1)),
        targetLine: line.number,
        fallbackLine: fallbackLine.number,
        nativeLine: nativeLine?.number ?? null,
        resolvedLine,
        fallbackPosition: fallback.pos,
        nativePosition,
        resolvedPosition: candidate,
        verticalErrorPx: Number((distance.dy || 0).toFixed(2)),
        horizontalErrorPx: Number((distance.dx || 0).toFixed(2))
      });
    }
  }

  return { pos: candidate, assoc };
}

function normalizeDragBoundary(view, event, start, current) {
  const startLine = view.state.doc.lineAt(clamp(start.pos, 0, view.state.doc.length));
  const currentLine = view.state.doc.lineAt(clamp(current.pos, 0, view.state.doc.length));
  if (startLine.number === currentLine.number) return current;

  const targetLine = getTargetLine(view, event);
  if (!targetLine || targetLine.line.number !== currentLine.number) return current;
  const rect = targetLine.rect;
  const caretRect = getPositionRect(view, currentLine.from, 1);
  const rowHeight = Math.max(8, Math.min(rect.height, caretRect?.height || view.defaultLineHeight || 16));

  if (currentLine.number > startLine.number
    && event.clientY < rect.top + rowHeight * 0.62) {
    const previousLine = view.state.doc.line(currentLine.number - 1);
    return { pos: previousLine.to, assoc: 1 };
  }
  if (currentLine.number < startLine.number
    && event.clientY > rect.bottom - rowHeight * 0.62) {
    const nextLine = view.state.doc.line(currentLine.number + 1);
    return { pos: nextLine.from, assoc: -1 };
  }
  return current;
}

function rangeForClick(state, position, assoc, clickType) {
  if (clickType === 1) return EditorSelection.cursor(position, assoc);
  if (clickType === 2) return state.wordAt(position) || EditorSelection.cursor(position, assoc);
  const line = state.doc.lineAt(position);
  const to = line.to < state.doc.length ? line.to + 1 : line.to;
  return EditorSelection.undirectionalRange(line.from, to);
}

function removeRangeAround(selection, position) {
  for (let index = 0; index < selection.ranges.length; index += 1) {
    const range = selection.ranges[index];
    if (range.from > position || range.to < position) continue;
    const ranges = selection.ranges.slice(0, index).concat(selection.ranges.slice(index + 1));
    if (!ranges.length) return null;
    const mainIndex = selection.mainIndex === index
      ? 0
      : selection.mainIndex - (selection.mainIndex > index ? 1 : 0);
    return EditorSelection.create(ranges, mainIndex);
  }
  return null;
}

export function createPrecisePointerSelectionExtension() {
  return EditorView.mouseSelectionStyle.of((view, startEvent) => {
    if (startEvent.button !== 0) return null;
    const targetLine = getTargetLine(view, startEvent);
    if (!targetLine) return null;

    let start = resolvePrecisePointerPosition(view, startEvent, targetLine);
    let startSelection = view.state.selection;
    const clickType = clamp(Math.floor(startEvent.detail) || 1, 1, 3);

    return {
      update(update) {
        if (!update.docChanged) return;
        start = {
          pos: update.changes.mapPos(start.pos),
          assoc: start.assoc
        };
        startSelection = startSelection.map(update.changes);
      },
      get(currentEvent, extend, multiple) {
        let current = resolvePrecisePointerPosition(view, currentEvent);
        if (clickType === 1 && start.pos !== current.pos) {
          current = normalizeDragBoundary(view, currentEvent, start, current);
        }
        let range = rangeForClick(view.state, current.pos, current.assoc, clickType);

        if (start.pos !== current.pos && !extend) {
          const startRange = rangeForClick(view.state, start.pos, start.assoc, clickType);
          const from = Math.min(startRange.from, range.from);
          const to = Math.max(startRange.to, range.to);
          range = from < range.from
            ? EditorSelection.range(from, to, range.assoc)
            : EditorSelection.range(to, from, range.assoc);
        }

        if (extend) {
          return startSelection.replaceRange(startSelection.main.extend(range.from, range.to, range.assoc));
        }
        if (multiple && clickType === 1 && startSelection.ranges.length > 1) {
          const removed = removeRangeAround(startSelection, current.pos);
          if (removed) return removed;
        }
        if (multiple) return startSelection.addRange(range);
        return EditorSelection.create([range]);
      }
    };
  });
}
