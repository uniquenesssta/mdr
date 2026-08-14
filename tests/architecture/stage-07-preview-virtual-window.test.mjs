import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

const virtualFiles = [
  'height-cache.js',
  'spacer-view.js',
  'virtual-window-controller.js',
  'virtual-window-model.js'
];

test('Atomic 7.10 creates the taskbook Virtual Window module boundary exactly once', async () => {
  const entries = (await readdir(new URL('src/features/preview/render/virtual-window/', root))).sort();
  assert.deepEqual(entries, virtualFiles);
  const entry = await source('src/features/preview/index.js');
  for (const token of ['createVirtualWindowController', 'createVirtualWindowModel', 'createVirtualHeightCache', 'createVirtualSpacerView']) {
    assert.match(entry, new RegExp(token));
  }
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

  for (const dependency of ['./height-cache.js', './spacer-view.js', './virtual-window-model.js']) {
    assert.match(controller, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(controller, /renderWindow/);
  assert.match(controller, /measureMountedBlocks/);
  assert.doesNotMatch(controller, /window\.|document\.|localStorage|sessionStorage|markdownEditorScroll|markdownEditorSelection|markdownEditorVirtualPreview/);
});

test('Atomic 7.10 turns the legacy VirtualPreview module into a browser capability adapter instead of a second window owner', async () => {
  const legacy = await source('src/preview/virtual-preview.js');
  assert.match(legacy, /extends VirtualWindowController/);
  assert.match(legacy, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(legacy, /createVirtualPreviewController/);
  assert.match(legacy, /cancelIdle/);
  for (const migrated of [
    'calculateWindow', 'rebuildOffsets', 'measureMountedBlocks', 'HEIGHT_CACHE_PREFIX',
    'findIndexAtOffset', 'estimateBlockHeight', 'virtual-preview-spacer-top'
  ]) assert.doesNotMatch(legacy, new RegExp(migrated));
});

test('Atomic 7.10 keeps 7.11 Focus and later Enhancement ownership out of the new Virtual Window modules', async () => {
  const bodies = await Promise.all(virtualFiles.map(file => source(`src/features/preview/render/virtual-window/${file}`)));
  const combined = bodies.join('\n');
  assert.doesNotMatch(combined, /preview-focus-controller|preview-enhancement-coordinator|scrollPreviewToLine|focusSection|markdownEditorScrollSync/);
  const featureTree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.doesNotMatch(featureTree, /preview-focus-controller|preview-enhancement-coordinator/);
});
