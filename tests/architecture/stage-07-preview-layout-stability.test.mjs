import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.9 keeps one Preview Layout Stability owner for visibility, stable-size retries and geometry notifications', async () => {
  const [layout, entry] = await Promise.all([
    source('src/features/preview/pipeline/preview-layout-stability.js'), source('src/features/preview/index.js')
  ]);
  assert.match(entry, /createPreviewLayoutStability/);
  for (const token of ['maxAttempts','stableFrames','retryMs','visible','preview-became-visible','preview-container-resize','notifyGeometryChanged']) assert.match(layout, new RegExp(token));
  assert.doesNotMatch(layout, /window\.|document\.|localStorage|sessionStorage|markdownEditorVirtualPreview|markdownEditorScroll|virtual-window|focusSection|ensureLineVisible/);
  assert.doesNotMatch(layout, /new\s+ResizeObserver\s*\(/);
});

test('Atomic 7.9 composition root owns and destroys one scoped layout stability port with frozen Stage 7 thresholds', async () => {
  const [main, entry, port] = await Promise.all([
    source('src/main.js'), source('src/features/preview/index.js'),
    source('src/features/preview/compatibility/classic-preview-layout-stability-port.js')
  ]);
  assert.match(entry, /mountClassicPreviewLayoutStabilityPort/);
  assert.match(main, /createPreviewLayoutStability\(\{/);
  assert.match(main, /thresholds:\s*PREVIEW_BEHAVIOR_THRESHOLDS\.scheduling\.layout/);
  assert.match(main, /mountClassicPreviewLayoutStabilityPort\(compatibilityPlatformHost, previewLayoutStability\)/);
  assert.match(main, /previewLayoutStabilityPort\.destroy\(\)/);
  assert.match(main, /previewLayoutStability\.destroy\(\)/);
  assert.match(port, /markdownEditorPreviewLayoutStabilityPort/);
});

test('Atomic 7.9 layout-stability authority moves into PreviewController while classic callers use the command facade', async () => {
  const [controller, bootstrap, editorTools] = await Promise.all([
    source('src/features/preview/application/preview-controller.js'), source('public/app/bootstrap.js'), source('public/app/editor-tools.js')
  ]);
  assert.match(controller, /layoutStability\.connect\(\{/);
  assert.match(controller, /layoutStability\.start\(\)/);
  assert.match(controller, /layoutStability\.cancel\(\)/);
  assert.match(controller, /layoutStability\.requestRefresh/);
  assert.match(bootstrap, /bootstrapPreviewCommandPort\.requestLayoutRefresh\(/);
  assert.match(editorTools, /editorToolsPreviewCommandPort\.requestLayoutRefresh\(/);
  for (const text of [controller, bootstrap, editorTools]) assert.doesNotMatch(text, /initializePreviewLayoutObserver|refreshPreviewAfterLayout/);
});

test('Atomic 7.9 stays isolated from Virtual Window, Focus, Enhancement and Atomic 7.14 orchestration', async () => {
  const layout = await source('src/features/preview/pipeline/preview-layout-stability.js');
  assert.doesNotMatch(layout, /preview-controller|preview-render-engine|preview-focus-controller|preview-enhancement-coordinator|virtual-window/);
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-render-engine/);
  assert.match(tree, /preview-enhancement-coordinator/);
});
