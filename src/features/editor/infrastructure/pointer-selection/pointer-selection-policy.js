/**
 * Responsibility: Provide deterministic pointer correction, drag-boundary, click-range and multi-range selection policy independent of DOM reads.
 * Imports: May import EditorSelection only; must not import DOM, feature state, document/session or persistence modules.
 * Exports: shouldCorrectPointerPosition, applyDragBoundaryPolicy, rangeForPointerClick and removeRangeAroundPosition.
 * State/side effects: None; all results derive from explicit inputs.
 * Lifecycle: Pure module; no start/destroy lifecycle.
 */
import { EditorSelection } from '@codemirror/state';

export function shouldCorrectPointerPosition({
  targetLineNumber,
  fallbackLineNumber,
  nativeLineNumber,
  distanceScore,
  verticalErrorPx,
  verticalTolerance
}) {
  return fallbackLineNumber !== targetLineNumber
    || (nativeLineNumber !== null && nativeLineNumber !== targetLineNumber)
    || !Number.isFinite(distanceScore)
    || verticalErrorPx > verticalTolerance;
}

export function applyDragBoundaryPolicy(current, context) {
  if (!context) return current;
  const {
    startLineNumber,
    currentLineNumber,
    pointerY,
    targetTop,
    targetBottom,
    rowHeight,
    previousLineEnd,
    nextLineFrom
  } = context;

  if (currentLineNumber > startLineNumber
    && Number.isInteger(previousLineEnd)
    && pointerY < targetTop + rowHeight * 0.62) {
    return { pos: previousLineEnd, assoc: 1 };
  }
  if (currentLineNumber < startLineNumber
    && Number.isInteger(nextLineFrom)
    && pointerY > targetBottom - rowHeight * 0.62) {
    return { pos: nextLineFrom, assoc: -1 };
  }
  return current;
}

export function rangeForPointerClick(state, position, assoc, clickType) {
  if (clickType === 1) return EditorSelection.cursor(position, assoc);
  if (clickType === 2) return state.wordAt(position) || EditorSelection.cursor(position, assoc);
  const line = state.doc.lineAt(position);
  const to = line.to < state.doc.length ? line.to + 1 : line.to;
  return EditorSelection.undirectionalRange(line.from, to);
}

export function removeRangeAroundPosition(selection, position) {
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
