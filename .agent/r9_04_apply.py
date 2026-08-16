from pathlib import Path
import json

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(content, old, new, label):
    if content.count(old) != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {content.count(old)}')
    return content.replace(old, new, 1)


mapper = '''/**
 * Responsibility: Map editor document positions and source lines to CodeMirror content geometry without owning scroll source, target writes, DOM measurement or document text.
 * Imports: None; consumes an injected neutral CodeMirror geometry adapter and the frozen DocumentModel line-range API.
 * Exports: EditorScrollMapper and createEditorScrollMapper.
 * State/side effects: Owns lifecycle only; reads model line ranges and editor geometry snapshots without mutating either dependency.
 * Lifecycle: Explicit instance lifecycle; destroy() is idempotent and all later reads are rejected.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function assertCapabilities(editorApi, model) {
  const editorMethods = [
    'getSelection',
    'getScrollMetrics',
    'getLineAtHeight',
    'getHeightForLine',
    'getHeightForPosition'
  ];
  const modelMethods = [
    'getTextLength',
    'getLineCount',
    'getLineNumberAtPosition',
    'getLineStart',
    'getLineEnd'
  ];
  if (!editorApi || editorMethods.some(name => typeof editorApi[name] !== 'function')) {
    throw new TypeError('EditorScrollMapper requires neutral CodeMirror geometry capabilities');
  }
  if (!model || modelMethods.some(name => typeof model[name] !== 'function')) {
    throw new TypeError('EditorScrollMapper requires frozen DocumentModel line-range capabilities');
  }
}

function finiteGeometry(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export class EditorScrollMapper {
  constructor({ editorApi, model } = {}) {
    assertCapabilities(editorApi, model);
    this.editorApi = editorApi;
    this.model = model;
    this.destroyed = false;
  }

  assertActive() {
    if (this.destroyed) throw new Error('EditorScrollMapper has been destroyed');
  }

  getLineCount() {
    this.assertActive();
    return Math.max(1, Math.floor(Number(this.model.getLineCount()) || 1));
  }

  getTextLength() {
    this.assertActive();
    return Math.max(0, Math.floor(Number(this.model.getTextLength()) || 0));
  }

  getLineNumberAtPosition(position) {
    this.assertActive();
    const safePosition = clamp(position, 0, this.getTextLength());
    return clamp(this.model.getLineNumberAtPosition(safePosition), 1, this.getLineCount());
  }

  getLineRange(lineNumber) {
    this.assertActive();
    const line = Math.floor(clamp(lineNumber, 1, this.getLineCount()));
    const textLength = this.getTextLength();
    const start = clamp(this.model.getLineStart(line), 0, textLength);
    const end = clamp(this.model.getLineEnd(line), start, textLength);
    return Object.freeze({ lineNumber: line, start, end });
  }

  getCursorLine() {
    this.assertActive();
    const selection = this.editorApi.getSelection();
    const position = Number(selection?.start ?? selection?.anchor) || 0;
    return this.getLineNumberAtPosition(position);
  }

  getLineAtContentY(contentY) {
    this.assertActive();
    const lineCount = this.getLineCount();
    const mapped = Number(this.editorApi.getLineAtHeight(Math.max(0, Number(contentY) || 0)));
    return clamp(Number.isFinite(mapped) ? mapped : 1, 1, lineCount + 0.999);
  }

  getContentYForLine(lineFloat) {
    this.assertActive();
    const lineCount = this.getLineCount();
    const safeLine = clamp(lineFloat, 1, lineCount + 0.999);
    const lineNumber = Math.min(lineCount, Math.floor(safeLine));
    this.getLineRange(lineNumber);
    return finiteGeometry(this.editorApi.getHeightForLine(safeLine));
  }

  getContentYForPosition(position) {
    this.assertActive();
    const safePosition = clamp(position, 0, this.getTextLength());
    const lineNumber = this.getLineNumberAtPosition(safePosition);
    const range = this.getLineRange(lineNumber);
    const boundedPosition = clamp(safePosition, range.start, range.end);
    return finiteGeometry(this.editorApi.getHeightForPosition(boundedPosition));
  }

  getTopVisibleLine(offsetPx = 8) {
    this.assertActive();
    const metrics = this.editorApi.getScrollMetrics() || {};
    const contentY = Math.max(0, Number(metrics.top) || 0) + Math.max(0, Number(offsetPx) || 0);
    return Math.max(1, Math.floor(this.getLineAtContentY(contentY)));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editorApi = null;
    this.model = null;
  }
}

export function createEditorScrollMapper(options = {}) {
  return new EditorScrollMapper(options);
}
'''
write('src/features/sync/scroll/editor-scroll-mapper.js', mapper)

index = read('src/features/sync/index.js')
index = index.replace(
    ' * Responsibility: Public Stage 9 synchronization contract. R9-03 exposes the sole scroll source owner and the cancellable Scroll Controller orchestration surface; mapper, geometry-session and selection responsibilities remain later Atomic Tasks.',
    ' * Responsibility: Public Stage 9 synchronization contract. R9-04 exposes the editor geometry mapper alongside the sole scroll source owner and cancellable Scroll Controller; preview mapper, geometry-session and selection responsibilities remain later Atomic Tasks.'
)
index = index.replace(
    ' * Exports: Scroll controller and source ownership classes/factories.',
    ' * Exports: Scroll controller, source ownership and editor scroll mapper classes/factories.'
)
index += "export {\n  EditorScrollMapper,\n  createEditorScrollMapper\n} from './scroll/editor-scroll-mapper.js';\n"
write('src/features/sync/index.js', index)

main = read('src/main.js')
main = replace_once(
    main,
    "import { createScrollSyncController } from './features/sync/index.js';",
    "import { createEditorScrollMapper, createScrollSyncController } from './features/sync/index.js';",
    'main sync import'
)
old = """  window.markdownEditorSelectionController = createSelectionSyncController(editorHost, previewHost);\n  const documentModel = createDocumentModel(editorHost);\n  let editorController;\n"""
new = """  window.markdownEditorSelectionController = createSelectionSyncController(editorHost, previewHost);\n  const documentModel = createDocumentModel(editorHost);\n  let editorScrollMapper = null;\n  try {\n    editorScrollMapper = createEditorScrollMapper({ editorApi: virtualEditor, model: documentModel });\n    if (compatibilityPlatformHost) compatibilityPlatformHost.markdownEditorEditorScrollMapper = editorScrollMapper;\n  } catch (error) {\n    documentModel.destroy();\n    virtualEditor.destroy();\n    throw error;\n  }\n  const destroyEditorScrollMapper = () => {\n    if (compatibilityPlatformHost?.markdownEditorEditorScrollMapper === editorScrollMapper) {\n      delete compatibilityPlatformHost.markdownEditorEditorScrollMapper;\n    }\n    editorScrollMapper?.destroy();\n    editorScrollMapper = null;\n  };\n  let editorController;\n"""
main = replace_once(main, old, new, 'main mapper composition')
# Both pre-feature error paths already tear down model/editor; insert mapper teardown first.
needle = "    editorController?.destroy?.();\n    documentModel.destroy();\n    virtualEditor.destroy();\n    throw error;"
if main.count(needle) != 1:
    raise RuntimeError(f'main first cleanup: expected one match, found {main.count(needle)}')
main = main.replace(needle, "    editorController?.destroy?.();\n    destroyEditorScrollMapper();\n    documentModel.destroy();\n    virtualEditor.destroy();\n    throw error;", 1)
needle = "    editorController.destroy();\n    documentModel.destroy();\n    virtualEditor.destroy();\n    throw error;"
if main.count(needle) != 1:
    raise RuntimeError(f'main second cleanup: expected one match, found {main.count(needle)}')
main = main.replace(needle, "    editorController.destroy();\n    destroyEditorScrollMapper();\n    documentModel.destroy();\n    virtualEditor.destroy();\n    throw error;", 1)
# Final lifecycle teardown must release the mapper before its model/editor dependencies.
needle = "    previewRenderer = null;\n    documentModel.destroy();\n    virtualEditor.destroy();"
main = replace_once(
    main,
    needle,
    "    previewRenderer = null;\n    destroyEditorScrollMapper();\n    documentModel.destroy();\n    virtualEditor.destroy();",
    'main final mapper cleanup'
)
write('src/main.js', main)

legacy = read('public/app/scroll-sync.js')
start_marker = '    // CodeMirror 使用自身的虚拟行几何；以下 Canvas 索引仅作为旧式文本控件的兼容回退。\n'
end_marker = '    function getMaxScroll(element) {\n'
start = legacy.find(start_marker)
end = legacy.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError('legacy editor metric block markers not found')
replacement = '''    const editorScrollMapper = scrollSyncCompatibilityHost?.markdownEditorEditorScrollMapper;
    if (!editorScrollMapper) throw new Error('Editor scroll mapper is not initialized');

    function getLineStartIndex(line) {
      return editorScrollMapper.getLineRange(line).start;
    }

    function getLineEndIndex(line) {
      return editorScrollMapper.getLineRange(line).end;
    }

    function getLineNumberAtIndex(text, index) {
      const source = String(text ?? '');
      const safeIndex = Math.max(0, Math.min(source.length, Number(index) || 0));
      return source.slice(0, safeIndex).split('\\n').length;
    }

    function getEditorCursorLine() {
      return editorScrollMapper.getCursorLine();
    }

    function getEditorLineFloatAtY(contentY) {
      return editorScrollMapper.getLineAtContentY(contentY);
    }

    function getEditorYForLineFloat(lineFloat) {
      return editorScrollMapper.getContentYForLine(lineFloat);
    }

    function measureEditorIndexY(index) {
      return editorScrollMapper.getContentYForPosition(index);
    }

    function getTopVisibleEditorLine() {
      return editorScrollMapper.getTopVisibleLine(8);
    }

'''
legacy = legacy[:start] + replacement + legacy[end:]
legacy = legacy.replace(
    '        // 连续拖动分栏时只标记失效，停稳后在空闲帧重建一次。\n        scheduleEditorMetricsRebuild(scrollSyncLayoutStatePort.isResizing ? 180 : 90);',
    "        scrollController.notifyGeometryChanged('editor');"
)
legacy = legacy.replace(
    '        scheduleEditorMetricsRebuild(0);\n        invalidatePreviewAnchorMetrics();',
    "        scrollController.notifyGeometryChanged('editor');\n        invalidatePreviewAnchorMetrics();"
)
old_prepare = '''      preparePreviewEditorMetrics() {
        if (editor.virtualEditor) scheduleEditorMetricsRebuild(100);
        else {
          const currentSource = documentModel?.createSnapshot?.('preview-metrics-source') ?? editor.value;
          if (editorMetricText !== currentSource) {
            editorLineIndexText = null;
            editorMetricText = null;
            scheduleEditorMetricsRebuild(100);
          }
        }
      },'''
legacy = replace_once(
    legacy,
    old_prepare,
    "      preparePreviewEditorMetrics() {\n        scrollController.notifyGeometryChanged('editor');\n      },",
    'legacy prepare metrics'
)
for forbidden in [
    'editorMetricText', 'editorMetricSignature', 'editorMetricLines', 'editorLineStarts',
    'editorLineRows', 'editorVisualOffsets', 'editorMetricTotalRows', 'editorMetricContentHeight',
    'editorMetricPaddingTop', 'editorMetricPaddingBottom', 'editorMetricContentWidth',
    'editorMetricLineHeight', 'editorMetricTimer', 'editorMeasureCanvas', 'editorMeasureContext',
    'getEditorMeasureContext', 'measureVisualRows', 'ensureEditorLineIndex',
    'rebuildEditorLineMetrics', 'invalidateEditorLineMetrics', 'scheduleEditorMetricsRebuild'
]:
    if forbidden in legacy:
        raise RuntimeError(f'legacy full-text metric authority remains: {forbidden}')
write('public/app/scroll-sync.js', legacy)

# Currentize Stage 9 architecture contracts without weakening prior behavior assertions.
path = 'tests/architecture/stage-09-scroll-controller.test.mjs'
text = read(path)
text = text.replace("  'src/features/sync/scroll/editor-scroll-mapper.js',\n", '', 1)
text = text.replace(
    "test('R9-03 controller is mapper-orchestration plus target-write logic without implementing later mappers', async () => {",
    "test('R9-03 controller remains mapper-orchestration plus target-write logic after R9-04 Editor Mapper extraction', async () => {"
)
text = text.replace(
    "  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');\n  assert.match(controller, /this\\.mapperCallbacks/);",
    "  const controller = await read('src/features/sync/scroll/scroll-sync-controller.js');\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  assert.match(controller, /this\\.mapperCallbacks/);"
)
text = text.replace('  assert.match(index, /R9-03/);', '  assert.match(index, /R9-04/);')
write(path, text)

path = 'tests/architecture/stage-09-scroll-source-ownership.test.mjs'
text = read(path)
text = text.replace("  'src/features/sync/scroll/editor-scroll-mapper.js',\n", '', 1)
text = text.replace(
    "test('R9-02 leaves geometry mapper and selection Atomics untouched', async () => {\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);",
    "test('R9-02 source ownership remains intact while R9-04 adds only the Editor Mapper', async () => {\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);"
)
write(path, text)

path = 'tests/architecture/stage-09-scroll-contract-freeze.test.mjs'
text = read(path)
text = text.replace("  'src/features/sync/scroll/editor-scroll-mapper.js',\n", '', 1)
text = text.replace(
    "test('R9-02 advances only source ownership while geometry and selection Atomics remain absent', async () => {\n  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));\n  for (const path of PLANNED_LATER_FILES) await assert.rejects(access(file(path)), path);",
    "test('R9-01 and R9-02 contracts remain intact after the R9-04 Editor Mapper boundary is added', async () => {\n  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));\n  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));\n  for (const path of PLANNED_LATER_FILES) await assert.rejects(access(file(path)), path);"
)
write(path, text)

behavior_test = '''import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorScrollMapper } from '../src/features/sync/index.js';

function createModel() {
  const ranges = [
    { start: 0, end: 3 },
    { start: 4, end: 8 },
    { start: 9, end: 9 }
  ];
  return {
    getTextLength() { return 9; },
    getLineCount() { return ranges.length; },
    getLineNumberAtPosition(position) {
      const value = Math.max(0, Math.min(9, Number(position) || 0));
      if (value <= 3) return 1;
      if (value <= 8) return 2;
      return 3;
    },
    getLineStart(line) { return ranges[Math.max(0, Math.min(2, Number(line) - 1))].start; },
    getLineEnd(line) { return ranges[Math.max(0, Math.min(2, Number(line) - 1))].end; }
  };
}

function createEditorApi() {
  const calls = { lineAtHeight: [], heightForLine: [], heightForPosition: [] };
  return {
    calls,
    selection: { anchor: 5, head: 5, start: 5, end: 5 },
    scrollMetrics: { top: 140, clientHeight: 200, height: 1000 },
    getSelection() { return { ...this.selection }; },
    getScrollMetrics() { return { ...this.scrollMetrics }; },
    getLineAtHeight(height) { calls.lineAtHeight.push(height); return 1 + height / 100; },
    getHeightForLine(line) { calls.heightForLine.push(line); return line * 100; },
    getHeightForPosition(position) { calls.heightForPosition.push(position); return 50 + position * 10; }
  };
}

function createHarness() {
  const model = createModel();
  const editorApi = createEditorApi();
  const mapper = createEditorScrollMapper({ editorApi, model });
  return { model, editorApi, mapper };
}

test('R9-04 requires explicit neutral CodeMirror geometry and frozen model line-range capabilities', () => {
  const model = createModel();
  const editorApi = createEditorApi();
  assert.throws(() => createEditorScrollMapper({ model }), /CodeMirror geometry capabilities/);
  assert.throws(() => createEditorScrollMapper({ editorApi }), /DocumentModel line-range capabilities/);
  assert.throws(
    () => createEditorScrollMapper({ editorApi: { ...editorApi, getLineAtHeight: null }, model }),
    /CodeMirror geometry capabilities/
  );
});

test('R9-04 model position and line-range mapping is clamped and immutable', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getLineNumberAtPosition(-20), 1);
    assert.equal(h.mapper.getLineNumberAtPosition(5), 2);
    assert.equal(h.mapper.getLineNumberAtPosition(999), 3);
    assert.deepEqual(h.mapper.getLineRange(-5), { lineNumber: 1, start: 0, end: 3 });
    const last = h.mapper.getLineRange(99);
    assert.deepEqual(last, { lineNumber: 3, start: 9, end: 9 });
    assert.equal(Object.isFrozen(last), true);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 content Y maps to a bounded fractional source line through CodeMirror geometry', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getLineAtContentY(-50), 1);
    assert.equal(h.mapper.getLineAtContentY(150), 2.5);
    assert.equal(h.mapper.getLineAtContentY(9999), 3.999);
    assert.deepEqual(h.editorApi.calls.lineAtHeight, [0, 150, 9999]);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 source line maps to content Y through CodeMirror geometry with model bounds', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getContentYForLine(2.5), 250);
    assert.equal(h.mapper.getContentYForLine(99), 399.9);
    assert.deepEqual(h.editorApi.calls.heightForLine, [2.5, 3.999]);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 source position maps through its frozen model line range before geometry lookup', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getContentYForPosition(5), 100);
    assert.equal(h.mapper.getContentYForPosition(999), 140);
    assert.deepEqual(h.editorApi.calls.heightForPosition, [5, 9]);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 cursor and top-visible line reads remain geometry-only and never own scroll writes', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getCursorLine(), 2);
    assert.equal(h.mapper.getTopVisibleLine(), 2);
    assert.equal(h.mapper.getTopVisibleLine(60), 3);
    assert.deepEqual(h.editorApi.calls.lineAtHeight, [148, 200]);
    assert.equal('setScrollTop' in h.editorApi, false);
  } finally {
    h.mapper.destroy();
  }
});

test('R9-04 destroy is terminal and idempotent', () => {
  const h = createHarness();
  h.mapper.destroy();
  h.mapper.destroy();
  assert.throws(() => h.mapper.getLineCount(), /destroyed/);
  assert.throws(() => h.mapper.getLineRange(1), /destroyed/);
  assert.throws(() => h.mapper.getContentYForLine(1), /destroyed/);
});
'''
write('tests/stage-09-editor-scroll-mapper.test.mjs', behavior_test)

architecture_test = '''import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const LATER_FILES = [
  'src/features/sync/scroll/preview-scroll-mapper.js',
  'src/features/sync/scroll/scroll-geometry-session.js',
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/editor-selection-reader.js',
  'src/features/sync/selection/preview-selection-reader.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js',
  'src/features/sync/selection/selection-feedback-guard.js'
];

test('R9-04 creates one canonical EditorScrollMapper and exports it only through the Sync public entry', async () => {
  const mapper = await read('src/features/sync/scroll/editor-scroll-mapper.js');
  const index = await read('src/features/sync/index.js');
  assert.match(mapper, /export class EditorScrollMapper/);
  assert.match(mapper, /export function createEditorScrollMapper/);
  assert.match(index, /EditorScrollMapper/);
  assert.match(index, /createEditorScrollMapper/);
  assert.match(index, /\.\/scroll\/editor-scroll-mapper\.js/);
  assert.match(index, /R9-04/);
});

test('R9-04 mapper is DOM-free and owns neither source state nor scroll writes nor full-text measurement', async () => {
  const mapper = await read('src/features/sync/scroll/editor-scroll-mapper.js');
  assert.doesNotMatch(mapper, /from ['"]@codemirror/);
  assert.doesNotMatch(mapper, /document\.|window\.|globalThis\.|querySelector|createElement\s*\(|getContext\s*\(|measureText\s*\(/);
  assert.doesNotMatch(mapper, /scrollTop\s*=|scrollTo\s*\(|scheduleTarget|beginUserGesture|markProgrammaticScroll|ScrollSourceOwnership/);
  assert.doesNotMatch(mapper, /split\(['"]\\n|sliceText|\.value\b/);
});

test('R9-04 mapper composes frozen model line ranges with neutral CodeMirror geometry reads', async () => {
  const mapper = await read('src/features/sync/scroll/editor-scroll-mapper.js');
  for (const name of ['getTextLength', 'getLineCount', 'getLineNumberAtPosition', 'getLineStart', 'getLineEnd']) {
    assert.match(mapper, new RegExp(`model\\.${name}`));
  }
  for (const name of ['getSelection', 'getScrollMetrics', 'getLineAtHeight', 'getHeightForLine', 'getHeightForPosition']) {
    assert.match(mapper, new RegExp(`editorApi\\.${name}`));
  }
});

test('R9-04 application composition injects editor/model capabilities through the public Sync factory and owns mapper teardown', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createEditorScrollMapper, createScrollSyncController \} from ['"]\.\/features\/sync\/index\.js['"]/);
  assert.match(main, /createEditorScrollMapper\(\{ editorApi: virtualEditor, model: documentModel \}\)/);
  assert.match(main, /compatibilityPlatformHost\.markdownEditorEditorScrollMapper = editorScrollMapper/);
  assert.match(main, /delete compatibilityPlatformHost\.markdownEditorEditorScrollMapper/);
  assert.match(main, /editorScrollMapper\?\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorEditorScrollMapper/);
});

test('R9-04 removes legacy Canvas/textarea editor metric authority and delegates editor geometry to the mapper', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /const editorScrollMapper = scrollSyncCompatibilityHost\?\.markdownEditorEditorScrollMapper/);
  assert.match(legacy, /editorScrollMapper\.getLineRange/);
  assert.match(legacy, /editorScrollMapper\.getLineAtContentY/);
  assert.match(legacy, /editorScrollMapper\.getContentYForLine/);
  assert.match(legacy, /editorScrollMapper\.getContentYForPosition/);
  assert.match(legacy, /editorScrollMapper\.getTopVisibleLine/);
  assert.doesNotMatch(legacy, /editorMeasureCanvas|editorMeasureContext|editorMetricText|editorMetricLines|editorLineRows|editorVisualOffsets/);
  assert.doesNotMatch(legacy, /createElement\(['"]canvas['"]\)|getContext\(['"]2d['"]\)|measureText\s*\(|rebuildEditorLineMetrics|scheduleEditorMetricsRebuild/);
});

test('R9-04 does not advance Preview Mapper Geometry Session or Selection migration', async () => {
  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);
  await access(file('src/sync/selection-controller.js'));
  await access(file('src/sync/selection-mapping.js'));
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /function sourceLineToPreviewY/);
  assert.match(legacy, /function previewYToSourceLine/);
  assert.match(legacy, /selectionController\.configure/);
});

test('R9-04 inventory records one editor mapper and current package cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 374);
  assert.equal(records.has('src/features/sync/scroll/editor-scroll-mapper.js'), true);
  assert.equal(records.get('src/features/sync/scroll/editor-scroll-mapper.js')[4], 'editor-scroll-mapper-lifecycle');
  assert.equal(records.has('src/features/sync/scroll/preview-scroll-mapper.js'), false);
});
'''
write('tests/architecture/stage-09-editor-scroll-mapper.test.mjs', architecture_test)

# Update production inventory exactly once for the new production responsibility.
inventory_path = ROOT / 'tests/architecture/fixtures/production-modules.json'
inventory = json.loads(inventory_path.read_text(encoding='utf-8'))
if len(inventory['modules']) != 373:
    raise RuntimeError(f'unexpected baseline inventory size: {len(inventory["modules"])}')
records = {record[0]: record for record in inventory['modules']}
if 'src/features/sync/scroll/editor-scroll-mapper.js' in records:
    raise RuntimeError('editor mapper already exists in inventory')
for record in inventory['modules']:
    if record[0] == 'src/features/sync/index.js':
        record[3] = 'Public Stage 9 Sync contract exposing Scroll Controller, Source Ownership and R9-04 EditorScrollMapper while preview/geometry/selection responsibilities remain unmigrated.'
    elif record[0] == 'public/app/scroll-sync.js':
        record[3] = 'Legacy Preview Mapper and bidirectional selection synchronization orchestration; R9-04 editor geometry delegates to the canonical EditorScrollMapper.'
index_pos = next(i for i, record in enumerate(inventory['modules']) if record[0] == 'src/features/sync/scroll/scroll-source-ownership.js')
inventory['modules'].insert(index_pos, [
    'src/features/sync/scroll/editor-scroll-mapper.js',
    'esm-module',
    'sync-scroll',
    'R9-04 editor scroll geometry mapper using injected CodeMirror geometry and frozen model line ranges without Canvas/textarea full-text measurement or scroll/source ownership.',
    'editor-scroll-mapper-lifecycle',
    'explicit-instance',
    'retain',
    False
])
inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

# Historical/current-package architecture assertions track factual package cardinality only.
for path in (ROOT / 'tests').rglob('*.mjs'):
    text = path.read_text(encoding='utf-8')
    updated = text.replace('inventory.modules.length, 373', 'inventory.modules.length, 374')
    if updated != text:
        path.write_text(updated, encoding='utf-8')

# Guard the intended R9-04 boundary before CI.
legacy = read('public/app/scroll-sync.js')
if "createElement('canvas')" in legacy or 'measureText(' in legacy:
    raise RuntimeError('legacy Canvas measurement still present')
for path in [
    'src/features/sync/scroll/preview-scroll-mapper.js',
    'src/features/sync/scroll/scroll-geometry-session.js',
    'src/features/sync/selection/selection-sync-controller.js'
]:
    if (ROOT / path).exists():
        raise RuntimeError(f'later Atomic appeared unexpectedly: {path}')

print('R9-04 candidate applied')
