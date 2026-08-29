import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.4 owns scheduler and cancellation as separate DOM-free pipeline responsibilities', async () => {
  const entries = (await readdir(new URL('src/features/preview/pipeline/', root))).sort();
  assert.ok(entries.includes('preview-scheduler.js'));
  assert.ok(entries.includes('preview-cancellation.js'));
  const [scheduler, cancellation] = await Promise.all([
    source('src/features/preview/pipeline/preview-scheduler.js'),
    source('src/features/preview/pipeline/preview-cancellation.js')
  ]);
  for (const token of ['createPreviewScheduler', "'input'", "'focus'", "'layout'", "'enhancement'"]) assert.match(scheduler, new RegExp(token));
  assert.match(scheduler, /task\.commit|commit\(/);
  assert.match(cancellation, /createPreviewCancellation/);
  assert.match(cancellation, /isCurrent/);
  assert.match(cancellation, /commit/);
  for (const text of [scheduler, cancellation]) assert.doesNotMatch(text, /document\.|localStorage|sessionStorage|new\s+Worker\s*\(/);
});

test('Atomic 7.4 composition root mounts one scoped classic scheduler port and destroys scheduler/cancellation', async () => {
  const [main, entry, port] = await Promise.all([
    source('src/main.js'), source('src/features/preview/index.js'),
    source('src/features/preview/compatibility/classic-preview-scheduler-port.js')
  ]);
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

test('Atomic 7.4 scheduler remains authoritative while 7.9, 7.11, 7.12 and 7.14 orchestrate distinct work', async () => {
  const [core, controller, engine, layout, focus, enhancement] = await Promise.all([
    source('public/app/core.js'), source('src/features/preview/application/preview-controller.js'),
    source('src/features/preview/pipeline/preview-render-engine.js'), source('src/features/preview/pipeline/preview-layout-stability.js'),
    source('src/features/preview/pipeline/preview-focus-controller.js'), source('src/features/preview/pipeline/preview-enhancement-coordinator.js')
  ]);
  assert.match(controller, /scheduler\.schedule\('input'/);
  assert.match(engine, /scheduler\.cancel\('input'\)/);
  assert.match(controller, /layoutStability\.cancel\(\)/);
  assert.match(focus, /scheduler\.schedule\('focus'/);
  assert.match(focus, /scheduler\.cancel\('focus'\)/);
  assert.match(layout, /scheduler\.schedule\('layout'/);
  assert.match(layout, /scheduler\.cancel\('layout'\)/);
  assert.match(enhancement, /scheduler\.schedule\('enhancement'/);
  assert.match(enhancement, /scheduler\.cancel\('enhancement'\)/);
  assert.match(enhancement, /scheduler\.hasPending\('input'\)/);
  for (const migrated of ['previewUpdateTimer','previewFocusUpdateTimer','previewEnhancementRaf','previewEnhancementIdle','previewLineFocusVersion','previewLineFocusTarget','previewLineFocusPromise']) {
    assert.doesNotMatch(core, new RegExp(`\\b${migrated}\\b`));
    assert.doesNotMatch(controller, new RegExp(`\\b${migrated}\\b`));
  }
});

test('Atomic 7.4 scheduling owner remains isolated after Atomic 7.14 application assembly', async () => {
  const [scheduler, controller] = await Promise.all([
    source('src/features/preview/pipeline/preview-scheduler.js'),
    source('src/features/preview/application/preview-controller.js')
  ]);
  assert.doesNotMatch(scheduler, /preview-controller|preview-render-engine|markdownEditor/);
  assert.match(controller, /scheduler\.schedule\('input'/);
});
