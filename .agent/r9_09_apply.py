from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

BASELINE = '7bd768de832b700e4ec25a4a676c00f05fa38c8d'


def baseline_text(path: str) -> str:
    return subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], text=True)


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def restore(path: str) -> None:
    write(path, baseline_text(path))


def replace_once(path: str, old: str, new: str) -> None:
    text = Path(path).read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one marker, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def update_inventory() -> None:
    path = 'tests/architecture/fixtures/production-modules.json'
    data = json.loads(baseline_text(path))
    records = {record[0]: record for record in data['modules']}
    records['public/app/scroll-sync.js'][3] = (
        'Legacy bidirectional selection mapping compatibility and geometry-change producers; '
        'R9-08 feedback state and R9-09 highlight effects/lifecycle are delegated to canonical Sync owners.'
    )
    records['src/features/sync/index.js'][3] = (
        'Public Stage 9 Sync contract exposing scroll owners/mappers/geometry, R9-07 Selection Readers, '
        'R9-08 Feedback Guard and R9-09 Highlight Session while later Selection orchestration remains unmigrated.'
    )
    records['src/sync/selection-controller.js'][3] = (
        'Legacy selection synchronization orchestration consuming canonical Selection Readers, R9-08 Feedback Guard '
        'and R9-09 Highlight Session remount lifecycle while retry/mapping migration remains pending.'
    )
    new_record = [
        'src/features/sync/selection/selection-highlight-session.js',
        'esm-module',
        'sync-selection',
        'R9-09 preview selection highlight lifecycle owning CSS Highlight multi-Range presentation, atomic/text fallback effects, virtual-remount restoration intent and terminal cleanup without mapping or retry policy.',
        'selection-highlight-session-lifecycle',
        'explicit-instance',
        'retain',
        False,
    ]
    if new_record[0] in records:
        raise RuntimeError('R9-09 inventory record already exists in baseline')
    data['modules'].append(new_record)
    if len(data['modules']) != 380:
        raise RuntimeError(f'expected 380 production modules, got {len(data["modules"])}')
    write(path, json.dumps(data, ensure_ascii=False, separators=(',', ':')))


def update_historical_tests() -> None:
    paths = [
        'tests/stage-01-handoff.test.mjs',
        *sorted(str(path) for path in Path('tests/architecture').glob('stage-08*.test.mjs')),
        *sorted(str(path) for path in Path('tests/architecture').glob('stage-09-*.test.mjs')),
    ]
    for path in paths:
        if not Path(path).exists():
            continue
        try:
            text = baseline_text(path)
        except subprocess.CalledProcessError:
            continue
        text = text.replace("  'src/features/sync/selection/selection-highlight-session.js',\n", '')
        lines = []
        for line in text.splitlines(keepends=True):
            if '379' in line and ('modules.length' in line or 'inventory.modules.length' in line):
                line = line.replace('379', '380')
            lines.append(line)
        text = ''.join(lines)
        if path.endswith('stage-09-selection-feedback-guard.test.mjs'):
            text = text.replace('does not advance R9-09+', 'does not advance R9-10+')
            text = text.replace('cardinality 379', 'cardinality 380 after R9-09 inventory growth')
        write(path, text)


highlight_session = r'''/**
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
'''

behavior_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionHighlightSession } from '../src/features/sync/index.js';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.nodeType = ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.parentNode = null;
    this.children = [];
    this.classList = new FakeClassList();
    this.className = '';
    this.textContent = '';
  }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index < 0) throw new Error('missing child');
    previous.parentNode = null;
    next.parentNode = this;
    this.children.splice(index, 1, next);
  }
  normalize() {
    for (let index = 0; index < this.children.length - 1;) {
      const left = this.children[index];
      const right = this.children[index + 1];
      if (left.nodeType === TEXT_NODE && right.nodeType === TEXT_NODE) {
        left.nodeValue += right.nodeValue;
        this.children.splice(index + 1, 1);
        right.parentNode = null;
      } else index += 1;
    }
  }
}

class FakeText {
  constructor(value = '') {
    this.nodeType = TEXT_NODE;
    this.nodeValue = value;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  splitText(offset) {
    const safe = Math.max(0, Math.min(this.nodeValue.length, offset));
    const tail = new FakeText(this.nodeValue.slice(safe));
    this.nodeValue = this.nodeValue.slice(0, safe);
    const parent = this.parentNode;
    if (parent) {
      const index = parent.children.indexOf(this);
      tail.parentNode = parent;
      parent.children.splice(index + 1, 0, tail);
    }
    return tail;
  }
  replaceWith(next) {
    this.parentNode?.replaceChild(next, this);
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
  createTextNode(value) { return new FakeText(value); }
}

function createTree(text = 'abcdef') {
  const documentRef = new FakeDocument();
  const preview = new FakeElement('section');
  const block = preview.appendChild(new FakeElement('p'));
  const textNode = block.appendChild(new FakeText(text));
  return { documentRef, preview, block, textNode };
}

function range(node, start, end) {
  return { startContainer: node, endContainer: node, startOffset: start, endOffset: end };
}

function createRegistry() {
  const values = new Map();
  const deleted = [];
  return {
    values,
    deleted,
    set(name, value) { values.set(name, value); },
    delete(name) { deleted.push(name); return values.delete(name); }
  };
}

class FakeHighlight {
  constructor(...ranges) { this.ranges = ranges; }
}

test('R9-09 Highlight Session owns CSS Highlight multi-Range publication and exact range state', () => {
  const { documentRef, preview, textNode } = createTree();
  const second = preview.children[0].appendChild(new FakeText('ghij'));
  const registry = createRegistry();
  const firstRange = range(textNode, 1, 3);
  const secondRange = range(second, 0, 2);
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  assert.equal(session.show({ ranges: [firstRange, secondRange] }), true);
  assert.deepEqual(registry.values.get('preview-selection-sync').ranges, [firstRange, secondRange]);
  assert.deepEqual(session.getState(), { active: true, rangeCount: 2, atomicCount: 0, fallbackCount: 0, hasRestore: false, restoreCount: 0, destroyed: false });
  session.destroy();
});

test('R9-09 Highlight Session replaces old CSS ranges and atomic classes through one authority', () => {
  const { documentRef, preview, block, textNode } = createTree();
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  session.show({ ranges: [range(textNode, 0, 2)], atomicElements: [block] });
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), true);
  session.show({ ranges: [range(textNode, 2, 4)] });
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), false);
  assert.ok(registry.deleted.includes('preview-selection-sync'));
  assert.equal(session.getState().rangeCount, 1);
  session.destroy();
});

test('R9-09 Highlight Session provides the legacy single-text fallback when CSS Highlight is unavailable and clear restores text', () => {
  const { documentRef, preview, block, textNode } = createTree('abcdef');
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef });
  assert.equal(session.show({ ranges: [range(textNode, 1, 4)] }), true);
  assert.equal(block.children.length, 3);
  const mark = block.children[1];
  assert.equal(mark.className, 'preview-text-highlight');
  assert.equal(mark.textContent, 'bcd');
  session.clear();
  assert.equal(block.children.length, 1);
  assert.equal(block.children[0].nodeValue, 'abcdef');
  assert.deepEqual(session.getState(), { active: false, rangeCount: 0, atomicCount: 0, fallbackCount: 0, hasRestore: false, restoreCount: 0, destroyed: false });
  session.destroy();
});

test('R9-09 Highlight Session rejects unsupported multi-Range fallback and ranges outside preview without side effects', () => {
  const { documentRef, preview, textNode } = createTree();
  const outside = new FakeElement('div');
  const outsideText = outside.appendChild(new FakeText('outside'));
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef });
  assert.equal(session.canPresent({ ranges: [range(textNode, 0, 1), range(textNode, 2, 3)] }), false);
  assert.equal(session.show({ ranges: [range(textNode, 0, 1), range(textNode, 2, 3)] }), false);
  assert.equal(session.canPresent({ ranges: [range(outsideText, 0, 2)] }), false);
  assert.equal(session.show({ ranges: [range(outsideText, 0, 2)] }), false);
  assert.equal(session.getState().active, false);
  session.destroy();
});

test('R9-09 Highlight Session restores fresh ranges and atomic elements after virtual remount without retry scheduling', () => {
  const firstTree = createTree('first');
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: firstTree.preview, documentRef: firstTree.documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  const firstRange = range(firstTree.textNode, 0, 3);
  let mountedText = firstTree.textNode;
  let mountedBlock = firstTree.block;
  const restore = () => ({ ranges: [range(mountedText, 1, 4)], atomicElements: [mountedBlock] });
  session.show({ ranges: [firstRange] }, { restore });

  const freshBlock = new FakeElement('p');
  const freshText = freshBlock.appendChild(new FakeText('fresh'));
  firstTree.preview.children = [freshBlock];
  freshBlock.parentNode = firstTree.preview;
  firstTree.block.parentNode = null;
  mountedText = freshText;
  mountedBlock = freshBlock;

  assert.equal(session.restore(), true);
  const active = registry.values.get('preview-selection-sync');
  assert.equal(active.ranges[0].startContainer, freshText);
  assert.equal(freshBlock.classList.contains('preview-atomic-selection-highlight'), true);
  assert.equal(session.getState().restoreCount, 1);
  assert.equal(session.getState().hasRestore, true);
  session.destroy();
});

test('R9-09 Highlight Session reports restore exceptions keeps intent and permits a later remount recovery', () => {
  const { documentRef, preview, textNode } = createTree();
  const registry = createRegistry();
  const errors = [];
  let fail = true;
  const session = createSelectionHighlightSession({
    previewElement: preview,
    documentRef,
    highlightRegistry: registry,
    HighlightCtor: FakeHighlight,
    reportError: (message, error) => errors.push({ message, error })
  });
  const restore = () => {
    if (fail) throw new Error('remount failed');
    return { ranges: [range(textNode, 2, 4)] };
  };
  session.show({ ranges: [range(textNode, 0, 2)] }, { restore });
  assert.equal(session.restore(), false);
  assert.equal(errors.length, 1);
  assert.equal(session.getState().hasRestore, true);
  fail = false;
  assert.equal(session.restore(), true);
  session.destroy();
});

test('R9-09 Highlight Session clear removes CSS ranges atomic classes and remount intent', () => {
  const { documentRef, preview, block, textNode } = createTree();
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  session.show({ ranges: [range(textNode, 0, 2)], atomicElements: [block] }, { restore: () => ({ ranges: [range(textNode, 0, 2)] }) });
  session.clear();
  assert.equal(registry.values.has('preview-selection-sync'), false);
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), false);
  assert.equal(session.restore(), false);
  assert.equal(session.getState().hasRestore, false);
  session.destroy();
});

test('R9-09 Highlight Session destroy clears every effect and is terminal idempotent', () => {
  const { documentRef, preview, block, textNode } = createTree();
  const registry = createRegistry();
  const session = createSelectionHighlightSession({ previewElement: preview, documentRef, highlightRegistry: registry, HighlightCtor: FakeHighlight });
  session.show({ ranges: [range(textNode, 0, 2)], atomicElements: [block] }, { restore: () => ({ ranges: [range(textNode, 0, 2)] }) });
  session.destroy();
  session.destroy();
  assert.equal(registry.values.has('preview-selection-sync'), false);
  assert.equal(block.classList.contains('preview-atomic-selection-highlight'), false);
  assert.equal(session.getState().destroyed, true);
  assert.equal(session.getState().rangeCount, 0);
  assert.throws(() => session.show({ ranges: [] }), /destroyed/);
  assert.equal(session.restore(), false);
});
'''

architecture_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const LATER_SELECTION_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/selection-retry-scheduler.js'
];

test('R9-09 creates canonical SelectionHighlightSession and exports it only through the Sync public entry', async () => {
  const index = await read('src/features/sync/index.js');
  const session = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(index, /R9-09/);
  assert.match(session, /export class SelectionHighlightSession/);
  assert.match(session, /export function createSelectionHighlightSession/);
  assert.match(index, /\.\/selection\/selection-highlight-session\.js/);
});

test('R9-09 Highlight Session owns highlight effects/remount intent only and contains no mapping feedback retry scroll or event authority', async () => {
  const source = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(source, /HIGHLIGHT_NAME = 'preview-selection-sync'/);
  assert.match(source, /new this\.HighlightCtor\(\.\.\.ranges\)/);
  assert.match(source, /this\.restoreFactory/);
  assert.match(source, /clearEffects\(\)/);
  assert.doesNotMatch(source, /selectionMapping|markdownEditorDocumentModel|editor\.value|createPreviewRangesForSourceSelection|mapPreviewDomPointToSource|setTimeout|requestAnimationFrame|addEventListener|scrollTo|feedbackGuard|SelectionFeedbackGuard/);
});

test('R9-09 classic selection mapping only builds plans and delegates all CSS/class/text highlight effects to the scoped Session', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /markdownEditorSelectionHighlightSession/);
  assert.match(legacy, /selectionHighlightSession\.canPresent/);
  assert.match(legacy, /selectionHighlightSession\.show/);
  assert.match(legacy, /selectionHighlightSession\.clear\(\)/);
  assert.doesNotMatch(legacy, /CSS\.highlights|new Highlight\(|preview-atomic-selection-highlight|preview-text-highlight|preview-source-highlight/);
});

test('R9-09 preserves mapping builders and frozen selection mapping for R9-11 instead of moving algorithms into Highlight Session', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  const session = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(legacy, /highlightMappedSourceRangeInPreview/);
  assert.match(legacy, /createPreviewRangesForSourceSelection/);
  assert.match(legacy, /mapPreviewDomPointToSource/);
  assert.doesNotMatch(session, /createPreviewRangesForSourceSelection|mapPreviewDomPointToSource|buildNormalizedTextMap|normalizeSearchText/);
  const frozen = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(frozen, /R9-09/);
});

test('R9-09 composition creates one Session from preview-scoped DOM/CSS capabilities injects it and destroys it without a window highlight global', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createSelectionHighlightSession/);
  assert.match(main, /const selectionHighlightSession = createSelectionHighlightSession\(\{/);
  assert.match(main, /markdownEditorSelectionHighlightSession = selectionHighlightSession/);
  assert.match(main, /highlightSession: selectionHighlightSession/);
  assert.match(main, /selectionHighlightSession\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorSelectionHighlightSession/);
  assert.doesNotMatch(main, /\.\/features\/sync\/selection\/selection-highlight-session\.js/);
});

test('R9-09 virtual remount recovery is delegated by SelectionSyncController without Session-owned retry scheduling', async () => {
  const controller = await read('src/sync/selection-controller.js');
  const session = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(controller, /this\.highlightSession\.restore\(\)/);
  assert.match(controller, /notifyPreviewMounted/);
  assert.match(controller, /this\.highlightSession\.clear\(\)/);
  assert.doesNotMatch(session, /retry|MAX_RETRIES|setTimer|scheduleFrame/);
});

test('R9-09 keeps prior owners and frozen mapping untouched and does not advance R9-10+', async () => {
  await access(file('src/features/sync/selection/editor-selection-reader.js'));
  await access(file('src/features/sync/selection/preview-selection-reader.js'));
  await access(file('src/features/sync/selection/selection-feedback-guard.js'));
  await access(file('src/sync/selection-mapping.js'));
  for (const path of LATER_SELECTION_FILES) await assert.rejects(access(file(path)), path);
});

test('R9-09 production inventory records one Highlight Session responsibility and cardinality 380', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 380);
  assert.equal(records.get('src/features/sync/selection/selection-highlight-session.js')?.[4], 'selection-highlight-session-lifecycle');
});
'''

# Reset every candidate file to the validated R9-08 baseline so reruns are deterministic.
for candidate in [
    'src/features/sync/index.js',
    'src/main.js',
    'src/sync/selection-controller.js',
    'public/app/scroll-sync.js',
    'tests/architecture/fixtures/production-modules.json',
    'tests/stage-01-handoff.test.mjs',
]:
    restore(candidate)
for candidate in sorted(str(path) for path in Path('tests/architecture').glob('stage-08*.test.mjs')):
    restore(candidate)
for candidate in sorted(str(path) for path in Path('tests/architecture').glob('stage-09-*.test.mjs')):
    try:
        restore(candidate)
    except subprocess.CalledProcessError:
        pass

write('src/features/sync/selection/selection-highlight-session.js', highlight_session)
write('tests/stage-09-selection-highlight-session.test.mjs', behavior_test)
write('tests/architecture/stage-09-selection-highlight-session.test.mjs', architecture_test)

replace_once(
    'src/features/sync/index.js',
    ' * Responsibility: Public Stage 9 synchronization contract. R9-04, R9-05, R9-06 and R9-07 remain frozen while R9-08 adds the canonical SelectionFeedbackGuard; later selection policy remains unmigrated.\n * Imports: Public synchronization modules only.\n * Exports: Scroll owners/mappers/geometry, Selection Readers and the R9-08 Feedback Guard classes/factories.\n',
    ' * Responsibility: Public Stage 9 synchronization contract. Prior Stage 9 owners remain frozen while R9-09 adds the canonical SelectionHighlightSession; R9-10+ selection policy remains unmigrated.\n * Imports: Public synchronization modules only.\n * Exports: Scroll owners/mappers/geometry, Selection Readers, Feedback Guard and the R9-09 Highlight Session classes/factories.\n'
)
replace_once(
    'src/features/sync/index.js',
    "export {\n  SelectionFeedbackGuard,\n  createSelectionFeedbackGuard\n} from './selection/selection-feedback-guard.js';\n",
    "export {\n  SelectionFeedbackGuard,\n  createSelectionFeedbackGuard\n} from './selection/selection-feedback-guard.js';\nexport {\n  SelectionHighlightSession,\n  createSelectionHighlightSession\n} from './selection/selection-highlight-session.js';\n"
)

replace_once(
    'src/main.js',
    "import { createEditorSelectionReader, createPreviewSelectionReader, createSelectionFeedbackGuard } from './features/sync/index.js';\n",
    "import { createEditorSelectionReader, createPreviewSelectionReader, createSelectionFeedbackGuard, createSelectionHighlightSession } from './features/sync/index.js';\n"
)
replace_once(
    'src/main.js',
    "  const selectionFeedbackGuard = createSelectionFeedbackGuard({\n    setTimer: (callback, delay) => window.setTimeout(callback, delay),\n    clearTimer: timerId => window.clearTimeout(timerId)\n  });\n",
    "  const selectionHighlightSession = createSelectionHighlightSession({\n    previewElement: previewHost,\n    documentRef: previewSelectionDocument,\n    highlightRegistry: previewSelectionView?.CSS?.highlights ?? null,\n    HighlightCtor: typeof previewSelectionView?.Highlight === 'function' ? previewSelectionView.Highlight : null,\n    reportError: (message, error) => console.warn(message, error)\n  });\n  const selectionFeedbackGuard = createSelectionFeedbackGuard({\n    setTimer: (callback, delay) => window.setTimeout(callback, delay),\n    clearTimer: timerId => window.clearTimeout(timerId)\n  });\n"
)
replace_once(
    'src/main.js',
    "    compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard = selectionFeedbackGuard;\n",
    "    compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard = selectionFeedbackGuard;\n    compatibilityPlatformHost.markdownEditorSelectionHighlightSession = selectionHighlightSession;\n"
)
replace_once(
    'src/main.js',
    "    feedbackGuard: selectionFeedbackGuard\n  });\n",
    "    feedbackGuard: selectionFeedbackGuard,\n    highlightSession: selectionHighlightSession\n  });\n"
)
replace_once(
    'src/main.js',
    "    if (compatibilityPlatformHost?.markdownEditorSelectionFeedbackGuard === selectionFeedbackGuard) {\n      delete compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard;\n    }\n    selectionFeedbackGuard.destroy();\n",
    "    if (compatibilityPlatformHost?.markdownEditorSelectionFeedbackGuard === selectionFeedbackGuard) {\n      delete compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard;\n    }\n    if (compatibilityPlatformHost?.markdownEditorSelectionHighlightSession === selectionHighlightSession) {\n      delete compatibilityPlatformHost.markdownEditorSelectionHighlightSession;\n    }\n    selectionHighlightSession.destroy();\n    selectionFeedbackGuard.destroy();\n"
)

replace_once(
    'src/sync/selection-controller.js',
    "const REQUIRED_FEEDBACK_METHODS = [\n  'begin',\n  'shouldIgnore',\n  'advanceRevision',\n  'release',\n  'reset',\n  'getRevision',\n  'getState'\n];\n",
    "const REQUIRED_FEEDBACK_METHODS = [\n  'begin',\n  'shouldIgnore',\n  'advanceRevision',\n  'release',\n  'reset',\n  'getRevision',\n  'getState'\n];\nconst REQUIRED_HIGHLIGHT_METHODS = ['restore', 'clear'];\n"
)
replace_once(
    'src/sync/selection-controller.js',
    "  constructor(editor, preview, { editorSelectionReader, previewSelectionReader, feedbackGuard } = {}) {\n",
    "  constructor(editor, preview, { editorSelectionReader, previewSelectionReader, feedbackGuard, highlightSession } = {}) {\n"
)
replace_once(
    'src/sync/selection-controller.js',
    "    if (!feedbackGuard || REQUIRED_FEEDBACK_METHODS.some(method => typeof feedbackGuard[method] !== 'function')) {\n      throw new TypeError('SelectionSyncController requires SelectionFeedbackGuard');\n    }\n",
    "    if (!feedbackGuard || REQUIRED_FEEDBACK_METHODS.some(method => typeof feedbackGuard[method] !== 'function')) {\n      throw new TypeError('SelectionSyncController requires SelectionFeedbackGuard');\n    }\n    if (!highlightSession || REQUIRED_HIGHLIGHT_METHODS.some(method => typeof highlightSession[method] !== 'function')) {\n      throw new TypeError('SelectionSyncController requires SelectionHighlightSession');\n    }\n"
)
replace_once(
    'src/sync/selection-controller.js',
    "    this.feedbackGuard = feedbackGuard;\n",
    "    this.feedbackGuard = feedbackGuard;\n    this.highlightSession = highlightSession;\n"
)
replace_once(
    'src/sync/selection-controller.js',
    "  notifyPreviewMounted(reason = 'preview-mounted') {\n    this.feedbackGuard.advanceRevision();\n",
    "  notifyPreviewMounted(reason = 'preview-mounted') {\n    this.feedbackGuard.advanceRevision();\n    this.highlightSession.restore();\n"
)
replace_once(
    'src/sync/selection-controller.js',
    "  clear() {\n    this.lastEditorKey = '';\n    this.lastPreviewKey = '';\n    this.callbacks.clearPreview?.();\n  }\n",
    "  clear() {\n    this.lastEditorKey = '';\n    this.lastPreviewKey = '';\n    this.highlightSession.clear();\n    this.callbacks.clearPreview?.();\n  }\n"
)

replace_once(
    'public/app/scroll-sync.js',
    "    const selectionFeedbackGuard = scrollSyncCompatibilityHost?.markdownEditorSelectionFeedbackGuard;\n",
    "    const selectionFeedbackGuard = scrollSyncCompatibilityHost?.markdownEditorSelectionFeedbackGuard;\n    const selectionHighlightSession = scrollSyncCompatibilityHost?.markdownEditorSelectionHighlightSession;\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "    if (!selectionFeedbackGuard) throw new Error('Selection Feedback Guard compatibility capability is unavailable.');\n",
    "    if (!selectionFeedbackGuard) throw new Error('Selection Feedback Guard compatibility capability is unavailable.');\n    if (!selectionHighlightSession) throw new Error('Selection Highlight Session compatibility capability is unavailable.');\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "    function clearPreviewSelectionHighlights() {\n      if (window.CSS?.highlights) CSS.highlights.delete('preview-selection-sync');\n      preview.querySelectorAll('.preview-source-highlight').forEach(el => el.classList.remove('preview-source-highlight'));\n      preview.querySelectorAll('.preview-atomic-selection-highlight')\n        .forEach(el => el.classList.remove('preview-atomic-selection-highlight'));\n      preview.querySelectorAll('.preview-text-highlight').forEach(span => {\n        const text = document.createTextNode(span.textContent || '');\n        span.replaceWith(text);\n        text.parentNode?.normalize();\n      });\n    }\n",
    "    function clearPreviewSelectionHighlights() {\n      selectionHighlightSession.clear();\n    }\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "          const visibleRect = getRangeViewportRect(range);\n          if (window.CSS?.highlights && typeof Highlight !== 'undefined') {\n            CSS.highlights.set('preview-selection-sync', new Highlight(range));\n            if (!visibleRect) {\n              CSS.highlights.delete('preview-selection-sync');\n              continue;\n            }\n          } else if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {\n            const node = range.startContainer;\n            const after = node.splitText(range.startOffset);\n            const tail = after.splitText(range.endOffset - range.startOffset);\n            const mark = document.createElement('span');\n            mark.className = 'preview-text-highlight';\n            mark.textContent = after.nodeValue;\n            after.replaceWith(mark);\n            void tail;\n            return { range: document.createRange(), element: mark, rect: mark.getBoundingClientRect() };\n          }\n          return { range, element: entry.anchor, rect: visibleRect || range.getBoundingClientRect() };\n",
    "          const visibleRect = getRangeViewportRect(range);\n          if (!visibleRect) continue;\n          return { ranges: [range], atomicElements: [], range, element: entry.anchor, rect: visibleRect };\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "      if (ranges.length && window.CSS?.highlights && typeof Highlight !== 'undefined') {\n        CSS.highlights.set('preview-selection-sync', new Highlight(...ranges));\n      } else if (ranges.length) {\n        return null;\n      }\n      atomicElements.forEach(element => element.classList.add('preview-atomic-selection-highlight'));\n      return {\n        ranges,\n",
    "      return {\n        ranges,\n        atomicElements: [...atomicElements],\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "    function highlightTextInPreviewRange(selectedText, fromLine, toLine, sourceStartIndex = null, sourceEndIndex = null) {\n      const mapped = highlightMappedSourceRangeInPreview(fromLine, toLine, sourceStartIndex, sourceEndIndex);\n      if (mapped) return mapped;\n      const fallback = highlightTextFallbackInPreviewRange(\n        selectedText,\n        fromLine,\n        toLine,\n        sourceStartIndex,\n        sourceEndIndex\n      );\n      return fallback ? { ...fallback, matchedAnchors: 1, mappingMode: 'text-search' } : null;\n    }\n",
    "    function buildPreviewHighlightPlan(selectedText, fromLine, toLine, sourceStartIndex = null, sourceEndIndex = null) {\n      const mapped = highlightMappedSourceRangeInPreview(fromLine, toLine, sourceStartIndex, sourceEndIndex);\n      if (mapped && selectionHighlightSession.canPresent(mapped)) return mapped;\n      const fallback = highlightTextFallbackInPreviewRange(\n        selectedText,\n        fromLine,\n        toLine,\n        sourceStartIndex,\n        sourceEndIndex\n      );\n      if (!fallback || !selectionHighlightSession.canPresent(fallback)) return null;\n      return { ...fallback, matchedAnchors: 1, mappingMode: 'text-search' };\n    }\n\n    function highlightTextInPreviewRange(selectedText, fromLine, toLine, sourceStartIndex = null, sourceEndIndex = null) {\n      const createPlan = () => buildPreviewHighlightPlan(\n        selectedText,\n        fromLine,\n        toLine,\n        sourceStartIndex,\n        sourceEndIndex\n      );\n      const plan = createPlan();\n      if (!plan) return null;\n      if (!selectionHighlightSession.show(plan, { restore: createPlan })) return null;\n      return plan;\n    }\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "      syncPreviewToEditor: ({ reason, selection }) => syncPreviewSelectionToEditor(reason, selection),\n      clearPreview: clearPreviewSelectionHighlights\n",
    "      syncPreviewToEditor: ({ reason, selection }) => syncPreviewSelectionToEditor(reason, selection)\n"
)

update_inventory()
update_historical_tests()

# The new architecture test is written after historical rewrites so it is never normalized as historical content.
write('tests/architecture/stage-09-selection-highlight-session.test.mjs', architecture_test)

# Root README is written only after authoritative validation so it records actual test totals.
