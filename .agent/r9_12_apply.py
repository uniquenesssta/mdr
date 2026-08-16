from pathlib import Path
import json
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected one marker, got {text.count(old)}: {old[:90]!r}')
    write(path, text.replace(old, new, 1))

# Final SelectionSyncController internal consistency.
path = 'src/features/sync/selection/selection-sync-controller.js'
text = read(path)
text = text.replace('    this.cancelFrame = cancelFrame;\n', '    this.cancelScheduledFrameRequest = cancelFrame;\n', 1)
dead = """  cancelFrame(side) {
    const property = side === 'editor' ? 'editorFrame' : 'previewFrame';
    const versionProperty = side === 'editor' ? 'editorFrameVersion' : 'previewFrameVersion';
    this[versionProperty] += 1;
    if (this[property]) this.cancelFrame(this[property]);
    this[property] = 0;
  }

"""
if text.count(dead) != 1:
    raise SystemExit('SelectionSyncController dead cancelFrame marker missing')
text = text.replace(dead, '', 1)
text = text.replace('    if (id) this.cancelFrame(id);\n', '    if (id) this.cancelScheduledFrameRequest(id);\n', 1)
text = text.replace("    this.stats = {\n", "    this.finalFeedbackState = null;\n    this.stats = {\n", 1)
text = text.replace(
    "    const feedback = this.feedbackGuard.getState();\n",
    "    const feedback = this.feedbackGuard?.getState?.() || this.finalFeedbackState || { source: '', revision: 0 };\n",
    1
)
text = text.replace(
    "    this.stop();\n    this.destroyed = true;\n",
    "    this.stop();\n    this.finalFeedbackState = this.feedbackGuard.getState();\n    this.destroyed = true;\n",
    1
)
text = text.replace('    this.cancelFrame = null;\n', '    this.cancelScheduledFrameRequest = null;\n', 1)
write(path, text)

# Stage 9 public facade now exposes the final controller.
path = 'src/features/sync/index.js'
text = read(path)
old_header = "Responsibility: Public Stage 9 synchronization contract. R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07, R9-08, R9-09 and R9-10 owners remain frozen; R9-11 integrates frozen selection mapping exclusively through model-kernel composition while R9-12 legacy-measurement removal remains pending."
new_header = "Responsibility: Public Stage 9 synchronization contract. R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07, R9-08, R9-09, R9-10 and R9-11 owners remain frozen; R9-12 closes legacy sync and exposes the final selection orchestrator."
if text.count(old_header) != 1:
    raise SystemExit('sync facade R9-12 header marker missing')
text = text.replace(old_header, new_header, 1)
text = text.replace(
    ' * Exports: Scroll owners/mappers/geometry, Selection Readers, Feedback Guard, Highlight Session and Retry Scheduler classes/factories.\n',
    ' * Exports: Scroll owners/mappers/geometry plus final Selection Controller, Readers, Feedback Guard, Highlight Session and Retry Scheduler classes/factories.\n',
    1
)
text += """export {
  SelectionSyncController,
  createSelectionSyncController
} from './selection/selection-sync-controller.js';
"""
write(path, text)

# Hybrid feature exposes one explicit cross-feature capability boundary.
path = 'src/features/hybrid-editor/index.js'
text = read(path)
if "hybrid-sync-capabilities.js" not in text:
    text += "\nexport { configureHybridSyncCapabilities, getHybridSyncCapabilities } from './runtime/hybrid-sync-capabilities.js';\n"
write(path, text)

# Virtual Editor receives scroll synchronization explicitly.
path = 'src/editor/virtual-editor.js'
text = read(path)
text = text.replace(
    'export function createVirtualEditor(host) {\n',
    "export function createVirtualEditor(host, { scrollSync = null } = {}) {\n  if (scrollSync !== null && (typeof scrollSync.markProgrammaticScroll !== 'function' || typeof scrollSync.suspend !== 'function')) {\n    throw new TypeError('Virtual Editor scrollSync requires markProgrammaticScroll/suspend');\n  }\n",
    1
)
text = text.replace(
    "    markProgrammaticScroll(duration) { window.markdownEditorScrollSync?.markProgrammaticScroll?.('editor', duration); },\n    suspendScrollSync(duration) { window.markdownEditorScrollSync?.suspend?.(duration); },",
    "    markProgrammaticScroll(duration) { scrollSync?.markProgrammaticScroll?.('editor', duration); },\n    suspendScrollSync(duration) { scrollSync?.suspend?.(duration); },",
    1
)
write(path, text)

# Hybrid CodeMirror facade uses explicit configured capability, not window sync globals.
path = 'src/editor/hybrid-markdown.js'
text = read(path)
text = text.replace(
    '  createInlinePresentationCoordinator,\n',
    '  createInlinePresentationCoordinator,\n  getHybridSyncCapabilities,\n',
    1
)
text = text.replace(
    "      markProgrammaticScroll: (surface, durationMs) => {\n        globalThis.window?.markdownEditorScrollSync?.markProgrammaticScroll?.(surface, durationMs);\n      }",
    "      markProgrammaticScroll: (surface, durationMs) => {\n        getHybridSyncCapabilities()?.markProgrammaticScroll(surface, durationMs);\n      }",
    1
)
write(path, text)

# Widget geometry uses the same explicit Hybrid capability boundary.
path = 'src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js'
text = read(path)
if not text.startswith("import { getHybridSyncCapabilities"):
    text = "import { getHybridSyncCapabilities } from '../runtime/hybrid-sync-capabilities.js';\n\n" + text
text = text.replace(
    "  runtimeWindow?.markdownEditorScrollSync?.notifyGeometryChanged?.('editor');\n  runtimeWindow?.markdownEditorSelectionController?.notifyEditorGeometry?.(`hybrid-widget:${reason}`);",
    "  const sync = getHybridSyncCapabilities();\n  sync?.notifyScrollGeometry('editor');\n  sync?.notifySelectionGeometry(`hybrid-widget:${reason}`);",
    1
)
write(path, text)

# Telemetry consumes the explicit runtime stats provider rather than sync globals.
path = 'src/runtime/performance.js'
text = read(path)
text = text.replace(
    "    const scrollClassification = window.markdownEditorScrollController?.classifyScrollTarget?.(target) || null;",
    "    const scrollClassification = runtimeStatsProvider()?.classifyScrollTarget?.(target) || null;",
    1
)
text = text.replace(
    "function functionDetails(name) {\n  const editor = document.getElementById('editor');\n  const preview = document.getElementById('preview');\n  if (name.includes('Scroll')) {\n    const syncState = window.markdownEditorScrollController?.getState?.() || null;",
    "function functionDetails(name) {\n  const editor = document.getElementById('editor');\n  const preview = document.getElementById('preview');\n  const runtimeStats = runtimeStatsProvider() || {};\n  if (name.includes('Scroll')) {\n    const syncState = runtimeStats.scrollSync || null;",
    1
)
text = text.replace(
    "  if (name.includes('Selection')) {\n    const selectionState = window.markdownEditorSelectionController?.getState?.() || null;",
    "  if (name.includes('Selection')) {\n    const selectionState = runtimeStats.selectionSync || null;",
    1
)
text = text.replace("  const runtimeStats = runtimeStatsProvider() || {};\n  const virtualPreview", "  const virtualPreview", 1)
text = text.replace(
    "  const scrollState = window.markdownEditorScrollController?.getState?.() || null;\n  const selectionState = window.markdownEditorSelectionController?.getState?.() || null;",
    "  const runtimeStats = runtimeStatsProvider() || {};\n  const scrollState = runtimeStats.scrollSync || null;\n  const selectionState = runtimeStats.selectionSync || null;",
    1
)
# Remove instrumentation entries for the deleted classic sync implementation.
for legacy in [
    "      ['annotatePreviewSourceLines', true],\n",
    "      ['rebuildEditorLineMetrics', true],\n",
    "      ['getPreviewAnchorMetrics', true]\n",
    "      ['syncFromEditorScroll', true],\n",
    "      ['syncFromPreviewScroll', true],\n",
    "      ['scheduleSyncedScroll', true],\n",
    "      ['scheduleSourceScrollSync', true]\n",
    "      ['highlightPreviewLines', true]\n"
]:
    text = text.replace(legacy, '')
# Clean empty sync groups left by removal.
text = text.replace("    'sync.scroll': [\n    ],\n", '')
text = text.replace("    'sync.selection': [\n    ],\n", '')
write(path, text)

# Preview render engine passes canonical model block ranges to source annotation and drops old metric-preparation trigger.
path = 'src/features/preview/pipeline/preview-render-engine.js'
text = read(path)
text = text.replace(
    '  function scheduleEnhancements(sourceText, blockTokens, renderVersion, generation, options = {}) {',
    '  function scheduleEnhancements(sourceText, blockTokens, blockRanges, renderVersion, generation, options = {}) {',
    1
)
text = text.replace(
    '        if (!sourceAlreadyAnnotated) shell.annotatePreviewSourceLines?.(sourceText, blockTokens);',
    '        if (!sourceAlreadyAnnotated) shell.annotatePreviewSourceLines?.(sourceText, blockTokens, blockRanges);',
    1
)
# All call sites include modelResult blocks before version/generation.
text = text.replace(
    'scheduleEnhancements(sourceText, blockTokens, renderVersion, generation,',
    'scheduleEnhancements(sourceText, blockTokens, modelResult?.blocks || [], renderVersion, generation,',
)
text = text.replace('    shell.preparePreviewEditorMetrics?.();\n', '')
write(path, text)

# Remaining classic Web Clipper caller uses the scoped Editor UI command registry.
path = 'public/app/web-clipper.js'
text = read(path)
text = text.replace(
    "        webClipperPreviewCommandPort.update().then(() => syncEditorSelectionToPreview(true));\n      } else {\n        requestAnimationFrame(() => syncEditorSelectionToPreview(true));",
    "        webClipperPreviewCommandPort.update().then(() => {\n          if (webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {\n            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');\n          }\n        });\n      } else {\n        requestAnimationFrame(() => {\n          if (webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {\n            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');\n          }\n        });",
    1
)
write(path, text)

# Composition root: direct Stage 9 ownership, no sync globals/classic mapping host.
path = 'src/main.js'
text = read(path)
text = text.replace(
    "import { createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController } from './features/sync/index.js';\nimport { createEditorSelectionReader, createPreviewSelectionReader, createSelectionFeedbackGuard, createSelectionHighlightSession, createSelectionRetryScheduler } from './features/sync/index.js';\nimport { createSelectionSyncController } from './sync/selection-controller.js';",
    "import { createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController } from './features/sync/index.js';\nimport { createEditorSelectionReader, createPreviewSelectionReader, createSelectionFeedbackGuard, createSelectionHighlightSession, createSelectionRetryScheduler, createSelectionSyncController } from './features/sync/index.js';",
    1
)
text = text.replace(
    "import { configureHybridImageSourcePlatform } from './features/hybrid-editor/index.js';",
    "import { configureHybridImageSourcePlatform, configureHybridSyncCapabilities } from './features/hybrid-editor/index.js';",
    1
)
text = text.replace(
    "  if (compatibilityPlatformHost?.markdownEditorSelectionMapping === selectionMappingApi) {\n    delete compatibilityPlatformHost.markdownEditorSelectionMapping;\n  }\n",
    '',
    1
)
text = text.replace("if (compatibilityPlatformHost) compatibilityPlatformHost.markdownEditorSelectionMapping = selectionMappingApi;\n\n", '', 1)
text = text.replace("  '/app/scroll-sync.js',\n", '', 1)
text = text.replace(
    "  const virtualEditor = createVirtualEditor(editorHost);\n  const previewHost = document.getElementById('preview');\n  if (!previewHost) throw new Error('Preview host is missing');\n  const scrollController = createScrollSyncController(editorHost, previewHost, {\n    requestFrame: callback => window.requestAnimationFrame(callback),\n    cancelFrame: frameId => window.cancelAnimationFrame(frameId)\n  });\n  window.markdownEditorScrollController = scrollController;\n  window.markdownEditorScrollSync = scrollController.getPublicApi();",
    "  const previewHost = document.getElementById('preview');\n  if (!previewHost) throw new Error('Preview host is missing');\n  const scrollController = createScrollSyncController(editorHost, previewHost, {\n    requestFrame: callback => window.requestAnimationFrame(callback),\n    cancelFrame: frameId => window.cancelAnimationFrame(frameId)\n  });\n  const virtualEditor = createVirtualEditor(editorHost, { scrollSync: scrollController.getPublicApi() });",
    1
)
old_selection = """  if (compatibilityPlatformHost) {
    compatibilityPlatformHost.markdownEditorEditorSelectionReader = editorSelectionReader;
    compatibilityPlatformHost.markdownEditorPreviewSelectionReader = previewSelectionReader;
    compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard = selectionFeedbackGuard;
    compatibilityPlatformHost.markdownEditorSelectionHighlightSession = selectionHighlightSession;
  }
  const selectionController = createSelectionSyncController(editorHost, previewHost, {
    editorSelectionReader,
    previewSelectionReader,
    feedbackGuard: selectionFeedbackGuard,
    highlightSession: selectionHighlightSession,
    retryScheduler: selectionRetryScheduler
  });
  window.markdownEditorSelectionController = selectionController;
  const destroySelectionReaders = () => {
    selectionController.stop();
    if (compatibilityPlatformHost?.markdownEditorEditorSelectionReader === editorSelectionReader) {
      delete compatibilityPlatformHost.markdownEditorEditorSelectionReader;
    }
    if (compatibilityPlatformHost?.markdownEditorPreviewSelectionReader === previewSelectionReader) {
      delete compatibilityPlatformHost.markdownEditorPreviewSelectionReader;
    }
    if (compatibilityPlatformHost?.markdownEditorSelectionFeedbackGuard === selectionFeedbackGuard) {
      delete compatibilityPlatformHost.markdownEditorSelectionFeedbackGuard;
    }
    if (compatibilityPlatformHost?.markdownEditorSelectionHighlightSession === selectionHighlightSession) {
      delete compatibilityPlatformHost.markdownEditorSelectionHighlightSession;
    }
    selectionRetryScheduler.destroy();
    selectionHighlightSession.destroy();
    selectionFeedbackGuard.destroy();
    previewSelectionReader.destroy();
    editorSelectionReader.destroy();
  };
  window.addEventListener('pagehide', destroySelectionReaders, { once: true });
"""
new_selection = """  let selectionController = null;
  let selectionSyncDestroyed = false;
  const destroySelectionSync = () => {
    if (selectionSyncDestroyed) return;
    selectionSyncDestroyed = true;
    configureHybridSyncCapabilities(null);
    selectionController?.destroy();
    selectionController = null;
    selectionRetryScheduler.destroy();
    selectionHighlightSession.destroy();
    selectionFeedbackGuard.destroy();
    previewSelectionReader.destroy();
    editorSelectionReader.destroy();
  };
  window.addEventListener('pagehide', destroySelectionSync, { once: true });
"""
if text.count(old_selection) != 1:
    raise SystemExit('main legacy selection composition marker missing')
text = text.replace(old_selection, new_selection, 1)
# Destroy selection before its model/mappers.
text = text.replace(
    "    documentFeaturesDestroyed = true;\n",
    "    documentFeaturesDestroyed = true;\n    destroySelectionSync();\n",
    1
)
# Insert final mapper/controller before Preview creation, where preview variables and Outline already exist.
marker = "  try {\n    previewRenderer = createPreviewRendererPort({"
insert = """  const previewVirtualGeometry = Object.freeze({
    get active() { return Boolean(previewCommandHandler?.port?.virtual?.active); },
    getMountedAnchors: () => previewCommandHandler?.port?.virtual?.getMountedAnchors?.() || [],
    getMetrics: () => previewCommandHandler?.port?.virtual?.getMetrics?.() || [],
    getContentYForLine: line => previewCommandHandler?.port?.virtual?.getContentYForLine?.(line) ?? null,
    getLineForContentY: y => previewCommandHandler?.port?.virtual?.getLineForContentY?.(y) ?? null,
    containsLineRange: (from, to) => previewCommandHandler?.port?.virtual?.containsLineRange?.(from, to) ?? true,
    hasLineRangeMounted: (from, to) => previewCommandHandler?.port?.virtual?.hasLineRangeMounted?.(from, to) ?? true,
    ensureLineRangeVisible: (from, to) => previewCommandHandler?.port?.virtual?.ensureLineRangeVisible?.(from, to) ?? null,
    ensureLineVisible: line => previewCommandHandler?.port?.virtual?.ensureLineVisible?.(line) ?? null
  });
  const previewView = previewHost.ownerDocument?.defaultView;
  const PreviewResizeObserver = previewView?.ResizeObserver;
  previewScrollMapper = createPreviewScrollMapper({
    previewElement: previewHost,
    virtualApi: previewVirtualGeometry,
    createResizeObserver: typeof PreviewResizeObserver === 'function'
      ? callback => new PreviewResizeObserver(callback)
      : null,
    setTimer: previewView.setTimeout.bind(previewView),
    clearTimer: previewView.clearTimeout.bind(previewView),
    onGeometryChanged: () => scrollController.notifyGeometryChanged('preview')
  });
  selectionController = createSelectionSyncController(editorHost, previewHost, {
    editorApi: virtualEditor,
    documentModel,
    editorMapper: editorScrollMapper,
    getPreviewMapper: () => previewScrollMapper,
    getPreviewVirtual: () => previewVirtualGeometry,
    focusPreviewLine: (line, options) => previewController?.focusLine?.(line, options) || false,
    editorSelectionReader,
    previewSelectionReader,
    feedbackGuard: selectionFeedbackGuard,
    highlightSession: selectionHighlightSession,
    retryScheduler: selectionRetryScheduler,
    selectionMapping: selectionMappingApi,
    scrollController,
    documentRef: document,
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
    now: () => performance.now(),
    isHybridLayout: () => layoutState.snapshot.mode === 'hybrid',
    updateActiveLine: line => outlineController?.updateActiveLine?.(line),
    record: (operation, entry) => window.markdownEditorPerf?.record?.(operation, entry),
    diagnostic: (operation, entry) => window.markdownEditorPerf?.diagnostic?.(operation, entry)
  });

  try {
    previewRenderer = createPreviewRendererPort({"""
if text.count(marker) != 1:
    raise SystemExit('main Preview composition insertion marker missing')
text = text.replace(marker, insert, 1)
text = text.replace('      selectionController: window.markdownEditorSelectionController,', '      selectionController,', 1)
# Remove duplicate mapper construction after PreviewController start.
duplicate_mapper = """    const previewView = previewHost.ownerDocument?.defaultView;
    const PreviewResizeObserver = previewView?.ResizeObserver;
    previewScrollMapper = createPreviewScrollMapper({
      previewElement: previewHost,
      virtualApi: previewCommandHandler.port.virtual,
      createResizeObserver: typeof PreviewResizeObserver === 'function'
        ? callback => new PreviewResizeObserver(callback)
        : null,
      setTimer: previewView.setTimeout.bind(previewView),
      clearTimer: previewView.clearTimeout.bind(previewView),
      onGeometryChanged: () => scrollController.notifyGeometryChanged('preview')
    });
    if (compatibilityPlatformHost) compatibilityPlatformHost.markdownEditorPreviewScrollMapper = previewScrollMapper;
"""
if text.count(duplicate_mapper) != 1:
    raise SystemExit('main duplicate PreviewScrollMapper marker missing')
text = text.replace(duplicate_mapper, '', 1)
# Replace old one-command registration + controller configure with final sync composition.
old_registration = """    unregisterPreviewEditorCommands = editorUiCommandPort.register({
      focusPreviewLineForOutline: (line, options) => previewController.focusLine(line, options)
    });
    window.markdownEditorSelectionController.configure({
      isPreviewVirtualized: () => previewController.isVirtualActive()
    });
    configurePerformanceRuntimeStats(() => ({
      virtualPreview: previewController?.getVirtualStats?.() || null,
      backgroundTasks: backgroundTaskScheduler.getStats().pending
    }));
"""
new_registration = """    const scrollPreviewToLine = (line, behavior = 'auto', viewportRatio = 0.38) => {
      const ratio = Math.max(0.05, Math.min(0.95, Number(viewportRatio) || 0.38));
      const contentY = previewScrollMapper.getContentYForLine(line);
      return scrollController.scrollTo('preview', contentY - previewHost.clientHeight * ratio, {
        behavior,
        reason: 'preview-line-navigation',
        suspendMs: behavior === 'smooth' ? 420 : 180,
        settleMs: behavior === 'smooth' ? 900 : 700
      });
    };
    unregisterPreviewEditorCommands = editorUiCommandPort.register({
      focusPreviewLineForOutline: (line, options) => previewController.focusLine(line, options),
      preparePreviewEditorMetrics: () => scrollController.notifyGeometryChanged('editor'),
      invalidatePreviewAnchorMetrics: () => previewScrollMapper.invalidateMetrics(),
      invalidatePreviewAnchorStructure: () => previewScrollMapper.invalidateStructure(),
      annotatePreviewSourceLines: (source, tokens, blocks) => previewScrollMapper.annotateSourceLines(source, tokens, blocks),
      refreshPreviewAnchorStructure: () => previewScrollMapper.refreshStructure(),
      getPreviewAnchorMetrics: () => previewScrollMapper.getMetrics(),
      getPreviewAnchorCount: () => previewScrollMapper.getAnchorCount(),
      scrollPreviewToLine,
      syncEditorSelectionToPreview: (shouldScroll = false, reason = 'compatibility') => selectionController.syncEditorToPreview(shouldScroll, reason)
    });
    scrollController.configure({
      syncFromEditor: () => {
        const contentY = editorHost.scrollTop + editorHost.clientHeight * 0.38;
        const sourceLine = editorScrollMapper.getLineAtContentY(contentY);
        const targetY = previewScrollMapper.getContentYForLine(sourceLine);
        scrollController.scheduleTarget('preview', targetY - previewHost.clientHeight * 0.38, { reason: 'linked-scroll' });
        outlineController?.updateActiveLine?.(Math.max(1, Math.floor(sourceLine)));
      },
      syncFromPreview: () => {
        const sourceLine = previewScrollMapper.getLineForContentY(previewHost.scrollTop + previewHost.clientHeight * 0.38);
        const targetY = editorScrollMapper.getContentYForLine(sourceLine);
        scrollController.scheduleTarget('editor', targetY - editorHost.clientHeight * 0.38, { reason: 'linked-scroll' });
        outlineController?.updateActiveLine?.(Math.max(1, Math.floor(sourceLine)));
      }
    });
    configureHybridSyncCapabilities({
      markProgrammaticScroll: (surface, durationMs) => scrollController.markProgrammaticScroll(surface, durationMs),
      notifyScrollGeometry: surface => scrollController.notifyGeometryChanged(surface),
      notifySelectionGeometry: reason => selectionController.notifyEditorGeometry(reason)
    });
    selectionController.start();
    configurePerformanceRuntimeStats(() => ({
      classifyScrollTarget: target => scrollController.classifyScrollTarget(target),
      scrollSync: scrollController.getState(),
      selectionSync: selectionController?.getState?.() || null,
      virtualPreview: previewController?.getVirtualStats?.() || null,
      backgroundTasks: backgroundTaskScheduler.getStats().pending
    }));
"""
if text.count(old_registration) != 1:
    raise SystemExit('main sync registration marker missing')
text = text.replace(old_registration, new_registration, 1)
# Preview shell source annotation accepts exact blocks.
text = text.replace('      annotatePreviewSourceLines(source, tokens) {\n        if (editorUiCommandPort.has(\'annotatePreviewSourceLines\')) return editorUiCommandPort.invoke(\'annotatePreviewSourceLines\', source, tokens);',
                    '      annotatePreviewSourceLines(source, tokens, blocks) {\n        if (editorUiCommandPort.has(\'annotatePreviewSourceLines\')) return editorUiCommandPort.invoke(\'annotatePreviewSourceLines\', source, tokens, blocks);', 1)
write(path, text)

# Remove the two obsolete production authorities.
for old_path in ['public/app/scroll-sync.js', 'src/sync/selection-controller.js']:
    Path(old_path).unlink()

# Production inventory: remove legacy authority, migrate controller path and add explicit Hybrid sync capability.
path = 'tests/architecture/fixtures/production-modules.json'
data = json.loads(read(path))
modules = data['modules']
remove_paths = {'public/app/scroll-sync.js', 'src/sync/selection-controller.js'}
modules = [entry for entry in modules if entry[0] not in remove_paths]
modules.append([
    'src/features/sync/selection/selection-sync-controller.js', 'esm-module', 'sync-selection',
    'Final Stage 9 bidirectional selection orchestrator composing Readers, frozen mapping, Highlight, Feedback and Retry owners through explicit injected capabilities without fallback text search.',
    'selection-sync-controller-orchestration', 'explicit-instance', 'retain', False
])
modules.append([
    'src/features/hybrid-editor/runtime/hybrid-sync-capabilities.js', 'esm-module', 'hybrid-editor-runtime',
    'Explicit composition-configured Hybrid-to-Sync capability boundary replacing hidden scroll/selection controller window globals without owning synchronization policy.',
    'hybrid-sync-capability-reference', 'module-lifecycle', 'retain', False
])
# Update affected descriptions.
for entry in modules:
    if entry[0] == 'src/features/sync/index.js':
        entry[3] = 'Public Stage 9 Sync contract exposing final scroll and selection owners through R9-12; frozen selection mapping remains composition-injected from model-kernel.'
    elif entry[0] == 'src/features/sync/scroll/preview-scroll-mapper.js':
        entry[3] = 'Preview source-line/content-Y mapper owning exact render-metadata source annotation, anchor/metric cache and preview-body observation while delegating virtual height-index reads.'
    elif entry[0] == 'src/main.js':
        entry[3] = 'Production composition root wiring final Stage 9 scroll/selection owners and frozen model-kernel mapping through explicit instances without Sync window globals or the classic scroll-sync script.'
    elif entry[0] == 'src/editor/virtual-editor.js':
        entry[3] = 'Textarea-compatible virtual-editor facade delegating CodeMirror runtime to the adapter and consuming explicitly injected scroll synchronization capability without window Sync globals.'
    elif entry[0] == 'src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js':
        entry[3] = 'Per-editor coalesced widget geometry refresh scheduler using the explicit Hybrid Sync capability for scroll/selection geometry notifications.'
modules.sort(key=lambda entry: entry[0])
data['modules'] = modules
write(path, json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')

# Root README candidate; final validator fills actual Node count.
write('README.md', """# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-12：删除 classic scroll-sync 与旧 Selection Controller；最终 Sync 仅用模块化 Mapper/Controller、frozen mapping 和显式能力，移除文本搜索/全文 editor.value fallback 与 Sync window globals。验证待权威 CI 完成后记录。
""")
