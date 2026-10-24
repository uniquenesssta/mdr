import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreviewMode } from '../../src/features/preview/index.js';

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

test('Atomic 7.3 preserves manual override before automatic character or block thresholds', () => {
  for (const mode of ['full', 'virtual', 'chapter']) {
    const settings = Object.freeze({ previewPerformanceMode: mode });
    assert.equal(resolvePreviewMode(settings, 1, 1), mode);
    assert.equal(resolvePreviewMode(settings, 2_000_000, 20_000), mode);
  }
});

test('Atomic 7.3 remains the only mode policy after Atomic 7.14 removes classic preview resolver logic', async () => {
  const [main, core, entry, port, handler, engine] = await Promise.all([
    source('src/main.js'), Promise.all([
      source('src/features/documents/ui/document-workspace.js'),
      source('src/features/menu/shell-menus.js'),
      source('src/features/persistence/ui/workspace-status.js'),
      source('src/features/layout/workspace-preferences.js')
    ]).then(sources => sources.join('\n')), source('src/features/preview/index.js'),
    source('src/features/preview/pipeline/preview-mode-resolver.js'),
    source('src/features/preview/application/preview-commands.js'),
    source('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.match(entry, /normalizePreviewModeSetting/);
  assert.match(entry, /resolvePreviewMode/);
  assert.doesNotMatch(port, /markdownEditorPreviewModeResolverPort/);
  assert.doesNotMatch(port, /window\.markdownEditorPreviewModeResolver/);
  assert.doesNotMatch(main, /mountClassicPreviewModeResolverPort/);
  assert.doesNotMatch(main, /previewModeResolverPort\.destroy\(\)/);
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
    source('src/features/preview/application/preview-commands.js'),
    source('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.doesNotMatch(resolver, /preview-controller|preview-render-engine|preview-command-handler/);
  assert.match(handler, /resolvePreviewMode/);
  assert.match(engine, /resolvePreviewMode/);
});
