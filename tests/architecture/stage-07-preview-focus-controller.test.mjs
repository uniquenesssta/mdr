import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.11 creates one taskbook Preview Focus Controller pipeline owner', async () => {
  const entries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('preview-focus-controller.js'));
  const [entry, focus] = await Promise.all([
    source('src/features/preview/index.js'),
    source('src/features/preview/pipeline/preview-focus-controller.js')
  ]);
  assert.match(entry, /createPreviewFocusController/);
  assert.match(entry, /mountClassicPreviewFocusControllerPort/);
  for (const token of ['requestGeneration', 'scheduleCursorFocus', 'focusLine', 'ensureLineVisible', 'scrollToLine']) {
    assert.match(focus, new RegExp(token));
  }
});

test('Atomic 7.11 Focus Controller is DOM-free and owns request-token invalidation instead of browser globals', async () => {
  const focus = await source('src/features/preview/pipeline/preview-focus-controller.js');
  assert.match(focus, /scheduler\.schedule\('focus'/);
  assert.match(focus, /scheduler\.cancel\('focus'/);
  assert.match(focus, /scheduler\.cancel\('input'/);
  assert.match(focus, /generation === requestGeneration/);
  assert.doesNotMatch(focus, /window\.|document\.|localStorage|sessionStorage|querySelector|getElementById|createElement|getBoundingClientRect|\.scrollTop\b|markdownEditor/);
});

test('Atomic 7.11 composition root mounts one scoped Focus port and classic preview no longer owns focus generation state', async () => {
  const [main, preview, core, port] = await Promise.all([
    source('src/main.js'),
    source('public/app/preview.js'),
    source('public/app/core.js'),
    source('src/features/preview/compatibility/classic-preview-focus-controller-port.js')
  ]);
  assert.match(main, /createPreviewFocusController\(\{/);
  assert.match(main, /focusDelay:\s*PREVIEW_BEHAVIOR_THRESHOLDS\.scheduling\.focusMs/);
  assert.match(main, /mountClassicPreviewFocusControllerPort\(compatibilityPlatformHost, previewFocusController\)/);
  assert.match(main, /previewFocusControllerPort\.destroy\(\)/);
  assert.match(main, /previewFocusController\.destroy\(\)/);
  assert.match(port, /markdownEditorPreviewFocusControllerPort/);
  assert.match(preview, /markdownEditorPreviewFocusControllerPort/);
  assert.match(preview, /previewFocusControllerPort\.connect\(\{/);
  assert.match(preview, /previewFocusControllerPort\.scheduleCursorFocus\(/);
  assert.match(preview, /previewFocusControllerPort\.focusLine\(/);
  assert.doesNotMatch(preview, /function\s+focusPreviewLine\s*\(/);
  assert.doesNotMatch(preview, /function\s+previewScopeContainsLine\s*\(/);
  assert.doesNotMatch(core, /previewLineFocusVersion|previewLineFocusTarget|previewLineFocusPromise/);
});

test('Atomic 7.11 Focus ownership remains isolated after 7.12 Enhancement and 7.13 Recovery View', async () => {
  const virtual = await source('src/features/preview/render/virtual-window/virtual-window-controller.js');
  const focus = await source('src/features/preview/pipeline/preview-focus-controller.js');
  assert.match(virtual, /ensureLineVisible/);
  assert.doesNotMatch(virtual, /preview-focus-controller|preview-enhancement-coordinator|preview-recovery-view|requestGeneration/);
  assert.doesNotMatch(focus, /preview-enhancement-coordinator|preview-recovery-view|renderMath|renderMermaid|enhancement|recovery/);
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-enhancement-coordinator/);
  assert.match(tree, /preview-recovery-view/);
});
