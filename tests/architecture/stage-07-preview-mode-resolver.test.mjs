import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.3 Mode Resolver is a dedicated pure pipeline owner', async () => {
  const pipelineEntries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(pipelineEntries.includes('preview-mode-resolver.js'));
  assert.ok(pipelineEntries.includes('preview-thresholds.js'));

  const resolver = await source('src/features/preview/pipeline/preview-mode-resolver.js');
  assert.match(resolver, /from '\.\/preview-thresholds\.js'/);
  assert.match(resolver, /normalizePreviewModeSetting/);
  assert.match(resolver, /resolvePreviewMode/);
  assert.match(resolver, /previewPerformanceMode/);
  assert.doesNotMatch(resolver, /window\.|document\.|localStorage|sessionStorage|requestAnimationFrame\s*\(|setTimeout\s*\(|new\s+Worker\s*\(/);
  assert.doesNotMatch(resolver, /workerChars/);
});

test('Atomic 7.3 preserves manual override before automatic character or block thresholds', async () => {
  const resolver = await source('src/features/preview/pipeline/preview-mode-resolver.js');
  const manual = resolver.indexOf("if (requested !== 'auto') return requested;");
  const chapter = resolver.indexOf('thresholds.chapterChars');
  const virtual = resolver.indexOf('thresholds.virtualChars');
  assert.ok(manual >= 0 && chapter > manual && virtual > manual);
});

test('Atomic 7.3 classic callers consume the scoped resolver port and no longer own resolver logic', async () => {
  const main = await source('src/main.js');
  const core = await source('public/app/core.js');
  const preview = await source('public/app/preview.js');
  const publicEntry = await source('src/features/preview/index.js');
  const port = await source('src/features/preview/compatibility/classic-preview-mode-resolver-port.js');

  assert.match(publicEntry, /normalizePreviewModeSetting/);
  assert.match(publicEntry, /resolvePreviewMode/);
  assert.match(publicEntry, /mountClassicPreviewModeResolverPort/);
  assert.match(port, /markdownEditorPreviewModeResolverPort/);
  assert.doesNotMatch(port, /window\.markdownEditorPreviewModeResolver/);

  assert.match(main, /mountClassicPreviewModeResolverPort/);
  assert.match(main, /previewModeResolverPort\.destroy\(\)/);
  assert.match(core, /markdownEditorPreviewModeResolverPort/);
  assert.match(core, /corePreviewModeResolverPort\.normalizeSetting/);
  assert.match(preview, /markdownEditorPreviewModeResolverPort/);
  assert.match(preview, /previewModeResolverPort\.normalizeSetting/);
  assert.match(preview, /previewModeResolverPort\.resolve/);

  assert.doesNotMatch(core, /function normalizePreviewPerformanceMode/);
  assert.doesNotMatch(core, /function resolvePreviewPerformanceMode/);
  assert.doesNotMatch(preview, /\bresolvePreviewPerformanceMode\b|\bnormalizePreviewPerformanceMode\b/);
});

test('Atomic 7.3 remains intact while Atomic 7.4 may add Scheduler/Cancellation but not Atomic 7.5+ Preview owners', async () => {
  const featureTree = JSON.stringify({
    root: (await readdir(new URL('src/features/preview/', root))).sort(),
    application: (await readdir(new URL('src/features/preview/application/', root))).sort(),
    pipeline: (await readdir(new URL('src/features/preview/pipeline/', root))).sort()
  });

  for (const premature of [
    'preview-controller',
    'preview-worker-protocol',
    'preview-worker-session',
    'virtual-preview-controller',
    'preview-focus-controller',
    'preview-dom-renderer'
  ]) {
    assert.doesNotMatch(featureTree, new RegExp(premature));
  }
});
