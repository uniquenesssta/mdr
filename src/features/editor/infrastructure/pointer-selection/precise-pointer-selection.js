/**
 * Responsibility: Orchestrate precise CodeMirror pointer-selection sessions from sibling geometry readers and pure selection policies.
 * Imports: May import CodeMirror selection/view primitives plus sibling pointer-selection modules; must not import document/session/persistence or UI feature state.
 * Exports: resolvePrecisePointerPosition and createPrecisePointerSelectionExtension.
 * State/side effects: Keeps only per-view diagnostic throttle timestamps in a WeakMap and emits the existing optional performance diagnostic; selection state remains owned by CodeMirror.
 * Lifecycle: CodeMirror owns each mouse-selection session lifecycle; this module creates extensions and holds no independent application lifecycle.
 */
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  clampDocumentPosition,
  findBestPositionNear,
  measurePointerDistance,
  readDragBoundaryContext,
  readNativeCaretPosition,
  readPositionRect,
  readTargetLine
} from './caret-boundary-reader.js';
import {
  applyDragBoundaryPolicy,
  rangeForPointerClick,
  removeRangeAroundPosition,
  shouldCorrectPointerPosition
} from './pointer-selection-policy.js';

const lastCorrectionLogAt = new WeakMap();

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

export function resolvePrecisePointerPosition(view, event, targetLine = readTargetLine(view, event)) {
  const fallback = view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
  if (!targetLine) return fallback;

  const { line } = targetLine;
  const nativePosition = readNativeCaretPosition(view, event);
  const fallbackLine = view.state.doc.lineAt(
    clampDocumentPosition(fallback.pos, 0, view.state.doc.length)
  );
  const nativeLine = Number.isInteger(nativePosition)
    ? view.state.doc.lineAt(clampDocumentPosition(nativePosition, 0, view.state.doc.length))
    : null;
  let candidate = Number.isInteger(nativePosition)
    ? clampDocumentPosition(nativePosition, line.from, line.to)
    : clampDocumentPosition(fallback.pos, line.from, line.to);
  let assoc = fallback.assoc || 1;
  let rect = readPositionRect(view, candidate, assoc);
  let distance = measurePointerDistance(rect, event.clientX, event.clientY);
  const verticalTolerance = Math.max(2, (view.defaultLineHeight || 16) * 0.3);

  const mustCorrect = shouldCorrectPointerPosition({
    targetLineNumber: line.number,
    fallbackLineNumber: fallbackLine.number,
    nativeLineNumber: nativeLine?.number ?? null,
    distanceScore: distance.score,
    verticalErrorPx: distance.dy,
    verticalTolerance
  });

  if (mustCorrect) {
    const originalCandidate = candidate;
    const originalAssoc = assoc;
    const corrected = findBestPositionNear(view, line, candidate, event);
    candidate = corrected.pos;
    assoc = corrected.assoc;
    rect = corrected.rect;
    distance = measurePointerDistance(rect, event.clientX, event.clientY);
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
  return applyDragBoundaryPolicy(
    current,
    readDragBoundaryContext(view, event, start, current)
  );
}

export function createPrecisePointerSelectionExtension() {
  return EditorView.mouseSelectionStyle.of((view, startEvent) => {
    if (startEvent.button !== 0) return null;
    const targetLine = readTargetLine(view, startEvent);
    if (!targetLine) return null;

    let start = resolvePrecisePointerPosition(view, startEvent, targetLine);
    let startSelection = view.state.selection;
    const clickType = clampDocumentPosition(Math.floor(startEvent.detail) || 1, 1, 3);

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
        let range = rangeForPointerClick(view.state, current.pos, current.assoc, clickType);

        if (start.pos !== current.pos && !extend) {
          const startRange = rangeForPointerClick(view.state, start.pos, start.assoc, clickType);
          const from = Math.min(startRange.from, range.from);
          const to = Math.max(startRange.to, range.to);
          range = from < range.from
            ? EditorSelection.range(from, to, range.assoc)
            : EditorSelection.range(to, from, range.assoc);
        }

        if (extend) {
          return startSelection.replaceRange(
            startSelection.main.extend(range.from, range.to, range.assoc)
          );
        }
        if (multiple && clickType === 1 && startSelection.ranges.length > 1) {
          const removed = removeRangeAroundPosition(startSelection, current.pos);
          if (removed) return removed;
        }
        if (multiple) return startSelection.addRange(range);
        return EditorSelection.create([range]);
      }
    };
  });
}
