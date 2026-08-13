import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.1 keeps the preview threshold owner and scoped classic read port intact', async () => {
  const entries = (await readdir(new URL('src/features/preview/', root), { withFileTypes: true }))
    .map(entry => entry.name)
    .sort();
  const pipelineEntries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();

  assert.ok(entries.includes('index.js'));
  assert.ok(entries.includes('pipeline'));
  assert.ok(entries.includes('compatibility'));
  assert.ok(pipelineEntries.includes('preview-thresholds.js'));
  assert.ok(pipelineEntries.includes('preview-mode-resolver.js'));
  assert.ok(
    (await readdir(new URL('src/features/preview/compatibility/', root))).includes('classic-preview-thresholds-port.js')
  );

  const thresholds = await source('src/features/preview/pipeline/preview-thresholds.js');
  assert.doesNotMatch(thresholds, /^import\s/m);
  assert.doesNotMatch(thresholds, /\bwindow\b|\bdocument\b|localStorage|sessionStorage/);
  assert.match(thresholds, /PREVIEW_BEHAVIOR_THRESHOLDS/);

  const publicEntry = await source('src/features/preview/index.js');
  assert.match(publicEntry, /PREVIEW_BEHAVIOR_THRESHOLDS/);
  assert.match(publicEntry, /mountClassicPreviewThresholdsPort/);
});

test('Atomic 7.1 classic callers consume the scoped threshold port without a new window global or cross-script lexical collision', async () => {
  const main = await source('src/main.js');
  const core = await source('public/app/core.js');
  const preview = await source('public/app/preview.js');

  assert.match(main, /mountClassicPreviewThresholdsPort/);
  assert.match(main, /previewThresholdsPort\.destroy\(\)/);
  assert.match(core, /markdownEditorPreviewThresholdsPort/);
  assert.match(core, /corePreviewThresholdsPort\.snapshot/);
  assert.match(core, /const corePreviewBehaviorThresholds = corePreviewThresholdsPort\.snapshot/);
  assert.match(preview, /markdownEditorPreviewThresholdsPort/);
  assert.match(preview, /previewThresholdsPort\.snapshot/);
  assert.match(preview, /const classicPreviewBehaviorThresholds = previewThresholdsPort\.snapshot/);
  assert.doesNotMatch(core, /const previewBehaviorThresholds\b/);
  assert.doesNotMatch(preview, /const previewBehaviorThresholds\b/);

  for (const value of [main, core, preview]) {
    assert.doesNotMatch(value, /window\.markdownEditorPreviewThresholds/);
  }
});

test('Atomic 7.1 removes independent preview mode, window, chapter and worker threshold owners from legacy modules', async () => {
  const core = await source('public/app/core.js');
  const preview = await source('public/app/preview.js');
  const virtualPreview = await source('src/preview/virtual-preview.js');
  const worker = await source('src/preview/preview-worker.js');
  const enhancementQueue = await source('src/preview/enhancement-queue.js');

  assert.doesNotMatch(core, /VIRTUAL_PREVIEW_BLOCK_THRESHOLD|sourceLength\s*>=\s*1000000|blockCount\s*>=\s*12000/);
  assert.doesNotMatch(preview, /PREVIEW_LAYOUT_MAX_ATTEMPTS|PREVIEW_LAYOUT_STABLE_FRAMES|MIN_CHAPTER_PREVIEW_BLOCKS/);
  assert.doesNotMatch(preview, /sourceLength\s*>=\s*100000\b|editor\.textLength\s*<\s*100000\b|timeout:\s*260\b|timeout:\s*700\b/);
  assert.doesNotMatch(virtualPreview, /DEFAULT_OVERSCAN_PX|MIN_WINDOW_BLOCKS|MAX_WINDOW_BLOCKS|PREWARM_BLOCK_LIMIT/);
  assert.doesNotMatch(virtualPreview, /sourceLength\s*>=\s*400000\b|blocks\.length\s*>=\s*1400\b/);
  assert.doesNotMatch(worker, /PRIORITY_BLOCK_LIMIT|PRIORITY_CHAR_LIMIT/);
  assert.doesNotMatch(enhancementQueue, /timeout:\s*180\b|setTimeout\([^\n]*,\s*16\)|timeRemaining\(\)\s*<\s*3\b/);

  assert.match(virtualPreview, /\.\.\/features\/preview\/index\.js/);
  assert.match(worker, /\.\.\/features\/preview\/index\.js/);
  assert.match(enhancementQueue, /\.\.\/features\/preview\/index\.js/);
});

test('Atomic 7.1 remains frozen while Atomic 7.2-7.4 may add PreviewState, Mode Resolver and Scheduler/Cancellation but not Atomic 7.5+ owners', async () => {
  const featureTree = JSON.stringify({
    root: (await readdir(new URL('src/features/preview/', root))).sort(),
    application: (await readdir(new URL('src/features/preview/application/', root))).sort(),
    pipeline: (await readdir(new URL('src/features/preview/pipeline/', root))).sort()
  });

  assert.match(featureTree, /preview-state/);
  for (const premature of [
    'preview-controller',
    'preview-worker-protocol',
    'preview-worker-session',
    'preview-render-coordinator',
    'virtual-preview-controller'
  ]) {
    assert.doesNotMatch(featureTree, new RegExp(premature));
  }
});
