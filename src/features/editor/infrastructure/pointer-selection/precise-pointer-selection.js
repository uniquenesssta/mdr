import { telemetry } from '../../../telemetry/index.js';
/**
 * Responsibility: Orchestrate precise CodeMirror pointer-selection sessions from sibling geometry readers and pure selection policies.
 * Imports: CodeMirror selection/view/language primitives and sibling pointer-selection modules; no document/session/persistence or UI feature state.
 * Exports: Pointer resolution/selection, deferred paragraph input capabilities and the per-view line diagnostic recorder.
 * State/side effects: One CodeMirror paragraph intent, a composition-completion timer, correction timestamps and one content-free correlation per DEV view.
 * Lifecycle: CodeMirror owns selection/input state and plugins; destroy cancels the composition timer and discards diagnostics.
 */
import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, ViewPlugin } from '@codemirror/view';
import {
  clampDocumentPosition,
  findBestPositionNear,
  measurePointerDistance,
  readDragBoundaryContext,
  readNativeCaretPosition,
  readPositionRect,
  readPointerLineContext,
  readSourceLineRect,
  readTargetLine
} from './caret-boundary-reader.js';
import {
  applyDragBoundaryPolicy,
  rangeForPointerClick,
  removeRangeAroundPosition,
  shouldCorrectPointerPosition
} from './pointer-selection-policy.js';

const lastCorrectionLogAt = new WeakMap();
let pointerSessionSequence = 0;

const setParagraphIntent = StateEffect.define();
const materializedParagraph = Annotation.define();
const paragraphIntent = StateField.define({
  create: () => null,
  update(value, transaction) {
    if (transaction.reconfigured || transaction.state.readOnly) return null;
    if (transaction.docChanged) {
      if (!value || transaction.annotation(materializedParagraph) || !transaction.isUserEvent('input.type.compose')) return null;
      const from = value.composition?.from ?? value.position, to = value.composition?.to ?? from;
      let contained = true;
      transaction.changes.iterChangedRanges((start, end) => { if (start < from || end > to) contained = false; });
      return contained ? { ...value, composition: {
        from: transaction.changes.mapPos(from, -1), to: transaction.changes.mapPos(to, 1)
      } } : null;
    }
    for (const effect of transaction.effects) if (effect.is(setParagraphIntent)) value = effect.value;
    const selection = transaction.newSelection.main;
    return value && selection.empty && (value.composition
      ? selection.head >= value.composition.from && selection.head <= value.composition.to
      : selection.head === value.position) ? value : null;
  }
});

/** Move committed IME text only after the native composition range has closed. */
export function completeHybridParagraphComposition(view) {
  const intent = view.state.field(paragraphIntent, false);
  if (!intent?.composition || view.composing || view.state.readOnly) return false;
  if (intent.composition.from === intent.composition.to) {
    view.dispatch({ effects: setParagraphIntent.of(null) });
    return false;
  }
  const offset = intent.anchor - intent.changes.from;
  const changes = ChangeSet.of([
    { from: intent.composition.from, insert: intent.changes.insert.slice(0, offset) },
    { from: intent.composition.to, insert: intent.changes.insert.slice(offset) }
  ], view.state.doc.length);
  view.dispatch({ changes, selection: view.state.selection.map(changes),
    annotations: materializedParagraph.of(true), userEvent: 'input.type.compose' });
  return true;
}

const paragraphCompositionPlugin = ViewPlugin.define(view => {
  let timer = 0, destroyed = false, eager = null;
  return {
    start() {
      const intent = view.state.field(paragraphIntent, false);
      if (!intent?.beforeComposition || view.state.readOnly) return;
      // A rendered widget must stay mounted when native composition starts.
      // Materialize its append row before the first composed text enters it.
      view.dispatch({ changes: intent.changes, selection: { anchor: intent.anchor },
        annotations: materializedParagraph.of(true), userEvent: 'input.type.compose' });
      eager = { token: intent.token, doc: view.state.doc, changes: intent.changes };
      view.focus();
    },
    finish() {
      const token = view.state.field(paragraphIntent, false)?.token || eager?.token;
      if (!token) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        if (destroyed || view.composing) return;
        if (eager?.token === token) {
          const previous = eager;
          eager = null;
          // Cancelled composition has returned to the separator-only document.
          // Drop those separators too, joining the same composition undo item.
          if (view.state.doc.eq(previous.doc) && !view.state.readOnly) {
            const changes = ChangeSet.of({ from: previous.changes.from,
              to: previous.changes.from + previous.changes.insert.length, insert: '' }, view.state.doc.length);
            view.dispatch({ changes, selection: view.state.selection.map(changes),
              annotations: materializedParagraph.of(true), userEvent: 'input.type.compose' });
          }
        } else if (view.state.field(paragraphIntent, false)?.token === token) completeHybridParagraphComposition(view);
      }, 0);
    },
    destroy() { destroyed = true; clearTimeout(timer); timer = 0; eager = null; }
  };
}, { eventHandlers: { compositionstart() { this.start(); return false; } },
  eventObservers: { compositionend() { this.finish(); }, blur() { this.finish(); } } });

/** A click stages an insertion intent; only an actual input transaction writes separators. */
export const hybridParagraphInputExtension = [paragraphIntent, EditorState.transactionFilter.of(transaction => {
  const intent = transaction.startState.field(paragraphIntent, false);
  if (!intent || transaction.annotation(materializedParagraph) || transaction.startState.readOnly
    || transaction.isUserEvent('input.type.compose') || !transaction.isUserEvent('input') || !transaction.docChanged) return transaction;
  let insertions = 0, atIntent = false;
  transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    insertions += 1;
    atIntent = from === intent.position && to === from && inserted.length > 0;
  });
  if (insertions !== 1 || !atIntent) return transaction;
  const offset = intent.anchor - intent.changes.from;
  const prefix = intent.changes.insert.slice(0, offset), suffix = intent.changes.insert.slice(offset);
  const changes = [];
  if (prefix) changes.push({ from: transaction.changes.mapPos(intent.position, -1), insert: prefix });
  if (suffix) changes.push({ from: transaction.changes.mapPos(intent.position, 1), insert: suffix });
  const extra = ChangeSet.of(changes, transaction.newDoc.length);
  return [transaction, { changes: extra, selection: transaction.newSelection.map(extra),
    annotations: materializedParagraph.of(true), sequential: true }];
}), paragraphCompositionPlugin];

/** Select an existing source position without changing the document or undo history. */
export function prepareHybridParagraphSelection(position, paragraph = null) {
  const anchor = paragraph?.changes ? paragraph.changes.from : position;
  return { anchor, effects: setParagraphIntent.of(paragraph?.changes ? { ...paragraph, position: anchor, token: {} } : null) };
}

/** Preserve a semantic separator when its blank row becomes a new paragraph. */
export function getHybridParagraphBoundary(view, position, previousBlockType = '') {
  if (view.state.readOnly || !view.dom?.classList?.contains('cm-hybrid-mode')) return null;
  const doc = view.state.doc, line = doc.lineAt(position);
  if (line.length || line.number === 1) return null;
  const previous = doc.line(line.number - 1);
  if (!previous.length) return null;
  let boundary = ['table', 'image', 'math', 'html'].includes(previousBlockType);
  let node = syntaxTree(view.state).resolveInner(previous.to, -1);
  while (node) {
    if (['Blockquote', 'ListItem', 'Table', 'HTMLBlock', 'Image'].includes(node.name)
      && node.to <= line.from) {
      boundary = true;
      break;
    }
    node = node.parent;
  }
  if (!boundary) return null;
  if (line.number < doc.lines && !doc.line(line.number + 1).length) {
    const next = doc.line(line.number + 1);
    const needsFollowingSeparator = next.number < doc.lines && doc.line(next.number + 1).length;
    return { anchor: next.from, ...(needsFollowingSeparator ? { changes: { from: next.to, insert: '\n' } } : {}) };
  }
  const insert = '\n' + (line.number < doc.lines && doc.line(line.number + 1).length ? '\n' : '');
  return { changes: { from: line.from, insert }, anchor: line.from + 1 };
}

/** Per-view, content-free correlation of a real pointer gesture and later input. */
export function createPointerLineDiagnostics(view, record = telemetry.record) {
  const pointerSessionId = ++pointerSessionSequence;
  let sequence = 0, pending = null, destroyed = false;
  const sourceLine = (doc, position) => doc.lineAt(clampDocumentPosition(position, 0, doc.length)).number;
  const selectionDetails = () => {
    const selection = view.state.selection.main;
    return { caretLine: sourceLine(view.state.doc, selection.head),
      anchorLine: sourceLine(view.state.doc, selection.anchor),
      caretPosition: selection.head, selectionEmpty: selection.empty };
  };
  return {
    pointerDown(event, context) {
      pending = null;
      if (destroyed || event.button !== 0) return;
      context ??= readPointerLineContext(view, event);
      if (!context) return;
      pending = { ...context, pointerSessionId, clickId: ++sequence, dragging: false, completed: false };
    },
    pointerUp(event) {
      if (destroyed || !pending || pending.completed) return;
      pending.dragging = Math.hypot(event.clientX - pending.pointerX, event.clientY - pending.pointerY) > 4;
      pending.completed = true;
      const selection = selectionDetails();
      const lineMismatch = !pending.dragging && selection.selectionEmpty
        && selection.caretLine !== pending.expectedLine;
      if (!lineMismatch) pending.expectedPosition = selection.caretPosition;
      const caretRect = readPositionRect(view, selection.caretPosition, view.state.selection.main.assoc);
      const verticalError = measurePointerDistance(caretRect, pending.pointerX, pending.pointerY).dy;
      const geometryUnavailable = !Number.isFinite(verticalError);
      const tolerance = Math.max(2, (view.defaultLineHeight || 16) * 0.3);
      const row = readSourceLineRect(view, pending.expectedPosition);
      const layoutChanged = Boolean(row && (Math.abs(row.top - pending.targetTop) > tolerance
        || Math.abs(row.bottom - pending.targetBottom) > tolerance));
      const oldHeight = pending.targetBottom - pending.targetTop;
      const canProject = layoutChanged && oldHeight > 0
        && pending.pointerY >= pending.targetTop && pending.pointerY <= pending.targetBottom;
      const postLayoutY = canProject
        ? row.top + (pending.pointerY - pending.targetTop) / oldHeight * row.height : pending.pointerY;
      const postLayoutError = measurePointerDistance(caretRect, pending.pointerX, postLayoutY).dy;
      const geometryMismatch = !pending.dragging && selection.selectionEmpty && Number.isFinite(verticalError)
        && postLayoutError > tolerance;
      record('editor.pointer-line-check', { category: 'editor.input',
        status: lineMismatch || geometryMismatch || geometryUnavailable ? 'warning' : 'ok',
        details: { ...pending, ...selection, lineMismatch,
          caretTop: caretRect?.top ?? null, caretBottom: caretRect?.bottom ?? null,
          verticalErrorPx: Number.isFinite(verticalError) ? verticalError : null, geometryMismatch, geometryUnavailable,
          layoutChanged, currentTargetTop: row?.top ?? null, currentTargetBottom: row?.bottom ?? null,
          postLayoutVerticalErrorPx: Number.isFinite(postLayoutError) ? postLayoutError : null,
          hybridMode: view.dom.classList.contains('cm-hybrid-mode') } });
      if (pending.dragging || !selection.selectionEmpty) pending = null;
    },
    keyDown(event) {
      // Keyboard navigation starts a new intent; subsequent typing must not be
      // attributed to an earlier click. Editing/IME/paste keep the correlation.
      if (/^(?:Arrow|Home$|End$|PageUp$|PageDown$)/.test(event.key)) pending = null;
    },
    update(update) {
      if (destroyed || !pending) return;
      if (update.transactions.some(transaction => transaction.isUserEvent('select.pointer.normalized')
        || transaction.isUserEvent('input.pointer.paragraph'))) {
        pending.expectedPosition = update.state.selection.main.head;
        pending.expectedLine = sourceLine(update.state.doc, pending.expectedPosition);
        pending.selectionNormalized = true;
        return;
      }
      const input = update.transactions.some(transaction => transaction.isUserEvent('input'));
      const createdParagraph = update.transactions.some(transaction => transaction.annotation(materializedParagraph));
      if (createdParagraph) {
        pending.expectedLine = sourceLine(update.state.doc, update.state.selection.main.head);
        pending.selectionNormalized = true;
      }
      if (update.docChanged && input && pending.completed) {
        const expectedInputLine = sourceLine(update.startState.doc, pending.expectedPosition);
        let inputStartLine = null, inputEndLine = null;
        update.changes.iterChangedRanges((from, to) => {
          inputStartLine ??= sourceLine(update.startState.doc, from);
          inputEndLine = sourceLine(update.startState.doc, to);
        });
        const lineMismatch = inputStartLine !== expectedInputLine;
        record('editor.input-line-check', { category: 'editor.input',
          status: lineMismatch ? 'warning' : 'ok', details: {
            pointerSessionId, clickId: pending.clickId, mappedLine: pending.mappedLine,
            expectedLine: pending.expectedLine, expectedInputLine,
            inputStartLine, inputEndLine, ...selectionDetails(), lineMismatch,
            trailingBlockBoundary: pending.trailingBlockBoundary, tableBoundary: pending.tableBoundary,
            ...(createdParagraph ? { selectionNormalized: true } : {})
          } });
      }
      if (createdParagraph) pending.expectedPosition = update.state.selection.main.head;
      else if (update.docChanged) pending.expectedPosition = update.changes.mapPos(pending.expectedPosition, 1);
      else if (pending.completed && update.selectionSet) pending = null;
    },
    destroy() { destroyed = true; pending = null; }
  };
}

const pointerLineDiagnosticsPlugin = /* @__PURE__ */ ViewPlugin.define(view => createPointerLineDiagnostics(view), {
  eventObservers: {
    mousedown(event) { this.pointerDown(event); },
    mouseup(event) { this.pointerUp(event); },
    keydown(event) { this.keyDown(event); }
  }
});

function recordCorrection(view, details) {
  const now = performance.now();
  const previous = lastCorrectionLogAt.get(view) || 0;
  if (now - previous < 750) return;
  lastCorrectionLogAt.set(view, now);
  telemetry.diagnostic?.('editor.pointer-position-corrected', {
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
  if (Number.isInteger(targetLine.boundaryPosition)) return { pos: targetLine.boundaryPosition, assoc: 1 };

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
  const selectionStyle = EditorView.mouseSelectionStyle.of((view, startEvent) => {
    if (startEvent.button !== 0) return null;
    let targetLine = readTargetLine(view, startEvent);
    if (!targetLine) return null;
    const plainClick = !view.state.readOnly && !startEvent.shiftKey
      && !startEvent.altKey && !startEvent.ctrlKey && !startEvent.metaKey && (startEvent.detail || 1) === 1;
    let paragraph = null;
    if (targetLine.needsTrailingLine && plainClick) {
      const insert = targetLine.paragraphBoundary && targetLine.mappedLine.to > targetLine.mappedLine.from ? '\n\n' : '\n';
      paragraph = { changes: { from: view.state.doc.length, insert }, anchor: view.state.doc.length + insert.length,
        beforeComposition: true };
    } else if (plainClick) {
      paragraph = getHybridParagraphBoundary(view, targetLine.line.from, targetLine.previousBlockType);
      const belowEnd = view.dom.classList.contains('cm-hybrid-mode')
        && targetLine.line.number === view.state.doc.lines && startEvent.clientY > targetLine.rect.bottom;
      if (!paragraph && belowEnd && targetLine.line.length) {
        let node = syntaxTree(view.state).resolveInner(view.state.doc.length, -1), openFence = false;
        while (node) {
          if (node.name === 'FencedCode' && node.getChildren('CodeMark').length < 2) openFence = true;
          node = node.parent;
        }
        if (!openFence) paragraph = { changes: { from: view.state.doc.length, insert: '\n\n' }, anchor: view.state.doc.length + 2 };
      }
    }
    if (paragraph) {
      if (targetLine.previousBlockType) paragraph.beforeComposition = true;
      const prepared = prepareHybridParagraphSelection(paragraph.anchor, paragraph);
      view.dispatch({ selection: { anchor: prepared.anchor }, effects: prepared.effects, userEvent: 'select.pointer.normalized' });
      targetLine = { ...targetLine, line: view.state.doc.lineAt(prepared.anchor), boundaryPosition: prepared.anchor };
    } else if (view.state.field(paragraphIntent, false)) {
      view.dispatch({ effects: setParagraphIntent.of(null) });
    }

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
        let current = currentEvent === startEvent ? start : resolvePrecisePointerPosition(view, currentEvent);
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
  return [hybridParagraphInputExtension, selectionStyle, ...(import.meta.env?.DEV ? [pointerLineDiagnosticsPlugin] : [])];
}
