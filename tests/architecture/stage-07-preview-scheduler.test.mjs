import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.4 owns scheduler and cancellation as separate DOM-free pipeline responsibilities', async () => {
  const entries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('preview-scheduler.js'));
  assert.ok(entries.includes('preview-cancellation.js'));

  const scheduler = await source('src/features/preview/pipeline/preview-scheduler.js');
  const cancellation = await source('src/features/preview/pipeline/preview-cancellation.js');

  assert.match(scheduler, /createPreviewScheduler/);
  assert.match(scheduler, /'input'/);
  assert.match(scheduler, /'focus'/);
  assert.match(scheduler, /'layout'/);
  assert.match(scheduler, /'enhancement'/);
  assert.match(scheduler, /task\.commit|commit\(/);
  assert.match(cancellation, /createPreviewCancellation/);
  assert.match(cancellation, /isCurrent/);
  assert.match(cancellation, /commit/);

  for (const text of [scheduler, cancellation]) {
    assert.doesNotMatch(text, /document\.|localStorage|sessionStorage|new\s+Worker\s*\(/);
  }
});

test('Atomic 7.4 composition root mounts one scoped classic scheduler port and destroys scheduler/cancellation', async () => {
  const main = await source('src/main.js');
  const entry = await source('src/features/preview/index.js');
  const port = await source('src/features/preview/compatibility/classic-preview-scheduler-port.js');

  assert.match(entry, /createPreviewCancellation/);
  assert.match(entry, /createPreviewScheduler/);
  assert.match(entry, /mountClassicPreviewSchedulerPort/);
  assert.match(port, /markdownEditorPreviewSchedulerPort/);
  assert.doesNotMatch(port, /window\.markdownEditorPreviewScheduler/);
  assert.match(main, /createPreviewCancellation\(\)/);
  assert.match(main, /createPreviewScheduler/);
  assert.match(main, /mountClassicPreviewSchedulerPort/);
  assert.match(main, /previewSchedulerPort\.destroy\(\)/);
  assert.match(main, /previewScheduler\.destroy\(\)/);
  assert.match(main, /previewCancellation\.destroy\(\)/);
});

test('Atomic 7.4 scheduler remains authoritative while Atomic 7.9 and 7.11 own layout/focus sequencing', async () => {
  const core = await source('public/app/core.js');
  const preview = await source('public/app/preview.js');
  const layoutStability = await source('src/features/preview/pipeline/preview-layout-stability.js');
  const focusController = await source('src/features/preview/pipeline/preview-focus-controller.js');

  assert.match(preview, /markdownEditorPreviewSchedulerPort/);
  assert.match(preview, /previewSchedulerPort\.schedule\('input'/);
  assert.doesNotMatch(preview, /previewSchedulerPort\.schedule\('focus'/);
  assert.match(preview, /previewSchedulerPort\.schedule\('enhancement'/);
  assert.match(preview, /previewSchedulerPort\.cancel\('input'\)/);
  assert.doesNotMatch(preview, /previewSchedulerPort\.cancel\('focus'\)/);
  assert.match(preview, /previewSchedulerPort\.cancel\('enhancement'\)/);
  assert.match(preview, /previewLayoutStabilityPort\.cancel\(\)/);
  assert.match(focusController, /scheduler\.schedule\('focus'/);
  assert.match(focusController, /scheduler\.cancel\('focus'\)/);
  assert.match(focusController, /scheduler\.cancel\('input'\)/);
  assert.match(layoutStability, /scheduler\.schedule\('layout'/);
  assert.match(layoutStability, /scheduler\.cancel\('layout'\)/);

  for (const migrated of [
    'previewUpdateTimer',
    'previewFocusUpdateTimer',
    'previewEnhancementRaf',
    'previewEnhancementIdle',
    'previewLineFocusVersion',
    'previewLineFocusTarget',
    'previewLineFocusPromise'
  ]) {
    assert.doesNotMatch(core, new RegExp(`\b${migrated}\b`));
    assert.doesNotMatch(preview, new RegExp(`\b${migrated}\b`));
  }
});

test('Atomic 7.4 remains intact while Atomic 7.5-7.11 may add Worker, Render, Layout Stability, Virtual Window and Focus owners but not 7.12+ owners', async () => {
  const featureTree = JSON.stringify({
    root: (await readdir(new URL('src/features/preview/', root))).sort(),
    application: (await readdir(new URL('src/features/preview/application/', root))).sort(),
    pipeline: (await readdir(new URL('src/features/preview/pipeline/', root))).sort()
  });

  for (const premature of [
    'preview-controller',
    'preview-worker-protocol',
    'preview-worker-session',
    'preview-enhancement-coordinator',
    'preview-dom-renderer'
  ]) {
    assert.doesNotMatch(featureTree, new RegExp(premature));
  }
});
