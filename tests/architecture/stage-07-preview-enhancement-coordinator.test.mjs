import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
async function exists(path) { try { await access(new URL(path, root)); return true; } catch { return false; } }

test('Atomic 7.12 keeps one taskbook Preview Enhancement Coordinator pipeline owner', async () => {
  const entries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('preview-enhancement-coordinator.js'));
  const [entry, coordinator, port] = await Promise.all([
    source('src/features/preview/index.js'), source('src/features/preview/pipeline/preview-enhancement-coordinator.js'),
    source('src/features/preview/compatibility/classic-preview-enhancement-coordinator-port.js')
  ]);
  assert.match(entry, /createPreviewEnhancementCoordinator/);
  assert.match(entry, /mountClassicPreviewEnhancementCoordinatorPort/);
  assert.match(port, /markdownEditorPreviewEnhancementCoordinatorPort/);
  for (const token of ['begin','enqueue','setPriorityRange','schedulePostprocess','cancel']) assert.match(coordinator, new RegExp(token));
});

test('Atomic 7.12 coordinator stays DOM-free and owns enhancement scheduling, cancellation and input yielding', async () => {
  const coordinator = await source('src/features/preview/pipeline/preview-enhancement-coordinator.js');
  assert.match(coordinator, /scheduler\.schedule\('enhancement'/);
  assert.match(coordinator, /scheduler\.cancel\('enhancement'\)/);
  assert.match(coordinator, /scheduler\.hasPending\('input'\)/);
  assert.match(coordinator, /minimumTimeRemainingMs/);
  assert.doesNotMatch(coordinator, /window\.|document\.|localStorage|sessionStorage|querySelector|closest\(|offsetTop|offsetHeight|scrollTop|clientHeight|requestIdleCallback|setTimeout\s*\(/);
});

test('Atomic 7.12 duplicate legacy queue remains removed and PreviewController delegates enhancement orchestration', async () => {
  const [main, controller, engine] = await Promise.all([
    source('src/main.js'),
    source('src/features/preview/application/preview-controller.js'),
    source('src/features/preview/pipeline/preview-render-engine.js')
  ]);
  assert.equal(await exists('src/preview/enhancement-queue.js'), false);
  assert.doesNotMatch(main, /createPreviewEnhancementQueue|\.\/preview\/enhancement-queue\.js/);
  assert.match(main, /createPreviewEnhancementCoordinator\(\{/);
  assert.match(main, /mountClassicPreviewEnhancementCoordinatorPort\(\s*compatibilityPlatformHost,\s*previewEnhancementCoordinator\s*\)/);
  assert.match(main, /previewEnhancementCoordinatorPort\.destroy\(\)/);
  assert.match(main, /previewEnhancementCoordinator\.destroy\(\)/);
  assert.match(controller, /enhancementCoordinator\.connect\(\{/);
  assert.match(engine, /enhancementCoordinator\.enqueue/);
  assert.match(engine, /enhancementCoordinator\.schedulePostprocess/);
  assert.doesNotMatch(controller, /previewEnhancementQueue|createPreviewEnhancementQueue|getPreviewEnhancementQueue/);
});

test('Atomic 7.12 keeps task/code/math/Mermaid rendering authority in specialized renderers', async () => {
  const [renderer, coordinator] = await Promise.all([
    source('src/features/preview/render/preview-renderer-port.js'), source('src/features/preview/pipeline/preview-enhancement-coordinator.js')
  ]);
  for (const token of ['taskListRenderer.render','codeRenderer.render','mathRenderer.render','mermaidRenderer.render']) assert.match(renderer, new RegExp(token.replace('.', '\\.')));
  assert.doesNotMatch(coordinator, /createTaskListRenderer|createCodeRenderer|createMathRenderer|createMermaidRenderer|innerHTML|replaceChildren/);
});

test('Atomic 7.12 Enhancement ownership remains isolated after 7.13 Recovery View and Atomic 7.14 application cutover', async () => {
  const [tree, coordinator] = await Promise.all([
    readdir(new URL('src/features/preview/', root), { recursive: true }), source('src/features/preview/pipeline/preview-enhancement-coordinator.js')
  ]);
  const inventory = JSON.stringify(tree);
  assert.match(inventory, /preview-enhancement-coordinator/);
  assert.match(inventory, /preview-recovery-view/);
  assert.match(inventory, /preview-controller/);
  assert.doesNotMatch(coordinator, /preview-recovery|recovery-view|preview-loading|preview-controller|preview-render-engine/);
});
