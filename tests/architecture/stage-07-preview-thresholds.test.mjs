import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.1 keeps the preview threshold owner and scoped classic read port intact', async () => {
  const entries = (await readdir(new URL('src/features/preview/', root), { withFileTypes: true })).map(entry => entry.name).sort();
  const pipelineEntries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('index.js'));
  assert.ok(entries.includes('pipeline'));
  assert.ok(entries.includes('compatibility'));
  assert.ok(pipelineEntries.includes('preview-thresholds.js'));
  assert.ok(pipelineEntries.includes('preview-mode-resolver.js'));
  assert.ok((await readdir(new URL('src/features/preview/compatibility/', root))).includes('classic-preview-thresholds-port.js'));
  const thresholds = await source('src/features/preview/pipeline/preview-thresholds.js');
  assert.doesNotMatch(thresholds, /^import\s/m);
  assert.doesNotMatch(thresholds, /\bwindow\b|\bdocument\b|localStorage|sessionStorage/);
  assert.match(thresholds, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  const publicEntry = await source('src/features/preview/index.js');
  assert.match(publicEntry, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(publicEntry, /mountClassicPreviewThresholdsPort/);
});

test('Atomic 7.1 callers still read one canonical threshold object after Atomic 7.14 removes classic preview ownership', async () => {
  const [main, core, handler, engine] = await Promise.all([
    source('src/main.js'), source('public/app/core.js'),
    source('src/features/preview/application/preview-command-handler.js'),
    source('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.match(main, /mountClassicPreviewThresholdsPort/);
  assert.match(main, /previewThresholdsPort\.destroy\(\)/);
  assert.match(handler, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(handler, /thresholds:\s*PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(core, /markdownEditorPreviewCommandPort/);
  assert.match(core, /const corePreviewBehaviorThresholds = corePreviewCommandPort\.thresholds/);
  assert.match(engine, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  for (const value of [main, core, handler, engine]) assert.doesNotMatch(value, /window\.markdownEditorPreviewThresholds/);
});

test('Atomic 7.1 keeps one threshold authority across virtual, Worker and enhancement owners after Atomic 7.14', async () => {
  const [core, controller, virtualPreview, worker, enhancementCoordinator, main] = await Promise.all([
    source('public/app/core.js'),
    source('src/features/preview/application/preview-controller.js'),
    source('src/features/preview/virtual/virtual-preview-controller.js'),
    source('src/features/preview/worker/preview-worker.js'),
    source('src/features/preview/pipeline/preview-enhancement-coordinator.js'),
    source('src/main.js')
  ]);
  assert.doesNotMatch(core, /VIRTUAL_PREVIEW_BLOCK_THRESHOLD|sourceLength\s*>=\s*1000000|blockCount\s*>=\s*12000/);
  assert.doesNotMatch(controller, /PREVIEW_LAYOUT_MAX_ATTEMPTS|PREVIEW_LAYOUT_STABLE_FRAMES|MIN_CHAPTER_PREVIEW_BLOCKS/);
  assert.doesNotMatch(controller, /sourceLength\s*>=\s*100000\b|timeout:\s*260\b|timeout:\s*700\b/);
  assert.doesNotMatch(virtualPreview, /DEFAULT_OVERSCAN_PX|MIN_WINDOW_BLOCKS|MAX_WINDOW_BLOCKS|PREWARM_BLOCK_LIMIT/);
  assert.doesNotMatch(worker, /PRIORITY_BLOCK_LIMIT|PRIORITY_CHAR_LIMIT/);
  assert.doesNotMatch(enhancementCoordinator, /timeout:\s*180\b|fallbackMs:\s*16\b|minimumTimeRemainingMs:\s*3\b|setTimeout\s*\(/);
  assert.match(virtualPreview, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(worker, /preview-thresholds\.js/);
  assert.doesNotMatch(enhancementCoordinator, /PREVIEW_BEHAVIOR_THRESHOLDS|preview-thresholds/);
  assert.match(main, /thresholds:\s*PREVIEW_BEHAVIOR_THRESHOLDS\.scheduling\.enhancement/);
});

test('Atomic 7.1 threshold ownership remains isolated after the Atomic 7.14 application cutover', async () => {
  const [thresholds, controller, engine, handler] = await Promise.all([
    source('src/features/preview/pipeline/preview-thresholds.js'),
    source('src/features/preview/application/preview-controller.js'),
    source('src/features/preview/pipeline/preview-render-engine.js'),
    source('src/features/preview/application/preview-command-handler.js')
  ]);
  assert.doesNotMatch(thresholds, /preview-controller|preview-render-engine|preview-command-handler/);
  assert.match(controller, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(engine, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(handler, /PREVIEW_BEHAVIOR_THRESHOLDS/);
});
