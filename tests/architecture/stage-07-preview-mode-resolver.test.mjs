import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.3 Mode Resolver remains a dedicated pure pipeline owner', async () => {
  const entries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('preview-mode-resolver.js'));
  assert.ok(entries.includes('preview-thresholds.js'));
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

test('Atomic 7.3 remains the only mode policy after Atomic 7.14 removes classic preview resolver logic', async () => {
  const [main, core, entry, port, handler, engine] = await Promise.all([
    source('src/main.js'), source('public/app/core.js'), source('src/features/preview/index.js'),
    source('src/features/preview/compatibility/classic-preview-mode-resolver-port.js'),
    source('src/features/preview/application/preview-command-handler.js'),
    source('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.match(entry, /normalizePreviewModeSetting/);
  assert.match(entry, /resolvePreviewMode/);
  assert.match(port, /markdownEditorPreviewModeResolverPort/);
  assert.doesNotMatch(port, /window\.markdownEditorPreviewModeResolver/);
  assert.match(main, /mountClassicPreviewModeResolverPort/);
  assert.match(main, /previewModeResolverPort\.destroy\(\)/);
  assert.match(core, /corePreviewCommandPort\.normalizePerformanceMode/);
  assert.match(handler, /normalizePreviewModeSetting/);
  assert.match(handler, /resolvePreviewMode/);
  assert.match(engine, /normalizePreviewModeSetting/);
  assert.match(engine, /resolvePreviewMode/);
  assert.doesNotMatch(core, /function normalizePreviewPerformanceMode|function resolvePreviewPerformanceMode/);
});

test('Atomic 7.3 policy remains pure while Atomic 7.14 Controller and RenderEngine consume it', async () => {
  const [resolver, handler, engine] = await Promise.all([
    source('src/features/preview/pipeline/preview-mode-resolver.js'),
    source('src/features/preview/application/preview-command-handler.js'),
    source('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.doesNotMatch(resolver, /preview-controller|preview-render-engine|preview-command-handler/);
  assert.match(handler, /resolvePreviewMode/);
  assert.match(engine, /resolvePreviewMode/);
});
