import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.2 PreviewState is a dedicated DOM-free application state owner', async () => {
  const applicationEntries = (await readdir(new URL('src/features/preview/application/', root))).sort();
  assert.deepEqual(applicationEntries, ['preview-state.js']);

  const state = await source('src/features/preview/application/preview-state.js');
  assert.doesNotMatch(state, /^import\s/m);
  assert.doesNotMatch(state, /\bwindow\b|\bdocument\b|localStorage|sessionStorage|requestAnimationFrame|setTimeout|Worker\s*\(/);
  for (const field of ['mode', 'version', 'status', 'lastStableResult', 'focusSection', 'error']) {
    assert.match(state, new RegExp(`\\b${field}\\b`));
  }
  assert.match(state, /const STABLE_RESULT_FIELDS = new Set\(\[/);
  assert.match(state, /rejectUnknownFields\(result, STABLE_RESULT_FIELDS, 'Preview stable result'\)/);
  assert.match(state, /Preview State is destroyed/);
});

test('Atomic 7.2 exposes one scoped compatibility view of the canonical state and destroys it from composition root', async () => {
  const publicEntry = await source('src/features/preview/index.js');
  const port = await source('src/features/preview/compatibility/classic-preview-state-port.js');
  const main = await source('src/main.js');

  assert.match(publicEntry, /createPreviewState/);
  assert.match(publicEntry, /mountClassicPreviewStatePort/);
  assert.match(port, /markdownEditorPreviewStatePort/);
  assert.doesNotMatch(port, /window\.markdownEditorPreviewState/);
  assert.match(port, /return state\.snapshot/);
  assert.doesNotMatch(port, /let\s+snapshot\b|const\s+snapshot\s*=/);
  assert.match(main, /const previewState = createPreviewState\(\)/);
  assert.match(main, /mountClassicPreviewStatePort\(compatibilityPlatformHost, previewState\)/);
  assert.match(main, /previewStatePort\.destroy\(\)/);
  assert.match(main, /previewState\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorPreviewState/);
});

test('Atomic 7.2 removes migrated classic Preview runtime state authorities', async () => {
  const core = await source('public/app/core.js');
  const preview = await source('public/app/preview.js');
  const webClipper = await source('public/app/web-clipper.js');
  const editorTools = await source('public/app/editor-tools.js');

  for (const migrated of [
    'previewRenderVersion',
    'activeResolvedPreviewMode',
    'activePreviewScopeKey',
    'activePreviewFocusChapter',
    'previewWorkerFailureNotified'
  ]) {
    assert.doesNotMatch(core, new RegExp(`\\b${migrated}\\b`));
    assert.doesNotMatch(preview, new RegExp(`\\b${migrated}\\b`));
  }

  assert.match(preview, /const classicPreviewStatePort = previewCompatibilityHost\?\.markdownEditorPreviewStatePort/);
  assert.match(preview, /classicPreviewStatePort\.beginRender\(\)/);
  assert.match(preview, /classicPreviewStatePort\.isCurrentVersion\(renderVersion\)/);
  assert.match(preview, /classicPreviewStatePort\.snapshot\.focusSection/);
  assert.match(preview, /classicPreviewStatePort\.snapshot\.lastStableResult/);
  assert.match(preview, /classicPreviewStatePort\.commitStable/);
  assert.match(preview, /classicPreviewStatePort\.commitDegraded/);
  assert.match(webClipper, /webClipperPreviewStatePort\.snapshot\.mode/);
  assert.match(editorTools, /editorToolsPreviewStatePort\.snapshot\.lastStableResult/);

  // Settings still owns the user's requested auto/full/virtual/chapter preference.
  assert.match(core, /let previewPerformanceMode = 'auto'/);
  // Focus request cancellation is Atomic 7.11, not PreviewState render generation.
  assert.match(core, /let previewLineFocusVersion = 0/);
});

test('Atomic 7.2 uses PreviewState stable metadata before DOM when deciding recovery or rerender', async () => {
  const preview = await source('public/app/preview.js');
  const editorTools = await source('public/app/editor-tools.js');

  assert.match(preview, /const lastStableResult = classicPreviewStatePort\.snapshot\.lastStableResult;/);
  assert.match(preview, /if \(lastStableResult && body && !body\.classList\.contains\('preview-loading'\)\)/);
  assert.match(preview, /const hasStablePreview = Boolean\(classicPreviewStatePort\.snapshot\.lastStableResult\)/);
  assert.match(editorTools, /editorToolsPreviewStatePort\.snapshot\.lastStableResult/);
  assert.doesNotMatch(preview, /if \(body && !body\.classList\.contains\('preview-loading'\)\) \{\n\s+patchResult = \{\n\s+body,\n\s+changedNodes: \[\],\n\s+reused:/);
});

test('Atomic 7.2 remains intact while Atomic 7.3-7.4 may add Mode Resolver and Scheduler/Cancellation but not Atomic 7.5+ owners', async () => {
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
