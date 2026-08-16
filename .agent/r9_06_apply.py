from __future__ import annotations

import json
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


geometry_module = r'''/**
 * Responsibility: Own scroll-geometry recalibration and compensation state, always re-synchronizing from the currently authenticated source side without taking source ownership.
 * Imports: None; consumes injected read/write/scheduling capabilities plus read-only ScrollSourceOwnership access.
 * Exports: ScrollGeometrySession and createScrollGeometrySession.
 * State/side effects: Owns only one pending geometry-source marker and the geometryResyncs statistic; target writes and source identity remain delegated.
 * Lifecycle: Explicit instance lifecycle; destroy() clears pending geometry work, drops capabilities and makes later requests inert.
 */

const SIDE_NAMES = new Set(['editor', 'preview']);

function assertCapabilities({ sourceOwnership, readScrollTop, applyScrollTop, scheduleSourceSync }) {
  if (!sourceOwnership || typeof sourceOwnership.getSourceSide !== 'function') {
    throw new TypeError('ScrollGeometrySession requires read-only ScrollSourceOwnership access');
  }
  if (typeof readScrollTop !== 'function') {
    throw new TypeError('ScrollGeometrySession requires a readScrollTop capability');
  }
  if (typeof applyScrollTop !== 'function') {
    throw new TypeError('ScrollGeometrySession requires an applyScrollTop capability');
  }
  if (typeof scheduleSourceSync !== 'function') {
    throw new TypeError('ScrollGeometrySession requires a scheduleSourceSync capability');
  }
}

export class ScrollGeometrySession {
  constructor({ sourceOwnership, readScrollTop, applyScrollTop, scheduleSourceSync } = {}) {
    assertCapabilities({ sourceOwnership, readScrollTop, applyScrollTop, scheduleSourceSync });
    this.sourceOwnership = sourceOwnership;
    this.readScrollTop = readScrollTop;
    this.applyScrollTop = applyScrollTop;
    this.scheduleSourceSync = scheduleSourceSync;
    this.pendingSourceSide = '';
    this.geometryResyncs = 0;
    this.destroyed = false;
  }

  notifyGeometryChanged(changedSide = '') {
    if (this.destroyed || (changedSide && !SIDE_NAMES.has(changedSide))) return false;
    const sourceSide = this.sourceOwnership.getSourceSide();
    if (!SIDE_NAMES.has(sourceSide)) return false;
    if (this.pendingSourceSide === sourceSide) return true;
    this.pendingSourceSide = sourceSide;
    const scheduled = this.scheduleSourceSync(sourceSide);
    if (!scheduled) this.pendingSourceSide = '';
    return Boolean(scheduled);
  }

  compensate(side, delta, reason = 'geometry-compensation') {
    if (this.destroyed || !SIDE_NAMES.has(side) || !Number.isFinite(delta) || Math.abs(delta) < 0.5) return false;
    const currentTop = Number(this.readScrollTop(side)) || 0;
    const changed = this.applyScrollTop(side, currentTop + delta, {
      reason,
      behavior: 'auto',
      settleMs: 900
    });
    if (changed) this.notifyGeometryChanged(side);
    return Boolean(changed);
  }

  settleSourceSync(side, { published = false } = {}) {
    if (this.destroyed || !SIDE_NAMES.has(side) || this.pendingSourceSide !== side) return false;
    this.pendingSourceSide = '';
    if (!published) return false;
    this.geometryResyncs += 1;
    return true;
  }

  cancelPending() {
    if (this.destroyed) return;
    this.pendingSourceSide = '';
  }

  getState() {
    return { geometryResyncs: this.geometryResyncs };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingSourceSide = '';
    this.sourceOwnership = null;
    this.readScrollTop = null;
    this.applyScrollTop = null;
    this.scheduleSourceSync = null;
  }
}

export function createScrollGeometrySession(options = {}) {
  return new ScrollGeometrySession(options);
}
'''
write('src/features/sync/scroll/scroll-geometry-session.js', geometry_module)

controller_path = 'src/features/sync/scroll/scroll-sync-controller.js'
controller = read(controller_path)
controller = replace_once(
    controller,
    " * Responsibility: Orchestrate authenticated scroll-source events into mapper callbacks and cancellable target writes while preserving the frozen R9-01 behavior surface.\n * Imports: Scroll source ownership only; editor/preview mappers and Geometry Session remain later Stage 9 responsibilities.\n * Exports: ScrollSyncController and createScrollSyncController.\n * State/side effects: Owns element listeners, mapper callback bindings, two cancellable RAF slots, pending target/source work and runtime statistics; source identity/windows/sequence remain solely in ScrollSourceOwnership.\n * Lifecycle: Explicit instance lifecycle; destroy() removes listeners, invalidates queued work, cancels every owned RAF and destroys only internally-created source ownership.\n",
    " * Responsibility: Orchestrate authenticated scroll-source events into mapper callbacks and cancellable target writes while preserving the frozen R9-01 behavior surface.\n * Imports: Scroll source ownership plus the R9-06 Geometry Session; editor/preview geometry remains owned by dedicated mappers.\n * Exports: ScrollSyncController and createScrollSyncController.\n * State/side effects: Owns element listeners, mapper callback bindings, two cancellable RAF slots, pending target/source work and target/runtime statistics; source and geometry state are delegated to their dedicated owners.\n * Lifecycle: Explicit instance lifecycle; destroy() removes listeners, invalidates queued work, cancels every owned RAF and destroys internally-created source/geometry owners.\n",
    'controller responsibility header'
)
controller = replace_once(
    controller,
    "import { createScrollSourceOwnership } from './scroll-source-ownership.js';\n",
    "import { createScrollSourceOwnership } from './scroll-source-ownership.js';\nimport { createScrollGeometrySession } from './scroll-geometry-session.js';\n",
    'controller geometry import'
)
controller = replace_once(controller, "    this.pendingGeometryResync = false;\n", '', 'controller pending geometry state')
controller = replace_once(controller, "      geometryResyncs: 0,\n", '', 'controller geometry statistic')
controller = replace_once(
    controller,
    "    this.disposers = [];\n    this.destroyed = false;\n    this.installListeners();\n",
    "    this.disposers = [];\n    this.destroyed = false;\n    this.geometrySession = createScrollGeometrySession({\n      sourceOwnership: this.sourceOwnership,\n      readScrollTop: side => this.elements[side].scrollTop,\n      applyScrollTop: (side, top, geometryOptions) => this.applyScrollTop(side, top, geometryOptions),\n      scheduleSourceSync: side => this.scheduleSourceSync(side)\n    });\n    this.installListeners();\n",
    'controller geometry composition'
)
controller = replace_once(
    controller,
    "  cancelSourceSync() {\n    this.pendingSourceSide = '';\n    this.pendingGeometryResync = false;\n    this.cancelQueuedFrame('source');\n  }\n",
    "  cancelSourceSync() {\n    this.pendingSourceSide = '';\n    this.geometrySession.cancelPending();\n    this.cancelQueuedFrame('source');\n  }\n",
    'controller cancel source sync'
)
controller = replace_once(
    controller,
    "  scheduleSourceSync(side, { geometry = false } = {}) {\n    if (this.destroyed || !SIDE_NAMES.has(side)) return false;\n    this.pendingSourceSide = side;\n    if (geometry) this.pendingGeometryResync = true;\n    if (this.frames.source !== null) return true;\n    return this.queueFrame('source', () => this.flushSourceSync());\n  }\n\n  flushSourceSync() {\n    const side = this.pendingSourceSide;\n    const geometry = this.pendingGeometryResync;\n    this.pendingSourceSide = '';\n    this.pendingGeometryResync = false;\n    if (!side || !this.sourceOwnership.isSource(side) || this.sourceOwnership.isSuspended()) return;\n    if (geometry) this.stats.geometryResyncs += 1;\n    this.mapperCallbacks[side]?.();\n  }\n",
    "  scheduleSourceSync(side) {\n    if (this.destroyed || !SIDE_NAMES.has(side)) return false;\n    this.pendingSourceSide = side;\n    if (this.frames.source !== null) return true;\n    return this.queueFrame('source', () => this.flushSourceSync());\n  }\n\n  flushSourceSync() {\n    const side = this.pendingSourceSide;\n    this.pendingSourceSide = '';\n    const published = Boolean(side && this.sourceOwnership.isSource(side) && !this.sourceOwnership.isSuspended());\n    this.geometrySession.settleSourceSync(side, { published });\n    if (!published) return;\n    this.mapperCallbacks[side]?.();\n  }\n",
    'controller source sync geometry extraction'
)
controller = replace_once(
    controller,
    "  compensate(side, delta, reason = 'geometry-compensation') {\n    if (this.destroyed || !SIDE_NAMES.has(side) || !Number.isFinite(delta) || Math.abs(delta) < 0.5) return false;\n    const changed = this.applyScrollTop(side, this.elements[side].scrollTop + delta, {\n      reason,\n      behavior: 'auto',\n      settleMs: 900\n    });\n    if (changed) this.notifyGeometryChanged(side);\n    return changed;\n  }\n\n  notifyGeometryChanged(side = '') {\n    if (this.destroyed || (side && !SIDE_NAMES.has(side))) return;\n    const sourceSide = this.sourceOwnership.getSourceSide();\n    if (!sourceSide) return;\n    this.scheduleSourceSync(sourceSide, { geometry: true });\n  }\n",
    "  compensate(side, delta, reason = 'geometry-compensation') {\n    if (this.destroyed) return false;\n    return this.geometrySession.compensate(side, delta, reason);\n  }\n\n  notifyGeometryChanged(side = '') {\n    if (this.destroyed) return false;\n    return this.geometrySession.notifyGeometryChanged(side);\n  }\n",
    'controller geometry delegation'
)
controller = replace_once(
    controller,
    "      ...this.sourceOwnership.getState(),\n      pendingTargetSide: this.pendingTarget?.side || '',\n      ...this.stats\n",
    "      ...this.sourceOwnership.getState(),\n      ...this.geometrySession.getState(),\n      pendingTargetSide: this.pendingTarget?.side || '',\n      ...this.stats\n",
    'controller geometry state projection'
)
controller = replace_once(
    controller,
    "    this.pendingSourceSide = '';\n    this.pendingGeometryResync = false;\n    this.pendingTarget = null;\n",
    "    this.pendingSourceSide = '';\n    this.geometrySession.cancelPending();\n    this.pendingTarget = null;\n",
    'controller destroy pending geometry'
)
controller = replace_once(
    controller,
    "    this.mapperCallbacks.editor = null;\n    this.mapperCallbacks.preview = null;\n    if (this.ownsSourceOwnership) this.sourceOwnership.destroy?.();\n",
    "    this.mapperCallbacks.editor = null;\n    this.mapperCallbacks.preview = null;\n    this.geometrySession.destroy();\n    if (this.ownsSourceOwnership) this.sourceOwnership.destroy?.();\n",
    'controller geometry destroy'
)
if 'pendingGeometryResync' in controller or 'geometryResyncs: 0' in controller:
    raise RuntimeError('controller retained geometry-owned state')
write(controller_path, controller)

index_path = 'src/features/sync/index.js'
index = read(index_path)
index = replace_once(
    index,
    " * Responsibility: Public Stage 9 synchronization contract. R9-05 exposes PreviewScrollMapper alongside the R9-04 EditorScrollMapper, sole scroll source owner and cancellable Scroll Controller; Geometry Session and selection responsibilities remain later Atomic Tasks.\n * Imports: Public synchronization modules only.\n * Exports: Scroll controller, source ownership, editor mapper and preview mapper classes/factories.\n",
    " * Responsibility: Public Stage 9 synchronization contract. R9-06 adds ScrollGeometrySession beside the Scroll Controller, sole source owner and editor/preview mappers; selection responsibilities remain later Atomic Tasks.\n * Imports: Public synchronization modules only.\n * Exports: Scroll controller, source ownership, editor/preview mappers and geometry session classes/factories.\n",
    'sync index responsibility'
)
index = replace_once(
    index,
    "export {\n  PreviewScrollMapper,\n  createPreviewScrollMapper\n} from './scroll/preview-scroll-mapper.js';\n",
    "export {\n  PreviewScrollMapper,\n  createPreviewScrollMapper\n} from './scroll/preview-scroll-mapper.js';\nexport {\n  ScrollGeometrySession,\n  createScrollGeometrySession\n} from './scroll/scroll-geometry-session.js';\n",
    'sync index geometry export'
)
write(index_path, index)

# Historical architecture tests may freeze package cardinality and pre-R9-06 file absence.
for test_path in Path('tests').rglob('*.mjs'):
    text = test_path.read_text(encoding='utf-8')
    updated = text.replace('inventory.modules.length, 375', 'inventory.modules.length, 376')
    updated = updated.replace('moduleFixture.modules.length, 375', 'moduleFixture.modules.length, 376')
    if updated != text:
        test_path.write_text(updated, encoding='utf-8')

historical_architecture = [
    'tests/architecture/stage-09-scroll-contract-freeze.test.mjs',
    'tests/architecture/stage-09-scroll-source-ownership.test.mjs',
    'tests/architecture/stage-09-scroll-controller.test.mjs',
    'tests/architecture/stage-09-editor-scroll-mapper.test.mjs',
    'tests/architecture/stage-09-preview-scroll-mapper.test.mjs'
]
for path in historical_architecture:
    text = read(path)
    text = text.replace("  'src/features/sync/scroll/scroll-geometry-session.js',\n", '')
    write(path, text)

path = 'tests/architecture/stage-09-scroll-contract-freeze.test.mjs'
text = read(path)
text = replace_once(
    text,
    "test('R9-01 and R9-02 contracts remain intact after the R9-04 Editor Mapper boundary is added', async () => {\n  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  for (const path of PLANNED_LATER_FILES) await assert.rejects(access(file(path)), path);\n});\n",
    "test('R9-01 and R9-02 contracts remain intact after the R9-06 Geometry Session boundary is added', async () => {\n  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));\n  for (const path of PLANNED_LATER_FILES) await assert.rejects(access(file(path)), path);\n});\n",
    'R9-01 architecture later boundary'
)
write(path, text)

path = 'tests/architecture/stage-09-scroll-source-ownership.test.mjs'
text = read(path)
text = replace_once(
    text,
    "test('R9-02 source ownership remains intact while R9-04 adds only the Editor Mapper', async () => {\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);\n  await access(file('src/sync/selection-controller.js'));\n  await access(file('src/sync/selection-mapping.js'));\n});\n",
    "test('R9-02 source ownership remains intact after R9-06 Geometry Session extraction', async () => {\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);\n  await access(file('src/sync/selection-controller.js'));\n  await access(file('src/sync/selection-mapping.js'));\n});\n",
    'R9-02 architecture later boundary'
)
write(path, text)

path = 'tests/architecture/stage-09-scroll-controller.test.mjs'
text = read(path)
text = replace_once(
    text,
    "test('R9-03 controller remains mapper-orchestration plus target-write logic after R9-04 Editor Mapper extraction', async () => {\n  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n",
    "test('R9-03 controller remains mapper-orchestration plus target-write logic after R9-06 Geometry Session extraction', async () => {\n  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));\n",
    'R9-03 architecture geometry boundary'
)
text = text.replace("  assert.match(index, /R9-04/);\n", "  assert.match(index, /R9-06/);\n")
write(path, text)

path = 'tests/architecture/stage-09-editor-scroll-mapper.test.mjs'
text = read(path)
text = replace_once(
    text,
    "test('R9-04 remains intact after R9-05 Preview Mapper extraction without advancing Geometry Session or Selection', async () => {\n  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);\n",
    "test('R9-04 remains intact after R9-06 Geometry Session extraction without advancing Selection', async () => {\n  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));\n  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);\n",
    'R9-04 architecture geometry boundary'
)
write(path, text)

path = 'tests/architecture/stage-09-preview-scroll-mapper.test.mjs'
text = read(path)
text = replace_once(
    text,
    "test('R9-05 leaves Geometry Session and Selection Atomics untouched', async () => {\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n",
    "test('R9-05 remains intact after R9-06 Geometry Session extraction without advancing Selection', async () => {\n  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n",
    'R9-05 architecture geometry boundary'
)
write(path, text)

behavior_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScrollGeometrySession,
  createScrollSourceOwnership,
  createScrollSyncController
} from '../src/features/sync/index.js';

class FakeElement {
  constructor({ scrollHeight = 1200, clientHeight = 200, scrollTop = 0 } = {}) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this.scrollTop = scrollTop;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }

  contains(target) {
    return target?.owner === this;
  }

  scrollTo(options) {
    this.scrollTop = Number(options?.top) || 0;
  }
}

function createSessionHarness() {
  let time = 0;
  const ownership = createScrollSourceOwnership({ now: () => time });
  const tops = { editor: 100, preview: 20 };
  const writes = [];
  const schedules = [];
  const session = createScrollGeometrySession({
    sourceOwnership: ownership,
    readScrollTop: side => tops[side],
    applyScrollTop(side, top, options) {
      writes.push({ side, top, options });
      tops[side] = top;
      return true;
    },
    scheduleSourceSync(side) {
      schedules.push(side);
      return true;
    }
  });
  return {
    ownership,
    tops,
    writes,
    schedules,
    session,
    setTime(value) { time = Number(value) || 0; },
    destroy() {
      session.destroy();
      ownership.destroy();
    }
  };
}

function createFrameRuntime() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      active.add(id);
      return id;
    },
    cancel(id) { active.delete(id); },
    flush() {
      const ids = [...active];
      active.clear();
      for (const id of ids) callbacks.get(id)?.();
    },
    count() { return active.size; }
  };
}

test('R9-06 requires read-only source ownership plus explicit geometry capabilities', () => {
  assert.throws(() => createScrollGeometrySession(), /ScrollSourceOwnership/);
  const ownership = createScrollSourceOwnership({ now: () => 0 });
  try {
    assert.throws(() => createScrollGeometrySession({ sourceOwnership: ownership }), /readScrollTop/);
    assert.throws(() => createScrollGeometrySession({
      sourceOwnership: ownership,
      readScrollTop() { return 0; }
    }), /applyScrollTop/);
    assert.throws(() => createScrollGeometrySession({
      sourceOwnership: ownership,
      readScrollTop() { return 0; },
      applyScrollTop() { return false; }
    }), /scheduleSourceSync/);
  } finally {
    ownership.destroy();
  }
});

test('R9-06 geometry change without a real source schedules nothing and owns no source identity', () => {
  const h = createSessionHarness();
  try {
    assert.equal(h.session.notifyGeometryChanged('preview'), false);
    assert.deepEqual(h.schedules, []);
    assert.deepEqual(h.session.getState(), { geometryResyncs: 0 });
    assert.equal(h.ownership.getState().sourceSide, '');
  } finally {
    h.destroy();
  }
});

test('R9-06 geometry changes coalesce on the current authenticated source and count only a published resync', () => {
  const h = createSessionHarness();
  try {
    h.ownership.beginUserGesture('editor', 'wheel');
    assert.equal(h.session.notifyGeometryChanged('preview'), true);
    assert.equal(h.session.notifyGeometryChanged('editor'), true);
    assert.deepEqual(h.schedules, ['editor']);
    assert.equal(h.session.settleSourceSync('editor', { published: true }), true);
    assert.deepEqual(h.session.getState(), { geometryResyncs: 1 });
    assert.equal(h.session.settleSourceSync('editor', { published: true }), false);
    assert.deepEqual(h.session.getState(), { geometryResyncs: 1 });
    assert.equal(h.ownership.getState().sourceReason, 'wheel');
  } finally {
    h.destroy();
  }
});

test('R9-06 rejected or cancelled recalibration never increments geometryResyncs', () => {
  const h = createSessionHarness();
  try {
    h.ownership.beginUserGesture('preview', 'touch');
    assert.equal(h.session.notifyGeometryChanged(), true);
    assert.equal(h.session.settleSourceSync('preview', { published: false }), false);
    assert.equal(h.session.getState().geometryResyncs, 0);
    assert.equal(h.session.notifyGeometryChanged(), true);
    h.session.cancelPending();
    assert.equal(h.session.settleSourceSync('preview', { published: true }), false);
    assert.equal(h.session.getState().geometryResyncs, 0);
  } finally {
    h.destroy();
  }
});

test('R9-06 compensation writes only the requested target and resynchronizes from the existing source', () => {
  const h = createSessionHarness();
  try {
    h.ownership.beginUserGesture('editor', 'wheel');
    assert.equal(h.session.compensate('preview', 30, 'virtual-height'), true);
    assert.equal(h.tops.preview, 50);
    assert.deepEqual(h.schedules, ['editor']);
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0], {
      side: 'preview',
      top: 50,
      options: { reason: 'virtual-height', behavior: 'auto', settleMs: 900 }
    });
    assert.equal(h.ownership.getState().sourceSide, 'editor');
    assert.equal(h.ownership.getState().sourceReason, 'wheel');
    assert.equal(h.session.compensate('preview', 0.25), false);
    assert.equal(h.writes.length, 1);
  } finally {
    h.destroy();
  }
});

test('R9-06 ScrollSyncController compatibility API delegates geometry without creating a feedback source', () => {
  let time = 0;
  const ownership = createScrollSourceOwnership({ now: () => time });
  const frames = createFrameRuntime();
  const editor = new FakeElement({ scrollTop: 100 });
  const preview = new FakeElement({ scrollTop: 20 });
  const controller = createScrollSyncController(editor, preview, {
    sourceOwnership: ownership,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id)
  });
  try {
    let editorCalls = 0;
    controller.configure({ syncFromEditor: () => { editorCalls += 1; } });
    editor.emit('wheel');
    assert.equal(controller.compensate('preview', 30, 'virtual-height'), true);
    assert.equal(preview.scrollTop, 50);
    assert.equal(controller.getState().sourceSide, 'editor');
    assert.equal(controller.getState().sourceReason, 'wheel');
    assert.equal(frames.count(), 1);
    frames.flush();
    assert.equal(editorCalls, 1);
    assert.equal(controller.getState().geometryResyncs, 1);
  } finally {
    controller.destroy();
    ownership.destroy();
  }
});

test('R9-06 destroy is terminal and idempotent for pending geometry work', () => {
  const h = createSessionHarness();
  h.ownership.beginUserGesture('editor', 'wheel');
  assert.equal(h.session.notifyGeometryChanged(), true);
  h.session.destroy();
  h.session.destroy();
  assert.equal(h.session.notifyGeometryChanged(), false);
  assert.equal(h.session.compensate('editor', 20), false);
  assert.equal(h.session.settleSourceSync('editor', { published: true }), false);
  assert.deepEqual(h.session.getState(), { geometryResyncs: 0 });
  assert.equal(h.ownership.getState().sourceSide, 'editor');
  h.ownership.destroy();
});
'''
write('tests/stage-09-scroll-geometry-session.test.mjs', behavior_test)

architecture_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

const SELECTION_LATER_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/editor-selection-reader.js',
  'src/features/sync/selection/preview-selection-reader.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js',
  'src/features/sync/selection/selection-feedback-guard.js'
];

test('R9-06 creates one canonical ScrollGeometrySession and exposes it only through the Sync public entry', async () => {
  const session = await read('src/features/sync/scroll/scroll-geometry-session.js');
  const index = await read('src/features/sync/index.js');
  assert.match(session, /export class ScrollGeometrySession/);
  assert.match(session, /export function createScrollGeometrySession/);
  assert.match(index, /ScrollGeometrySession/);
  assert.match(index, /createScrollGeometrySession/);
  assert.match(index, /\.\/scroll\/scroll-geometry-session\.js/);
  assert.match(index, /R9-06/);
});

test('R9-06 Geometry Session owns only pending recalibration and geometry statistics without DOM RAF or source mutation', async () => {
  const session = await read('src/features/sync/scroll/scroll-geometry-session.js');
  assert.match(session, /this\.pendingSourceSide/);
  assert.match(session, /this\.geometryResyncs/);
  assert.match(session, /sourceOwnership\.getSourceSide\(\)/);
  assert.doesNotMatch(session, /addEventListener|removeEventListener|requestAnimationFrame|cancelAnimationFrame|document\.|window\.|globalThis\./);
  assert.doesNotMatch(session, /beginUserGesture|touchSource|markProgrammaticScroll|suspend\(|sourceSide\s*=|sourceReason\s*=/);
});

test('R9-06 Scroll Controller delegates geometry authority while retaining generic source/target orchestration', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(controller, /createScrollGeometrySession/);
  assert.match(controller, /this\.geometrySession\.compensate\(side, delta, reason\)/);
  assert.match(controller, /this\.geometrySession\.notifyGeometryChanged\(side\)/);
  assert.match(controller, /this\.geometrySession\.settleSourceSync\(side, \{ published \}\)/);
  assert.match(controller, /this\.geometrySession\.getState\(\)/);
  assert.match(controller, /this\.geometrySession\.destroy\(\)/);
  assert.doesNotMatch(controller, /pendingGeometryResync|geometryResyncs:\s*0/);
  assert.match(controller, /this\.frames = \{ source: null, target: null \}/);
  assert.match(controller, /scheduleTarget/);
  assert.match(controller, /applyScrollTop/);
});

test('R9-06 preserves the frozen R9-01 public geometry API and runtime-stat projection through delegation', async () => {
  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');
  assert.match(controller, /compensate: \(side, delta, reason\) => this\.compensate\(side, delta, reason\)/);
  assert.match(controller, /notifyGeometryChanged: side => this\.notifyGeometryChanged\(side\)/);
  assert.match(controller, /\.\.\.this\.geometrySession\.getState\(\)/);
  assert.match(controller, /markProgrammaticScroll/);
  assert.match(controller, /scheduleTarget/);
  assert.match(controller, /syncNow/);
});

test('R9-06 current layout preview and classic geometry producers still route through the controller compatibility surface', async () => {
  const main = await read('src/main.js');
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(main, /onGeometryChanged: \(\) => scrollController\.notifyGeometryChanged\('preview'\)/);
  assert.match(main, /onGeometryChanged\(\) \{ scrollController\.notifyGeometryChanged\(\); \}/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\('editor'\)/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\('preview'\)/);
  assert.match(legacy, /scrollController\.notifyGeometryChanged\(\)/);
  assert.doesNotMatch(main, /\.\/features\/sync\/scroll\/scroll-geometry-session\.js/);
});

test('R9-06 leaves Editor Preview mapper authority intact and does not advance Selection Atomics', async () => {
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  for (const path of SELECTION_LATER_FILES) await assert.rejects(access(file(path)), path);
  await access(file('src/sync/selection-controller.js'));
  await access(file('src/sync/selection-mapping.js'));
  const frozenMapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(frozenMapping, /R9-06/);
});

test('R9-06 inventory records one geometry owner and current package cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 376);
  assert.equal(records.has('src/features/sync/scroll/scroll-geometry-session.js'), true);
  assert.equal(records.get('src/features/sync/scroll/scroll-geometry-session.js')[4], 'scroll-geometry-session');
  assert.equal(records.get('src/features/sync/scroll/scroll-sync-controller.js')[4], 'scroll-sync-runtime');
  assert.equal(records.get('src/features/sync/scroll/scroll-source-ownership.js')[4], 'scroll-source-ownership');
});
'''
write('tests/architecture/stage-09-scroll-geometry-session.test.mjs', architecture_test)

inventory_path = 'tests/architecture/fixtures/production-modules.json'
inventory = json.loads(read(inventory_path))
records = inventory['modules']
by_path = {record[0]: record for record in records}
if 'src/features/sync/scroll/scroll-geometry-session.js' in by_path:
    raise RuntimeError('geometry session already exists in inventory')
by_path['public/app/scroll-sync.js'][3] = (
    'Legacy bidirectional selection synchronization and compatibility geometry-change producers; '
    'R9-06 scroll geometry recalibration is delegated through the canonical Geometry Session.'
)
by_path['src/features/sync/index.js'][3] = (
    'Public Stage 9 Sync contract exposing Scroll Controller, Source Ownership, Editor/Preview mappers '
    'and R9-06 Geometry Session while Selection responsibilities remain unmigrated.'
)
by_path['src/features/sync/scroll/scroll-sync-controller.js'][3] = (
    'R9-01 behavior-compatible scroll orchestrator for element input, source-owned eligibility, cancellable '
    'source/target frames and target writes; R9-06 geometry compatibility delegates to ScrollGeometrySession.'
)
geometry_record = [
    'src/features/sync/scroll/scroll-geometry-session.js',
    'esm-module',
    'sync-scroll',
    'R9-06 geometry recalibration and compensation session using the current authenticated source while delegating target writes and never mutating source ownership.',
    'scroll-geometry-session',
    'explicit-instance',
    'retain',
    False
]
records.append(geometry_record)
records.sort(key=lambda record: record[0])
write(inventory_path, json.dumps(inventory, ensure_ascii=False, separators=(',', ':')))

# R9-06 must not advance Selection or touch frozen model implementations.
for forbidden in [
    'src/features/sync/selection/selection-sync-controller.js',
    'src/features/sync/selection/editor-selection-reader.js',
    'src/features/sync/selection/preview-selection-reader.js',
    'src/features/sync/selection/selection-highlight-session.js',
    'src/features/sync/selection/selection-retry-scheduler.js',
    'src/features/sync/selection/selection-feedback-guard.js'
]:
    if Path(forbidden).exists():
        raise RuntimeError(f'R9-06 advanced later Selection task: {forbidden}')
