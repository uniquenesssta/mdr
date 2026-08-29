import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.11 keeps one taskbook Preview Focus Controller pipeline owner', async () => {
  const entries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('preview-focus-controller.js'));
  const [entry, focus] = await Promise.all([source('src/features/preview/index.js'), source('src/features/preview/pipeline/preview-focus-controller.js')]);
  assert.match(entry, /createPreviewFocusController/);
  assert.match(entry, /mountClassicPreviewFocusControllerPort/);
  for (const token of ['requestGeneration','scheduleCursorFocus','focusLine','ensureLineVisible','scrollToLine']) assert.match(focus, new RegExp(token));
});

test('Atomic 7.11 Focus Controller stays DOM-free and owns request-token invalidation instead of browser globals', async () => {
  const focus = await source('src/features/preview/pipeline/preview-focus-controller.js');
  assert.match(focus, /scheduler\.schedule\('focus'/);
  assert.match(focus, /scheduler\.cancel\('focus'/);
  assert.match(focus, /scheduler\.cancel\('input'/);
  assert.match(focus, /generation === requestGeneration/);
  assert.doesNotMatch(focus, /window\.|document\.|localStorage|sessionStorage|querySelector|getElementById|createElement|getBoundingClientRect|\.scrollTop\b|markdownEditor/);
});

test('Atomic 7.11 composition owns one scoped Focus port while PreviewController delegates focus behavior to the canonical owner', async () => {
  const [main, controller, core, port] = await Promise.all([
    source('src/main.js'), source('src/features/preview/application/preview-controller.js'), source('public/app/core.js'),
    source('src/features/preview/compatibility/classic-preview-focus-controller-port.js')
  ]);
  assert.match(main, /createPreviewFocusController\(\{/);
  assert.match(main, /focusDelay:\s*PREVIEW_BEHAVIOR_THRESHOLDS\.scheduling\.focusMs/);
  assert.match(main, /mountClassicPreviewFocusControllerPort\(compatibilityPlatformHost, previewFocusController\)/);
  assert.match(main, /previewFocusControllerPort\.destroy\(\)/);
  assert.match(main, /previewFocusController\.destroy\(\)/);
  assert.match(port, /markdownEditorPreviewFocusControllerPort/);
  assert.match(controller, /focusController\.connect\(\{/);
  assert.match(controller, /focusController\.scheduleCursorFocus\(/);
  assert.match(controller, /focusController\.focusLine\(/);
  assert.doesNotMatch(controller, /function\s+focusPreviewLine\s*\(|function\s+previewScopeContainsLine\s*\(/);
  assert.doesNotMatch(core, /previewLineFocusVersion|previewLineFocusTarget|previewLineFocusPromise/);
});

test('Atomic 7.11 Focus ownership remains isolated after 7.12, 7.13 and Atomic 7.14', async () => {
  const [virtual, focus] = await Promise.all([
    source('src/features/preview/render/virtual-window/virtual-window-controller.js'),
    source('src/features/preview/pipeline/preview-focus-controller.js')
  ]);
  assert.match(virtual, /ensureLineVisible/);
  assert.doesNotMatch(virtual, /preview-focus-controller|preview-enhancement-coordinator|preview-recovery-view|preview-controller|requestGeneration/);
  assert.doesNotMatch(focus, /preview-enhancement-coordinator|preview-recovery-view|preview-controller|preview-render-engine|renderMath|renderMermaid|enhancement|recovery/);
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-enhancement-coordinator/);
  assert.match(tree, /preview-recovery-view/);
  assert.match(tree, /preview-controller/);
});
