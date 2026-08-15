import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const virtualFiles = ['height-cache.js','spacer-view.js','virtual-window-controller.js','virtual-window-model.js'];

test('Atomic 7.10 keeps the taskbook Virtual Window module boundary exactly once', async () => {
  const entries = (await readdir(new URL('src/features/preview/render/virtual-window/', root))).sort();
  assert.deepEqual(entries, virtualFiles);
  const entry = await source('src/features/preview/index.js');
  for (const token of ['createVirtualWindowController','createVirtualWindowModel','createVirtualHeightCache','createVirtualSpacerView']) assert.match(entry, new RegExp(token));
});

test('Atomic 7.10 separates pure window math, height cache and spacer DOM from block mounting', async () => {
  const [cache, spacer, controller, model] = await Promise.all(virtualFiles.map(file => source(`src/features/preview/render/virtual-window/${file}`)));
  assert.match(model, /calculateWindow/);
  assert.match(model, /windowForLineRange/);
  assert.doesNotMatch(model, /window\.|document\.|localStorage|sessionStorage|createElement|replaceChildren|ResizeObserver|\.scrollTop\b/);
  assert.match(cache, /estimateVirtualBlockHeight/);
  assert.match(cache, /setContext/);
  assert.match(cache, /recordMeasurement/);
  assert.doesNotMatch(cache, /window\.|document\.|localStorage|sessionStorage|createElement|replaceChildren|ResizeObserver/);
  assert.match(spacer, /virtual-preview-spacer-top/);
  assert.match(spacer, /virtual-preview-spacer-bottom/);
  assert.doesNotMatch(spacer, /scrollTop|clientHeight|offsetHeight|ResizeObserver|localStorage|sessionStorage/);
  for (const dependency of ['./height-cache.js','./spacer-view.js','./virtual-window-model.js']) assert.match(controller, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(controller, /renderWindow/);
  assert.match(controller, /measureMountedBlocks/);
  assert.doesNotMatch(controller, /window\.|document\.|localStorage|sessionStorage|markdownEditorScroll|markdownEditorSelection|markdownEditorVirtualPreview/);
});

test('Atomic 7.10 canonical Virtual Preview adapter is explicit and no longer lives under the legacy src/preview path', async () => {
  const adapter = await source('src/features/preview/virtual/virtual-preview-controller.js');
  assert.match(adapter, /extends VirtualWindowController/);
  assert.match(adapter, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(adapter, /createVirtualPreviewController/);
  assert.match(adapter, /scheduler/);
  assert.match(adapter, /selectionController/);
  assert.match(adapter, /scrollController/);
  for (const migrated of ['calculateWindow','rebuildOffsets','measureMountedBlocks','HEIGHT_CACHE_PREFIX','findIndexAtOffset','estimateBlockHeight','virtual-preview-spacer-top']) assert.doesNotMatch(adapter, new RegExp(migrated));
});

test('Atomic 7.10 keeps Focus, Enhancement and Atomic 7.14 application ownership out of Virtual Window internals', async () => {
  const bodies = await Promise.all(virtualFiles.map(file => source(`src/features/preview/render/virtual-window/${file}`)));
  const combined = bodies.join('\n');
  assert.doesNotMatch(combined, /preview-focus-controller|preview-enhancement-coordinator|preview-controller|preview-render-engine|scrollPreviewToLine|focusSection|markdownEditorScrollSync/);
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-focus-controller/);
  assert.match(tree, /preview-enhancement-coordinator/);
  assert.match(tree, /preview-controller/);
});
