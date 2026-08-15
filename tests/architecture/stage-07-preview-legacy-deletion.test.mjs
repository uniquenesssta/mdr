import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
async function exists(path) {
  try { await access(new URL(path, root)); return true; } catch { return false; }
}

const removedLegacyPaths = [
  'public/app/preview.js',
  'src/preview/preview-worker-client.js',
  'src/preview/preview-worker.js',
  'src/preview/virtual-preview.js',
  'src/rendering/math-presentation.js',
  'src/rendering/mermaid-presentation.js',
  'src/rendering/presentation-api.js',
  'src/runtime/task-scheduler.js',
  'src/runtime/vendor.js'
];

const canonicalPaths = [
  'src/features/preview/application/preview-controller.js',
  'src/features/preview/application/preview-command-handler.js',
  'src/features/preview/pipeline/preview-render-engine.js',
  'src/features/preview/render/preview-markdown-renderer.js',
  'src/features/preview/render/presentation/presentation-api.js',
  'src/features/preview/worker/preview-worker-client.js',
  'src/features/preview/worker/preview-worker.js',
  'src/features/preview/virtual/virtual-preview-controller.js',
  'src/shared/scheduling/task-scheduler.js',
  'src/shared/vendor/capability-loader.js'
];

test('Atomic 7.14 deletes every migrated legacy Preview/runtime/rendering path while retaining frozen model consumers', async () => {
  for (const path of removedLegacyPaths) assert.equal(await exists(path), false, `${path} must be deleted`);
  for (const path of canonicalPaths) assert.equal(await exists(path), true, `${path} must exist`);
  assert.equal(await exists('src/preview/incremental-preview.js'), true);
  assert.equal(await exists('src/preview/math-source.js'), true);
  assert.equal(await exists('src/document/document-model.js'), true);
});

test('Atomic 7.14 application composition owns one PreviewController/RenderEngine and no classic Preview loader or Preview runtime globals', async () => {
  const main = await source('src/main.js');
  assert.match(main, /createPreviewController/);
  assert.match(main, /createPreviewRenderEngine/);
  assert.match(main, /mountPreviewCommandHandler/);
  assert.match(main, /previewCommandHandler\?\.destroy\(\)/);
  assert.match(main, /previewController\?\.destroy\(\)/);
  assert.doesNotMatch(main, /['"]\/app\/preview\.js['"]/);
  assert.doesNotMatch(main, /\.\/preview\/preview-worker-client\.js|\.\/preview\/virtual-preview\.js|\.\/rendering\/presentation-api\.js|\.\/runtime\/task-scheduler\.js|\.\/runtime\/vendor\.js/);
  assert.doesNotMatch(main, /window\.(?:createPreviewWorkerClient|createVirtualPreviewController|markdownEditorTaskScheduler|markdownEditorPresentation|markdownEditorMath)\s*=/);
});

test('Atomic 7.14 remaining classic callers use the single scoped Preview command surface instead of rebuilding Preview ownership', async () => {
  const paths = [
    'public/app/core.js',
    'public/app/bootstrap.js',
    'public/app/events.js',
    'public/app/editor-tools.js',
    'public/app/web-clipper.js',
    'public/app/scroll-sync.js'
  ];
  const combined = (await Promise.all(paths.map(source))).join('\n');
  assert.match(combined, /markdownEditorPreviewCommandPort/);
  for (const forbidden of [
    'function updatePreview(',
    'function createPreviewWorkerClient(',
    'function createVirtualPreviewController(',
    'suspendPreviewForHybridMode',
    'window.markdownEditorVirtualPreview',
    'window.createPreviewWorkerClient',
    'window.createVirtualPreviewController',
    'window.markdownEditorTaskScheduler'
  ]) {
    assert.doesNotMatch(combined, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Atomic 7.14 keeps application, render, Worker, virtual, scheduler and presentation responsibilities in separate modules', async () => {
  const [controller, handler, engine, worker, virtual, scheduler, presentation] = await Promise.all([
    source('src/features/preview/application/preview-controller.js'),
    source('src/features/preview/application/preview-command-handler.js'),
    source('src/features/preview/pipeline/preview-render-engine.js'),
    source('src/features/preview/worker/preview-worker.js'),
    source('src/features/preview/virtual/virtual-preview-controller.js'),
    source('src/shared/scheduling/task-scheduler.js'),
    source('src/features/preview/render/presentation/presentation-api.js')
  ]);

  assert.match(controller, /Responsibility: Own Preview application lifecycle/);
  assert.match(engine, /Responsibility: Execute one canonical Preview render cycle/);
  assert.match(handler, /single PreviewController command\/policy surface/);
  assert.match(worker, /startPreviewWorker/);
  assert.match(virtual, /extends VirtualWindowController/);
  assert.match(scheduler, /createTaskScheduler/);
  assert.match(presentation, /createMarkdownPresentationApi/);

  assert.doesNotMatch(controller, /new\s+Worker\s*\(|postMessage\s*\(|marked\.|mermaid\.initialize|katex\.render/);
  assert.doesNotMatch(handler, /let\s+(?:mode|version|status|workerClient|virtualController)\b/);
  assert.doesNotMatch(engine, /window\.(?:markdownEditor|createPreview)/);
});
