import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.7 keeps one DOM-free Render Coordinator pipeline owner', async () => {
  const entries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('preview-render-coordinator.js'));
  const [coordinator, entry] = await Promise.all([
    source('src/features/preview/pipeline/preview-render-coordinator.js'), source('src/features/preview/index.js')
  ]);
  assert.match(coordinator, /preview-mode-resolver\.js/);
  assert.match(coordinator, /preview-thresholds\.js/);
  for (const strategy of ['stable-reuse','dom-whole-document','virtual-mount','chapter-view','dom-incremental']) assert.match(coordinator, new RegExp(strategy));
  assert.match(entry, /createPreviewRenderCoordinator/);
  assert.doesNotMatch(coordinator, /window\.|document\.|querySelector|getElementById|localStorage|sessionStorage|createElement|replaceChildren|innerHTML/);
});

test('Atomic 7.7 composition root still owns and destroys one scoped classic coordinator port', async () => {
  const [main, entry, port] = await Promise.all([
    source('src/main.js'), source('src/features/preview/index.js'),
    source('src/features/preview/compatibility/classic-preview-render-coordinator-port.js')
  ]);
  assert.match(entry, /mountClassicPreviewRenderCoordinatorPort/);
  assert.match(port, /markdownEditorPreviewRenderCoordinatorPort/);
  assert.match(main, /const previewRenderCoordinator = createPreviewRenderCoordinator\(\)/);
  assert.match(main, /mountClassicPreviewRenderCoordinatorPort\(compatibilityPlatformHost, previewRenderCoordinator\)/);
  assert.match(main, /previewRenderCoordinatorPort\.destroy\(\)/);
  assert.match(main, /previewRenderCoordinator\.destroy\(\)/);
});

test('Atomic 7.7 RenderEngine delegates model-result strategy and execution to Render Coordinator after legacy preview deletion', async () => {
  const engine = await source('src/features/preview/pipeline/preview-render-engine.js');
  assert.match(engine, /renderCoordinator\.createPlan/);
  assert.match(engine, /renderCoordinator\.execute/);
  assert.doesNotMatch(engine, /function\s+getChapterPreviewResult\s*\(/);
  assert.doesNotMatch(engine, /function\s+resolvePreviewRenderResult\s*\(/);
});

test('Atomic 7.7 coordinator stays policy-only while Atomic 7.14 RenderEngine owns runtime orchestration', async () => {
  const [coordinator, engine] = await Promise.all([
    source('src/features/preview/pipeline/preview-render-coordinator.js'),
    source('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.doesNotMatch(coordinator, /preview-render-engine|querySelector|replaceChildren|Worker\s*\(/);
  assert.match(engine, /renderCoordinator\.execute/);
});
