from pathlib import Path
import json
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(content, old, new, label):
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return content.replace(old, new, 1)


mapper = '''/**
 * Responsibility: Map preview source lines to preview content geometry using either virtual height-index capabilities or rendered source anchors, without querying editor internals or owning scroll-source/target writes.
 * Imports: None; consumes an injected preview element, Preview virtual geometry capability and optional ResizeObserver/timer capabilities.
 * Exports: PreviewScrollMapper and createPreviewScrollMapper.
 * State/side effects: Owns only preview anchor/metric caches, preview-body observation and its debounce timer; reports geometry invalidation through an injected callback.
 * Lifecycle: Explicit instance lifecycle; destroy() disconnects observation, clears timers/caches and makes later reads terminal.
 */

function assertCapabilities(previewElement, virtualApi) {
  const previewMethods = ['querySelector', 'querySelectorAll'];
  const virtualMethods = ['getMountedAnchors', 'getMetrics', 'getContentYForLine', 'getLineForContentY'];
  if (!previewElement || previewMethods.some(name => typeof previewElement[name] !== 'function')) {
    throw new TypeError('PreviewScrollMapper requires preview DOM query capabilities');
  }
  if (!virtualApi || virtualMethods.some(name => typeof virtualApi[name] !== 'function')) {
    throw new TypeError('PreviewScrollMapper requires virtual preview geometry capabilities');
  }
}

function findLastMetricIndex(metrics, value, field) {
  let low = 0;
  let high = metrics.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (metrics[mid][field] <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

export class PreviewScrollMapper {
  constructor({
    previewElement,
    virtualApi,
    createResizeObserver = null,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timerId => clearTimeout(timerId),
    onGeometryChanged = () => {}
  } = {}) {
    assertCapabilities(previewElement, virtualApi);
    if (createResizeObserver !== null && typeof createResizeObserver !== 'function') {
      throw new TypeError('PreviewScrollMapper createResizeObserver must be a function or null');
    }
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof onGeometryChanged !== 'function') {
      throw new TypeError('PreviewScrollMapper requires timer and geometry callback capabilities');
    }
    this.previewElement = previewElement;
    this.virtualApi = virtualApi;
    this.createResizeObserver = createResizeObserver;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onGeometryChanged = onGeometryChanged;
    this.anchorsCache = null;
    this.metricsCache = null;
    this.resizeObserver = null;
    this.observedBody = null;
    this.resizeTimer = 0;
    this.destroyed = false;
  }

  assertActive() {
    if (this.destroyed) throw new Error('PreviewScrollMapper has been destroyed');
  }

  isVirtualActive() {
    this.assertActive();
    return Boolean(this.virtualApi.active);
  }

  getAnchors() {
    this.assertActive();
    if (this.isVirtualActive()) {
      this.anchorsCache = this.virtualApi.getMountedAnchors() || [];
      return this.anchorsCache;
    }
    if (this.anchorsCache) return this.anchorsCache;
    this.anchorsCache = Array.from(this.previewElement.querySelectorAll('[data-source-line]'));
    return this.anchorsCache;
  }

  replaceAnchors(anchors) {
    this.assertActive();
    this.anchorsCache = Array.from(anchors || []);
    return this.anchorsCache;
  }

  invalidateMetrics() {
    this.assertActive();
    this.metricsCache = null;
  }

  invalidateStructure() {
    this.assertActive();
    this.anchorsCache = null;
    this.metricsCache = null;
  }

  observeBodySize() {
    this.assertActive();
    if (!this.createResizeObserver) return;
    if (this.isVirtualActive()) {
      this.resizeObserver?.disconnect();
      this.observedBody = null;
      return;
    }
    const body = this.previewElement.querySelector('.markdown-body');
    if (!body) return;
    if (!this.resizeObserver) {
      this.resizeObserver = this.createResizeObserver(() => {
        if (this.destroyed) return;
        if (this.resizeTimer) this.clearTimer(this.resizeTimer);
        this.resizeTimer = this.setTimer(() => {
          if (this.destroyed) return;
          this.resizeTimer = 0;
          this.metricsCache = null;
          this.onGeometryChanged();
        }, 64);
      });
    }
    if (this.observedBody === body) return;
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(body);
    this.observedBody = body;
  }

  refreshStructure() {
    this.assertActive();
    this.anchorsCache = this.isVirtualActive()
      ? (this.virtualApi.getMountedAnchors() || [])
      : Array.from(this.previewElement.querySelectorAll('[data-source-line]'));
    this.observeBodySize();
    return this.anchorsCache;
  }

  getMetrics() {
    this.assertActive();
    if (this.metricsCache) return this.metricsCache;
    if (this.isVirtualActive()) {
      this.metricsCache = this.virtualApi.getMetrics() || [];
      return this.metricsCache;
    }
    const body = this.previewElement.querySelector('.markdown-body');
    if (!body) return [];
    const bodyTop = Number(body.offsetTop) || 0;
    this.metricsCache = this.getAnchors().map(anchor => {
      const top = bodyTop + (Number(anchor.offsetTop) || 0);
      return {
        anchor,
        startLine: Number(anchor.dataset?.sourceLine || 1),
        endLine: Number(anchor.dataset?.sourceEndLine || anchor.dataset?.sourceLine || 1),
        top,
        bottom: top + Math.max(1, Number(anchor.offsetHeight) || 0)
      };
    });
    return this.metricsCache;
  }

  getAnchorCount() {
    this.assertActive();
    return this.getAnchors().length;
  }

  findAnchor(line) {
    this.assertActive();
    const metrics = this.getMetrics();
    if (!metrics.length) return null;
    const index = findLastMetricIndex(metrics, Math.max(1, Number(line) || 1), 'startLine');
    return metrics[index]?.anchor || metrics[0].anchor;
  }

  getContentYForLine(lineFloat) {
    this.assertActive();
    if (this.isVirtualActive()) return this.virtualApi.getContentYForLine(lineFloat);
    const metrics = this.getMetrics();
    if (!metrics.length) return 0;
    const line = Math.max(1, Number(lineFloat) || 1);
    if (line <= metrics[0].startLine) return metrics[0].top;
    const index = findLastMetricIndex(metrics, line, 'startLine');
    const current = metrics[index];
    const next = metrics[index + 1];
    if (line <= current.endLine + 0.999 || !next) {
      const span = Math.max(1, current.endLine - current.startLine + 1);
      const fraction = Math.max(0, Math.min(1, (line - current.startLine) / span));
      return current.top + (current.bottom - current.top) * fraction;
    }
    const gapLines = Math.max(1, next.startLine - current.endLine);
    const fraction = Math.max(0, Math.min(1, (line - current.endLine) / gapLines));
    return current.bottom + (next.top - current.bottom) * fraction;
  }

  getLineForContentY(contentY) {
    this.assertActive();
    if (this.isVirtualActive()) return this.virtualApi.getLineForContentY(contentY);
    const metrics = this.getMetrics();
    if (!metrics.length) return 1;
    const y = Math.max(0, Number(contentY) || 0);
    if (y <= metrics[0].top) return metrics[0].startLine;
    const index = findLastMetricIndex(metrics, y, 'top');
    const current = metrics[index];
    const next = metrics[index + 1];
    if (y <= current.bottom || !next) {
      const fraction = Math.max(0, Math.min(1, (y - current.top) / Math.max(1, current.bottom - current.top)));
      return current.startLine + fraction * Math.max(1, current.endLine - current.startLine + 1);
    }
    const fraction = Math.max(0, Math.min(1, (y - current.bottom) / Math.max(1, next.top - current.bottom)));
    return current.endLine + fraction * Math.max(1, next.startLine - current.endLine);
  }

  getTopVisibleLine(scrollTop, offsetPx = 8) {
    this.assertActive();
    return Math.max(1, Math.floor(this.getLineForContentY(Math.max(0, Number(scrollTop) || 0) + Math.max(0, Number(offsetPx) || 0))));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.resizeTimer) this.clearTimer(this.resizeTimer);
    this.resizeTimer = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.observedBody = null;
    this.anchorsCache = null;
    this.metricsCache = null;
    this.previewElement = null;
    this.virtualApi = null;
    this.createResizeObserver = null;
    this.setTimer = null;
    this.clearTimer = null;
    this.onGeometryChanged = null;
  }
}

export function createPreviewScrollMapper(options = {}) {
  return new PreviewScrollMapper(options);
}
'''
write('src/features/sync/scroll/preview-scroll-mapper.js', mapper)

index = '''/**
 * Responsibility: Public Stage 9 synchronization contract. R9-05 exposes PreviewScrollMapper alongside the R9-04 EditorScrollMapper, sole scroll source owner and cancellable Scroll Controller; Geometry Session and selection responsibilities remain later Atomic Tasks.
 * Imports: Public synchronization modules only.
 * Exports: Scroll controller, source ownership, editor mapper and preview mapper classes/factories.
 * State/side effects: None; import-only facade.
 * Lifecycle: None.
 */

export {
  ScrollSyncController,
  createScrollSyncController
} from './scroll/scroll-sync-controller.js';
export {
  ScrollSourceOwnership,
  createScrollSourceOwnership
} from './scroll/scroll-source-ownership.js';
export {
  EditorScrollMapper,
  createEditorScrollMapper
} from './scroll/editor-scroll-mapper.js';
export {
  PreviewScrollMapper,
  createPreviewScrollMapper
} from './scroll/preview-scroll-mapper.js';
'''
write('src/features/sync/index.js', index)

core = read('public/app/core.js')
old_core_state = '''    let previewRenderTheme = '';
    let previewReferenceDefinitions = '';
    let countUpdateTimer = 0;
    let previewBodyResizeObserver = null;
    let observedPreviewBody = null;
    let previewBodyResizeTimer = 0;
    let previewAnchorMetricsCache = null;
    let previewAnchorsCache = null;
    let activeOutlineRow = null;
'''
new_core_state = '''    let previewRenderTheme = '';
    let previewReferenceDefinitions = '';
    let countUpdateTimer = 0;
    let activeOutlineRow = null;
'''
core = replace_once(core, old_core_state, new_core_state, 'core preview mapper state removal')
write('public/app/core.js', core)

main = read('src/main.js')
main = replace_once(
    main,
    "import { createEditorScrollMapper, createScrollSyncController } from './features/sync/index.js';",
    "import { createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController } from './features/sync/index.js';",
    'main sync import'
)
old_vars = '''  let previewController = null;
  let previewCommandHandler = null;
  let unregisterPreviewEditorCommands = null;
'''
new_vars = '''  let previewController = null;
  let previewCommandHandler = null;
  let previewScrollMapper = null;
  const destroyPreviewScrollMapper = () => {
    if (compatibilityPlatformHost?.markdownEditorPreviewScrollMapper === previewScrollMapper) {
      delete compatibilityPlatformHost.markdownEditorPreviewScrollMapper;
    }
    previewScrollMapper?.destroy();
    previewScrollMapper = null;
  };
  let unregisterPreviewEditorCommands = null;
'''
main = replace_once(main, old_vars, new_vars, 'main preview mapper lifecycle declaration')
main = replace_once(
    main,
    '''    editorController.destroy();
    unregisterPreviewEditorCommands?.();
''',
    '''    editorController.destroy();
    destroyPreviewScrollMapper();
    unregisterPreviewEditorCommands?.();
''',
    'main preview mapper teardown order'
)
old_mount = '''    previewController.start();
    previewCommandHandler = mountPreviewCommandHandler(compatibilityPlatformHost, previewController);
    unregisterPreviewEditorCommands = editorUiCommandPort.register({
'''
new_mount = '''    previewController.start();
    previewCommandHandler = mountPreviewCommandHandler(compatibilityPlatformHost, previewController);
    previewScrollMapper = createPreviewScrollMapper({
      previewElement: previewHost,
      virtualApi: previewCommandHandler.port.virtual,
      createResizeObserver: typeof window.ResizeObserver === 'function'
        ? callback => new window.ResizeObserver(callback)
        : null,
      setTimer: window.setTimeout.bind(window),
      clearTimer: window.clearTimeout.bind(window),
      onGeometryChanged: () => scrollController.notifyGeometryChanged('preview')
    });
    if (compatibilityPlatformHost) compatibilityPlatformHost.markdownEditorPreviewScrollMapper = previewScrollMapper;
    unregisterPreviewEditorCommands = editorUiCommandPort.register({
'''
main = replace_once(main, old_mount, new_mount, 'main preview mapper composition')
write('src/main.js', main)

legacy = read('public/app/scroll-sync.js')
old_ports = '''    const editorScrollMapper = scrollSyncCompatibilityHost?.markdownEditorEditorScrollMapper;
    if (!editorScrollMapper) throw new Error('Editor scroll mapper is not initialized');
'''
new_ports = '''    const editorScrollMapper = scrollSyncCompatibilityHost?.markdownEditorEditorScrollMapper;
    if (!editorScrollMapper) throw new Error('Editor scroll mapper is not initialized');
    const previewScrollMapper = scrollSyncCompatibilityHost?.markdownEditorPreviewScrollMapper;
    if (!previewScrollMapper) throw new Error('Preview scroll mapper is not initialized');
'''
legacy = replace_once(legacy, old_ports, new_ports, 'legacy preview mapper port')
pattern = re.compile(r"    function getPreviewAnchors\(\) \{.*?(?=    function scrollPreviewContentYIntoView\()", re.S)
replacement = '''    function getPreviewAnchors() {
      return previewScrollMapper.getAnchors();
    }

    function invalidatePreviewAnchorMetrics() {
      previewScrollMapper.invalidateMetrics();
    }

    function invalidatePreviewAnchorStructure() {
      previewScrollMapper.invalidateStructure();
    }

    function observePreviewBodySize() {
      previewScrollMapper.observeBodySize();
    }

    function getPreviewAnchorMetrics() {
      return previewScrollMapper.getMetrics();
    }

    function findPreviewAnchor(line) {
      return previewScrollMapper.findAnchor(line);
    }

    function sourceLineToPreviewY(lineFloat) {
      return previewScrollMapper.getContentYForLine(lineFloat);
    }

    function previewYToSourceLine(contentY) {
      return previewScrollMapper.getLineForContentY(contentY);
    }

'''
legacy, count = pattern.subn(replacement, legacy, count=1)
if count != 1:
    raise RuntimeError(f'legacy preview mapping block: expected one match, found {count}')
old_refresh = '''      refreshPreviewAnchorStructure() {
        previewAnchorsCache = scrollSyncPreviewCommandPort.virtual.active
          ? scrollSyncPreviewCommandPort.virtual.getMountedAnchors()
          : Array.from(preview.querySelectorAll('[data-source-line]'));
        observePreviewBodySize();
        return previewAnchorsCache;
      },
'''
legacy = replace_once(
    legacy,
    old_refresh,
    '''      refreshPreviewAnchorStructure: () => previewScrollMapper.refreshStructure(),
''',
    'legacy preview refresh delegation'
)
if legacy.count('previewAnchorsCache = children;') != 2:
    raise RuntimeError(f'legacy annotated anchor writes: expected two matches, found {legacy.count("previewAnchorsCache = children;")}')
legacy = legacy.replace('previewAnchorsCache = children;', 'previewScrollMapper.replaceAnchors(children);')
write('public/app/scroll-sync.js', legacy)

behavior = '''import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewScrollMapper } from '../src/features/sync/index.js';

function anchor(startLine, endLine, top, height) {
  return {
    dataset: { sourceLine: String(startLine), sourceEndLine: String(endLine) },
    offsetTop: top,
    offsetHeight: height
  };
}

function createHarness({ virtual = false } = {}) {
  const body = { offsetTop: 20 };
  const anchors = [anchor(1, 2, 0, 100), anchor(5, 6, 180, 80)];
  const calls = { query: [], virtualY: [], virtualLine: [], disconnect: 0, observe: [] };
  const previewElement = {
    querySelector(selector) { calls.query.push(selector); return selector === '.markdown-body' ? body : null; },
    querySelectorAll(selector) { calls.query.push(selector); return selector === '[data-source-line]' ? anchors : []; }
  };
  const virtualApi = {
    active: virtual,
    getMountedAnchors() { return [anchor(10, 11, 0, 50)]; },
    getMetrics() { return [{ anchor: 'virtual', startLine: 10, endLine: 11, top: 500, bottom: 600 }]; },
    getContentYForLine(line) { calls.virtualY.push(line); return 700 + Number(line); },
    getLineForContentY(y) { calls.virtualLine.push(y); return 20 + Number(y) / 100; }
  };
  let resizeCallback = null;
  const observer = {
    observe(target) { calls.observe.push(target); },
    disconnect() { calls.disconnect += 1; }
  };
  const timers = new Map();
  let nextTimer = 1;
  const geometry = [];
  const mapper = createPreviewScrollMapper({
    previewElement,
    virtualApi,
    createResizeObserver(callback) { resizeCallback = callback; return observer; },
    setTimer(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    onGeometryChanged() { geometry.push('preview'); }
  });
  return { mapper, previewElement, virtualApi, body, anchors, calls, timers, geometry, getResizeCallback: () => resizeCallback };
}

test('R9-05 requires preview DOM and virtual geometry capabilities', () => {
  const h = createHarness();
  h.mapper.destroy();
  assert.throws(() => createPreviewScrollMapper({ virtualApi: h.virtualApi }), /preview DOM query capabilities/);
  assert.throws(() => createPreviewScrollMapper({ previewElement: h.previewElement }), /virtual preview geometry capabilities/);
});

test('R9-05 rendered anchors map fractional source lines to preview content Y including gaps', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getContentYForLine(1), 20);
    assert.equal(h.mapper.getContentYForLine(2), 70);
    assert.equal(h.mapper.getContentYForLine(3.5), 200);
    assert.equal(h.mapper.getContentYForLine(5), 200);
    assert.equal(h.mapper.getContentYForLine(6.5), 260);
  } finally { h.mapper.destroy(); }
});

test('R9-05 rendered preview Y maps back to fractional source lines with anchor-gap interpolation', () => {
  const h = createHarness();
  try {
    assert.equal(h.mapper.getLineForContentY(0), 1);
    assert.equal(h.mapper.getLineForContentY(70), 2);
    assert.ok(Math.abs(h.mapper.getLineForContentY(150) - 3.75) < 1e-9);
    assert.equal(h.mapper.getLineForContentY(200), 5);
    assert.equal(h.mapper.getTopVisibleLine(192, 8), 5);
  } finally { h.mapper.destroy(); }
});

test('R9-05 virtual mode delegates mapping and metrics to the Preview virtual height index without DOM reads', () => {
  const h = createHarness({ virtual: true });
  try {
    assert.equal(h.mapper.getContentYForLine(12.5), 712.5);
    assert.equal(h.mapper.getLineForContentY(300), 23);
    assert.deepEqual(h.mapper.getMetrics(), [{ anchor: 'virtual', startLine: 10, endLine: 11, top: 500, bottom: 600 }]);
    assert.equal(h.mapper.getAnchorCount(), 1);
    assert.deepEqual(h.calls.virtualY, [12.5]);
    assert.deepEqual(h.calls.virtualLine, [300]);
    assert.deepEqual(h.calls.query, []);
  } finally { h.mapper.destroy(); }
});

test('R9-05 metric invalidation and structure invalidation have separate cache ownership', () => {
  const h = createHarness();
  try {
    const firstAnchors = h.mapper.getAnchors();
    const firstMetrics = h.mapper.getMetrics();
    h.mapper.invalidateMetrics();
    assert.equal(h.mapper.getAnchors(), firstAnchors);
    assert.notEqual(h.mapper.getMetrics(), firstMetrics);
    h.mapper.invalidateStructure();
    assert.notEqual(h.mapper.getAnchors(), firstAnchors);
  } finally { h.mapper.destroy(); }
});

test('R9-05 replace refresh and findAnchor expose one mapper-owned anchor authority', () => {
  const h = createHarness();
  try {
    const replacement = [anchor(20, 22, 50, 30)];
    h.mapper.replaceAnchors(replacement);
    h.mapper.invalidateMetrics();
    assert.equal(h.mapper.getAnchorCount(), 1);
    assert.equal(h.mapper.findAnchor(21), replacement[0]);
    const refreshed = h.mapper.refreshStructure();
    assert.equal(refreshed.length, 2);
    assert.equal(h.calls.observe.includes(h.body), true);
  } finally { h.mapper.destroy(); }
});

test('R9-05 preview body ResizeObserver debounces metric invalidation and reports geometry without taking source ownership', () => {
  const h = createHarness();
  try {
    const firstMetrics = h.mapper.getMetrics();
    h.mapper.observeBodySize();
    const callback = h.getResizeCallback();
    assert.equal(typeof callback, 'function');
    callback();
    assert.equal(h.timers.size, 1);
    const [{ callback: flush, delay }] = [...h.timers.values()];
    assert.equal(delay, 64);
    flush();
    assert.deepEqual(h.geometry, ['preview']);
    assert.notEqual(h.mapper.getMetrics(), firstMetrics);
  } finally { h.mapper.destroy(); }
});

test('R9-05 destroy is terminal idempotent and releases observer timer and caches', () => {
  const h = createHarness();
  h.mapper.observeBodySize();
  h.getResizeCallback()();
  assert.equal(h.timers.size, 1);
  h.mapper.destroy();
  h.mapper.destroy();
  assert.equal(h.timers.size, 0);
  assert.ok(h.calls.disconnect >= 1);
  assert.throws(() => h.mapper.getMetrics(), /destroyed/);
  assert.throws(() => h.mapper.getContentYForLine(1), /destroyed/);
});
'''
write('tests/stage-09-preview-scroll-mapper.test.mjs', behavior)

architecture = '''import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const LATER_FILES = [
  'src/features/sync/scroll/scroll-geometry-session.js',
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/editor-selection-reader.js',
  'src/features/sync/selection/preview-selection-reader.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js',
  'src/features/sync/selection/selection-feedback-guard.js'
];

test('R9-05 creates one canonical PreviewScrollMapper and exports it only through the Sync public entry', async () => {
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  const index = await read('src/features/sync/index.js');
  assert.match(mapper, /export class PreviewScrollMapper/);
  assert.match(mapper, /export function createPreviewScrollMapper/);
  assert.match(index, /PreviewScrollMapper/);
  assert.match(index, /createPreviewScrollMapper/);
  assert.match(index, /\.\/scroll\/preview-scroll-mapper\.js/);
  assert.match(index, /R9-05/);
});

test('R9-05 mapper owns no editor internals source ownership or target scroll writes', async () => {
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  assert.doesNotMatch(mapper, /virtualEditor|editorApi|#editor|documentModel|CodeMirror|@codemirror/);
  assert.doesNotMatch(mapper, /scrollTop\s*=|scrollTo\s*\(|scheduleTarget|beginUserGesture|markProgrammaticScroll|ScrollSourceOwnership/);
  assert.doesNotMatch(mapper, /window\.|globalThis\./);
});

test('R9-05 mapper uses only virtual height-index capabilities or preview source anchors', async () => {
  const mapper = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  for (const name of ['getMountedAnchors', 'getMetrics', 'getContentYForLine', 'getLineForContentY']) {
    assert.match(mapper, new RegExp(`virtualApi\\.${name}`));
  }
  assert.match(mapper, /querySelectorAll\('\[data-source-line\]'\)/);
  assert.match(mapper, /querySelector\('\.markdown-body'\)/);
  assert.match(mapper, /dataset\?\.sourceLine/);
  assert.match(mapper, /offsetTop/);
  assert.match(mapper, /offsetHeight/);
});

test('R9-05 application composition injects preview and virtual capabilities and owns teardown before Preview command teardown', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createPreviewScrollMapper/);
  assert.match(main, /previewElement: previewHost/);
  assert.match(main, /virtualApi: previewCommandHandler\.port\.virtual/);
  assert.match(main, /markdownEditorPreviewScrollMapper = previewScrollMapper/);
  assert.match(main, /delete compatibilityPlatformHost\.markdownEditorPreviewScrollMapper/);
  assert.match(main, /previewScrollMapper\?\.destroy\(\)/);
  assert.ok(main.indexOf('destroyPreviewScrollMapper();') < main.indexOf('previewCommandHandler?.destroy();'));
  assert.doesNotMatch(main, /window\.markdownEditorPreviewScrollMapper/);
});

test('R9-05 removes legacy preview geometry cache and ResizeObserver authority from classic globals', async () => {
  const core = await read('public/app/core.js');
  const legacy = await read('public/app/scroll-sync.js');
  for (const token of ['previewAnchorsCache', 'previewAnchorMetricsCache', 'previewBodyResizeObserver', 'observedPreviewBody', 'previewBodyResizeTimer']) {
    assert.doesNotMatch(core, new RegExp(token));
    assert.doesNotMatch(legacy, new RegExp(token));
  }
  assert.match(legacy, /const previewScrollMapper = scrollSyncCompatibilityHost\?\.markdownEditorPreviewScrollMapper/);
  assert.match(legacy, /previewScrollMapper\.getContentYForLine/);
  assert.match(legacy, /previewScrollMapper\.getLineForContentY/);
  assert.match(legacy, /previewScrollMapper\.getMetrics/);
  assert.match(legacy, /previewScrollMapper\.findAnchor/);
});

test('R9-05 classic annotation and refresh paths update mapper-owned anchors rather than a second cache', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /previewScrollMapper\.replaceAnchors\(children\)/);
  assert.match(legacy, /refreshPreviewAnchorStructure: \(\) => previewScrollMapper\.refreshStructure\(\)/);
  assert.match(legacy, /invalidatePreviewAnchorMetrics: \(\) => invalidatePreviewAnchorMetrics\(\)/);
  assert.match(legacy, /invalidatePreviewAnchorStructure: \(\) => invalidatePreviewAnchorStructure\(\)/);
});

test('R9-05 leaves Geometry Session and Selection Atomics untouched', async () => {
  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/sync/selection-controller.js'));
  await access(file('src/sync/selection-mapping.js'));
});

test('R9-05 inventory records preview mapper and current package cardinality', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 375);
  assert.equal(records.has('src/features/sync/scroll/editor-scroll-mapper.js'), true);
  assert.equal(records.has('src/features/sync/scroll/preview-scroll-mapper.js'), true);
  assert.equal(records.get('src/features/sync/scroll/preview-scroll-mapper.js')[4], 'preview-scroll-mapper-geometry-cache');
});
'''
write('tests/architecture/stage-09-preview-scroll-mapper.test.mjs', architecture)

# Currentize earlier Stage 9 architecture tests for the newly completed mapper without weakening their original contracts.
for path in ROOT.glob('tests/architecture/stage-09-*.test.mjs'):
    if path.name == 'stage-09-preview-scroll-mapper.test.mjs':
        continue
    text = path.read_text(encoding='utf-8')
    text = text.replace("  'src/features/sync/scroll/preview-scroll-mapper.js',\n", '')
    text = text.replace('inventory.modules.length, 374', 'inventory.modules.length, 375')
    text = text.replace('moduleFixture.modules.length, 374', 'moduleFixture.modules.length, 375')
    text = text.replace("records.has('src/features/sync/scroll/preview-scroll-mapper.js'), false", "records.has('src/features/sync/scroll/preview-scroll-mapper.js'), true")
    text = text.replace("paths.has('src/features/sync/scroll/preview-scroll-mapper.js'), false", "paths.has('src/features/sync/scroll/preview-scroll-mapper.js'), true")
    if path.name == 'stage-09-editor-scroll-mapper.test.mjs':
        text = text.replace(
            "test('R9-04 does not advance Preview Mapper Geometry Session or Selection migration', async () => {\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);",
            "test('R9-04 remains intact after R9-05 Preview Mapper extraction without advancing Geometry Session or Selection', async () => {\n  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));\n  for (const path of LATER_FILES) await assert.rejects(access(file(path)), path);"
        )
    path.write_text(text, encoding='utf-8')

# Package cardinality is an architecture inventory fact; currentize only those exact assertions elsewhere.
for path in ROOT.glob('tests/**/*.mjs'):
    text = path.read_text(encoding='utf-8')
    updated = text.replace('inventory.modules.length, 374', 'inventory.modules.length, 375')
    updated = updated.replace('moduleFixture.modules.length, 374', 'moduleFixture.modules.length, 375')
    if updated != text:
        path.write_text(updated, encoding='utf-8')

fixture_path = ROOT / 'tests/architecture/fixtures/production-modules.json'
fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
records = {row[0]: row for row in fixture['modules']}
records['public/app/core.js'][3] = 'Legacy layout/sidebar/recent-files wrappers and cross-stage document commands; Stage 9 editor/preview geometry state is delegated through scoped mapper and Editor UI command boundaries.'
records['public/app/scroll-sync.js'][3] = 'Legacy bidirectional selection synchronization and compatibility orchestration; R9-05 editor and preview geometry delegate to canonical Sync mappers.'
new_record = [
    'src/features/sync/scroll/preview-scroll-mapper.js',
    'esm-module',
    'sync-scroll',
    'Preview source-line/content-Y geometry mapper owning anchor/metric cache and preview-body observation while delegating virtual height-index reads and never querying editor internals.',
    'preview-scroll-mapper-geometry-cache',
    'explicit-instance',
    'retain',
    False
]
if new_record[0] in records:
    raise RuntimeError('preview-scroll-mapper inventory record already exists')
fixture['modules'].append(new_record)
fixture['modules'].sort(key=lambda row: row[0])
fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

# Preserve the current README until validation has measured the real result; the validation script writes the factual final record.
