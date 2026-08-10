import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
  findBestPositionNear,
  measurePointerDistance,
  readNativeCaretPosition
} from '../../../src/features/editor/infrastructure/pointer-selection/caret-boundary-reader.js';
import {
  applyDragBoundaryPolicy,
  rangeForPointerClick,
  removeRangeAroundPosition,
  shouldCorrectPointerPosition
} from '../../../src/features/editor/infrastructure/pointer-selection/pointer-selection-policy.js';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

function correctionInput(overrides = {}) {
  return {
    targetLineNumber: 12,
    fallbackLineNumber: 12,
    nativeLineNumber: 12,
    distanceScore: 0,
    verticalErrorPx: 0,
    verticalTolerance: 4.8,
    ...overrides
  };
}

test('Atomic 5.7 correction policy preserves same-line positions inside vertical tolerance', () => {
  assert.equal(shouldCorrectPointerPosition(correctionInput()), false);
  assert.equal(shouldCorrectPointerPosition(correctionInput({ nativeLineNumber: null })), false);
});

test('Atomic 5.7 correction policy reacts to fallback/native line drift, invalid geometry and vertical error', () => {
  assert.equal(shouldCorrectPointerPosition(correctionInput({ fallbackLineNumber: 13 })), true);
  assert.equal(shouldCorrectPointerPosition(correctionInput({ nativeLineNumber: 11 })), true);
  assert.equal(shouldCorrectPointerPosition(correctionInput({ distanceScore: Number.POSITIVE_INFINITY })), true);
  assert.equal(shouldCorrectPointerPosition(correctionInput({ verticalErrorPx: 4.81 })), true);
});

test('Atomic 5.7 drag-boundary policy preserves the existing downward and upward row thresholds', () => {
  const current = { pos: 24, assoc: 1 };
  const base = {
    startLineNumber: 4,
    currentLineNumber: 5,
    pointerY: 108,
    targetTop: 100,
    targetBottom: 120,
    rowHeight: 16,
    previousLineEnd: 19,
    nextLineFrom: 30
  };
  assert.deepEqual(applyDragBoundaryPolicy(current, base), { pos: 19, assoc: 1 });
  assert.equal(applyDragBoundaryPolicy(current, { ...base, pointerY: 114 }), current);
  assert.deepEqual(applyDragBoundaryPolicy(current, {
    ...base,
    startLineNumber: 6,
    currentLineNumber: 5,
    pointerY: 116
  }), { pos: 30, assoc: -1 });
});

test('Atomic 5.7 click policy preserves cursor, word and whole-line selection semantics', () => {
  const state = EditorState.create({ doc: 'alpha beta\nnext' });
  const cursor = rangeForPointerClick(state, 2, 1, 1);
  assert.deepEqual({ from: cursor.from, to: cursor.to }, { from: 2, to: 2 });
  const word = rangeForPointerClick(state, 2, 1, 2);
  assert.deepEqual({ from: word.from, to: word.to }, { from: 0, to: 5 });
  const line = rangeForPointerClick(state, 2, 1, 3);
  assert.deepEqual({ from: line.from, to: line.to }, { from: 0, to: 11 });
});

test('Atomic 5.7 multi-range removal preserves main-range indexing and refuses to erase the final range', () => {
  const multi = EditorSelection.create([
    EditorSelection.range(0, 2),
    EditorSelection.range(4, 6)
  ], 1);
  const removed = removeRangeAroundPosition(multi, 5);
  assert.ok(removed);
  assert.equal(removed.ranges.length, 1);
  assert.deepEqual({ from: removed.main.from, to: removed.main.to }, { from: 0, to: 2 });
  assert.equal(removeRangeAroundPosition(EditorSelection.single(3), 3), null);
  assert.equal(removeRangeAroundPosition(multi, 3), null);
});

test('Atomic 5.7 caret reader chooses the closest CodeMirror position inside the bounded line search', () => {
  const view = {
    state: { doc: { length: 8 } },
    coordsAtPos(position) {
      const x = position * 10;
      return { left: x, right: x, top: 0, bottom: 10, height: 10 };
    }
  };
  const best = findBestPositionNear(view, { from: 0, to: 5 }, 2, { clientX: 31, clientY: 5 });
  assert.equal(best.pos, 3);
  assert.equal(best.assoc, -1);
  assert.deepEqual(measurePointerDistance(best.rect, 31, 5), { dx: 1, dy: 0, score: 1 });
});

test('Atomic 5.7 caret reader prefers the standard caret API and maps it through CodeMirror', () => {
  const node = {};
  const documentRoot = {
    caretPositionFromPoint() { return { offsetNode: node, offset: 2 }; },
    caretRangeFromPoint() { throw new Error('legacy API should not run'); }
  };
  const view = {
    dom: { ownerDocument: documentRoot },
    contentDOM: { contains(candidate) { return candidate === node; } },
    posAtDOM(candidate, offset) {
      assert.equal(candidate, node);
      assert.equal(offset, 2);
      return 17;
    }
  };
  assert.equal(readNativeCaretPosition(view, { clientX: 10, clientY: 20 }), 17);
});

test('Atomic 5.7 production integration directoryizes pointer selection and leaves Extension Registry as the sole assembler', () => {
  const oldPath = path.join(repositoryRoot, 'src/editor/precise-pointer-selection.js');
  const pointerRoot = path.join(repositoryRoot, 'src/features/editor/infrastructure/pointer-selection');
  assert.equal(fs.existsSync(oldPath), false);
  assert.deepEqual(
    fs.readdirSync(pointerRoot).filter(name => name.endsWith('.js')).sort(),
    ['caret-boundary-reader.js', 'pointer-selection-policy.js', 'precise-pointer-selection.js']
  );

  const precise = fs.readFileSync(path.join(pointerRoot, 'precise-pointer-selection.js'), 'utf8');
  const reader = fs.readFileSync(path.join(pointerRoot, 'caret-boundary-reader.js'), 'utf8');
  const policy = fs.readFileSync(path.join(pointerRoot, 'pointer-selection-policy.js'), 'utf8');
  const registry = fs.readFileSync(path.join(repositoryRoot, 'src/features/editor/infrastructure/codemirror-extension-registry.js'), 'utf8');

  assert.match(precise, /from '\.\/caret-boundary-reader\.js'/);
  assert.match(precise, /from '\.\/pointer-selection-policy\.js'/);
  assert.doesNotMatch(reader, /EditorSelection|mouseSelectionStyle|markdownEditorPerf/);
  assert.doesNotMatch(policy, /ownerDocument|elementsFromPoint|caretPositionFromPoint|markdownEditorPerf/);
  assert.match(registry, /from '\.\/pointer-selection\/precise-pointer-selection\.js'/);
  assert.equal((registry.match(/createPrecisePointerSelectionExtension\(\)/g) || []).length, 1);
  for (const source of [precise, reader, policy]) {
    assert.doesNotMatch(source, /src\/document|features\/documents|localStorage|window\.markdownEditorDocument/);
  }
});
