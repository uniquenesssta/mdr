import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

async function read(path) { return readFile(new URL(`../../${path}`, import.meta.url), 'utf8'); }
async function exists(path) {
  try { await access(new URL(`../../${path}`, import.meta.url), constants.F_OK); return true; }
  catch { return false; }
}

test('R9-12 removes the classic scroll-sync script and migrates SelectionSyncController to the Stage 9 feature boundary', async () => {
  assert.equal(await exists('public/app/scroll-sync.js'), false);
  assert.equal(await exists('src/sync/selection-controller.js'), false);
  assert.equal(await exists('src/features/sync/selection/selection-sync-controller.js'), true);
  const facade = await read('src/features/sync/index.js');
  assert.match(facade, /selection\/selection-sync-controller\.js/);
  assert.match(facade, /SelectionSyncController/);
  assert.match(facade, /createSelectionSyncController/);
});

test('R9-12 classic loader and composition root no longer publish scroll or selection sync controllers on window', async () => {
  const main = await read('src/main.js');
  assert.doesNotMatch(main, /['"]\/app\/scroll-sync\.js['"]/);
  assert.doesNotMatch(main, /window\.markdownEditorScrollController/);
  assert.doesNotMatch(main, /window\.markdownEditorScrollSync/);
  assert.doesNotMatch(main, /window\.markdownEditorSelectionController/);
  assert.doesNotMatch(main, /markdownEditorSelectionMapping/);
  assert.match(main, /selectionMapping:\s*selectionMappingApi/);
  assert.match(main, /createSelectionSyncController/);
});

test('R9-12 sync production code has no implicit full-editor value access or legacy text-search/estimation fallback', async () => {
  const paths = [
    'src/features/sync/selection/selection-sync-controller.js',
    'src/features/sync/scroll/preview-scroll-mapper.js',
    'src/features/sync/scroll/editor-scroll-mapper.js',
    'src/features/sync/scroll/scroll-sync-controller.js',
    'src/features/sync/scroll/scroll-geometry-session.js'
  ];
  const combined = (await Promise.all(paths.map(read))).join('\n');
  assert.doesNotMatch(combined, /editor\.value|\.value\.slice\(|String\(editor\.value/);
  assert.doesNotMatch(combined, /buildNormalizedTextMap|buildNormalizedSourceMap|findMarkdownRangeForPreviewSelection|findNearestRawRange|estimateSourcePosition|estimatePreviewCodeSourcePosition|normalizeSearchText/);
  assert.doesNotMatch(combined, /createElement\(['"]canvas['"]\)|createElement\(['"]textarea['"]\)|measureText\(/);
  assert.doesNotMatch(combined, /lineHeights|lineOffsets|lineTopOffsets|split\(['"]\\n['"]\)/);
});

test('R9-12 PreviewScrollMapper owns source annotation from render metadata without lexer or fallback block inheritance', async () => {
  const source = await read('src/features/sync/scroll/preview-scroll-mapper.js');
  assert.match(source, /annotateSourceLines\(sourceText, tokens = \[\], blocks = \[\]\)/);
  assert.match(source, /normalizeBlockRange/);
  assert.doesNotMatch(source, /marked|lexer|presentation|inherit|fallbackLine|fallbackIndex/);
});

test('R9-12 final SelectionSyncController consumes frozen mapping API only through injected capability and never imports/copies the algorithm', async () => {
  const source = await read('src/features/sync/selection/selection-sync-controller.js');
  assert.doesNotMatch(source, /^import\s/m);
  assert.match(source, /selectionMapping\.createPreviewRangesForSourceSelection/);
  assert.match(source, /selectionMapping\.mapPreviewDomPointToSource/);
  assert.doesNotMatch(source, /createMarkdownSourceProjection|createPreviewDomProjection|alignProjectionTexts|SourceProjectionBuilder|DomProjectionBuilder/);
  assert.doesNotMatch(source, /window\.|globalThis\.window|document\./);
});

test('R9-12 frozen selection mapping implementation and model-kernel export remain unchanged by final cleanup', async () => {
  const mapping = await read('src/sync/selection-mapping.js');
  const kernel = await read('src/model-kernel/index.js');
  assert.match(mapping, /export const selectionMappingApi = Object\.freeze/);
  assert.match(kernel, /selectionMappingApi/);
  assert.match(kernel, /from '\.\.\/sync\/selection-mapping\.js'/);
});

test('R9-12 removes hidden sync globals from Virtual Editor, Hybrid integration and performance diagnostics', async () => {
  const paths = [
    'src/editor/virtual-editor.js',
    'src/editor/hybrid-markdown.js',
    'src/features/hybrid-editor/lifecycle/widget-geometry-scheduler.js',
    'src/runtime/performance.js'
  ];
  const combined = (await Promise.all(paths.map(read))).join('\n');
  assert.doesNotMatch(combined, /markdownEditorScrollSync|markdownEditorScrollController|markdownEditorSelectionController/);
  assert.match(await read('src/features/hybrid-editor/runtime/hybrid-sync-capabilities.js'), /configureHybridSyncCapabilities/);
});

test('R9-12 remaining classic callers use scoped editor UI commands instead of deleted sync globals', async () => {
  const core = await read('public/app/core.js');
  const clipper = await read('public/app/web-clipper.js');
  assert.match(core, /coreEditorUiCommandPort\.invoke\('preparePreviewEditorMetrics'\)/);
  assert.match(clipper, /webClipperEditorUiCommandPort\.invoke\('syncEditorSelectionToPreview'/);
  assert.doesNotMatch(clipper, /\bsyncEditorSelectionToPreview\(/);
});

test('R9-12 production inventory removes classic scroll-sync, replaces old controller path and contains the final sync modules exactly once', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(entry => entry.path);
  assert.equal(paths.includes('public/app/scroll-sync.js'), false);
  assert.equal(paths.includes('src/sync/selection-controller.js'), false);
  assert.equal(paths.filter(path => path === 'src/features/sync/selection/selection-sync-controller.js').length, 1);
  assert.equal(paths.filter(path => path === 'src/features/hybrid-editor/runtime/hybrid-sync-capabilities.js').length, 1);
  assert.equal(paths.length, 381);
});
