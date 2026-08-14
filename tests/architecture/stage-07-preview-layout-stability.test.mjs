import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.9 introduces one Preview Layout Stability owner for visibility, stable-size retries and geometry notifications', async () => {
  const layout = await source('src/features/preview/pipeline/preview-layout-stability.js');
  const entry = await source('src/features/preview/index.js');
  assert.match(entry, /createPreviewLayoutStability/);
  for (const token of ['maxAttempts', 'stableFrames', 'retryMs', 'visible', 'preview-became-visible', 'preview-container-resize', 'notifyGeometryChanged']) {
    assert.match(layout, new RegExp(token));
  }
  assert.doesNotMatch(layout, /window\.|document\.|localStorage|sessionStorage|markdownEditorVirtualPreview|markdownEditorScroll|virtual-window|focusSection|ensureLineVisible/);
  assert.doesNotMatch(layout, /new\s+ResizeObserver\s*\(/);
});

test('Atomic 7.9 composition root mounts and destroys one scoped layout stability port with frozen Stage 7 thresholds', async () => {
  const [main, entry, port] = await Promise.all([
    source('src/main.js'),
    source('src/features/preview/index.js'),
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

test('Atomic 7.9 removes classic layout-stability authority and routes startup/layout transitions through the scoped port', async () => {
  const [preview, bootstrap, editorTools] = await Promise.all([
    source('public/app/preview.js'),
    source('public/app/bootstrap.js'),
    source('public/app/editor-tools.js')
  ]);
  assert.match(preview, /markdownEditorPreviewLayoutStabilityPort/);
  assert.match(preview, /previewLayoutStabilityPort\.connect\(\{/);
  assert.match(preview, /previewLayoutStabilityPort\.cancel\(\)/);
  for (const legacy of [
    'getPreviewLayoutState', 'refreshPreviewViewportAfterLayout', 'refreshPreviewAfterLayout', 'initializePreviewLayoutObserver'
  ]) assert.doesNotMatch(preview, new RegExp(`function\\s+${legacy}\\s*\\(`));
  assert.doesNotMatch(preview, /previewLayoutObserver|previewObservedWidth|previewObservedHeight/);
  assert.match(bootstrap, /bootstrapPreviewLayoutStabilityPort\.start\(\)/);
  assert.match(bootstrap, /bootstrapPreviewLayoutStabilityPort\.requestRefresh\(/);
  assert.doesNotMatch(bootstrap, /initializePreviewLayoutObserver|refreshPreviewAfterLayout/);
  assert.match(editorTools, /editorToolsPreviewLayoutStabilityPort\.requestRefresh\(/);
  assert.doesNotMatch(editorTools, /refreshPreviewAfterLayout/);
});

test('Atomic 7.9 permits Atomic 7.10 Virtual Window but does not enter Focus or Enhancement Coordinator ownership', async () => {
  const featureRoot = new URL('src/features/preview/', root);
  const entries = await readdir(featureRoot, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    paths.push(entry.name);
    if (!entry.isDirectory()) continue;
    for (const child of await readdir(new URL(`${entry.name}/`, featureRoot))) paths.push(`${entry.name}/${child}`);
  }
  const tree = paths.join('\n');
  for (const premature of [
    'preview-focus-controller', 'preview-enhancement-coordinator'
  ]) assert.doesNotMatch(tree, new RegExp(premature));
});
