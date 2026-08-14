import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.7 introduces one DOM-free Render Coordinator pipeline owner', async () => {
  const pipelineEntries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(pipelineEntries.includes('preview-render-coordinator.js'));
  const coordinator = await source('src/features/preview/pipeline/preview-render-coordinator.js');
  const entry = await source('src/features/preview/index.js');
  assert.match(coordinator, /preview-mode-resolver\.js/);
  assert.match(coordinator, /preview-thresholds\.js/);
  for (const strategy of ['stable-reuse', 'dom-whole-document', 'virtual-mount', 'chapter-view', 'dom-incremental']) {
    assert.match(coordinator, new RegExp(strategy));
  }
  assert.match(entry, /createPreviewRenderCoordinator/);
  assert.doesNotMatch(coordinator, /window\.|document\.|querySelector|getElementById|localStorage|sessionStorage|createElement|replaceChildren|innerHTML/);
});

test('Atomic 7.7 composition root mounts and destroys one scoped classic coordinator port', async () => {
  const main = await source('src/main.js');
  const entry = await source('src/features/preview/index.js');
  const port = await source('src/features/preview/compatibility/classic-preview-render-coordinator-port.js');
  assert.match(entry, /mountClassicPreviewRenderCoordinatorPort/);
  assert.match(port, /markdownEditorPreviewRenderCoordinatorPort/);
  assert.match(main, /const previewRenderCoordinator = createPreviewRenderCoordinator\(\)/);
  assert.match(main, /mountClassicPreviewRenderCoordinatorPort\(compatibilityPlatformHost, previewRenderCoordinator\)/);
  assert.match(main, /previewRenderCoordinatorPort\.destroy\(\)/);
  assert.match(main, /previewRenderCoordinator\.destroy\(\)/);
});

test('Atomic 7.7 classic preview delegates model-result strategy and chapter slicing to the coordinator', async () => {
  const preview = await source('public/app/preview.js');
  assert.match(preview, /markdownEditorPreviewRenderCoordinatorPort/);
  assert.match(preview, /previewRenderCoordinatorPort\.createPlan/);
  assert.match(preview, /previewRenderCoordinatorPort\.execute/);
  assert.doesNotMatch(preview, /function\s+getChapterPreviewResult\s*\(/);
  assert.doesNotMatch(preview, /function\s+resolvePreviewRenderResult\s*\(/);
});

test('Atomic 7.7 permits Atomic 7.9 Layout Stability but does not enter 7.10+ preview owners', async () => {
  const featureRoot = new URL('src/features/preview/', root);
  const entries = await readdir(featureRoot, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    paths.push(entry.name);
    if (!entry.isDirectory()) continue;
    for (const child of await readdir(new URL(`${entry.name}/`, featureRoot))) paths.push(`${entry.name}/${child}`);
  }
  const tree = paths.join('\n');
  for (const premature of [
    'virtual-preview-controller',
    'virtual-window-calculator',
    'preview-focus-controller',
    'preview-enhancement-coordinator'
  ]) assert.doesNotMatch(tree, new RegExp(premature));
});
