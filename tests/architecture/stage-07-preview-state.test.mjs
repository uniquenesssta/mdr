import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.2 PreviewState remains a dedicated DOM-free application state owner', async () => {
  const applicationEntries = (await readdir(new URL('src/features/preview/application/', root))).sort();
  assert.ok(applicationEntries.includes('preview-state.js'));
  assert.ok(applicationEntries.includes('preview-controller.js'));
  assert.ok(applicationEntries.includes('preview-commands.js'));
  const state = await source('src/features/preview/application/preview-state.js');
  assert.doesNotMatch(state, /^import\s/m);
  assert.doesNotMatch(state, /\bwindow\b|\bdocument\b|localStorage|sessionStorage|requestAnimationFrame|setTimeout|Worker\s*\(/);
  for (const field of ['mode', 'version', 'status', 'lastStableResult', 'focusSection', 'error']) assert.match(state, new RegExp(`\\b${field}\\b`));
  assert.match(state, /const STABLE_RESULT_FIELDS = new Set\(\[/);
  assert.match(state, /rejectUnknownFields\(result, STABLE_RESULT_FIELDS, 'Preview stable result'\)/);
  assert.match(state, /Preview State is destroyed/);
});

test('Atomic 7.2 exposes one scoped compatibility view of canonical state and destroys it from composition root', async () => {
  const [entry, port, main] = await Promise.all([
    source('src/features/preview/index.js'),
    source('src/features/preview/application/preview-state.js'),
    source('src/main.js')
  ]);
  assert.match(entry, /createPreviewState/);
  assert.doesNotMatch(entry, /mountClassicPreviewStatePort/);
  assert.doesNotMatch(port, /markdownEditorPreviewStatePort/);
  assert.doesNotMatch(port, /window\.markdownEditorPreviewState/);
  assert.match(port, /get snapshot\(\)/);
  assert.doesNotMatch(port, /markdownEditorPreviewStatePort|Object\.defineProperty/);
  assert.match(main, /const previewState = createPreviewState\(\)/);
  assert.doesNotMatch(main, /mountClassicPreviewStatePort\(compatibilityPlatformHost, previewState\)/);
  assert.doesNotMatch(main, /previewStatePort\.destroy\(\)/);
  assert.match(main, /previewState\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorPreviewState/);
});

test('Atomic 7.2 state mutations remain in PreviewState while Atomic 7.14 orchestration delegates to it', async () => {
  const [core, engine, handler, webClipper, editorTools] = await Promise.all([
    Promise.all([
      source('src/features/documents/ui/document-workspace.js'),
      source('src/features/menu/shell-menus.js'),
      source('src/features/persistence/ui/workspace-status.js'),
      source('src/features/layout/workspace-preferences.js')
    ]).then(sources => sources.join('\n')),
    source('src/features/preview/pipeline/preview-render-engine.js'),
    source('src/features/preview/application/preview-commands.js'),
    source('src/features/editor/application/find-preview-commands.js'),
    source('src/features/layout/workspace-preferences.js')
  ]);
  for (const migrated of ['previewRenderVersion','activeResolvedPreviewMode','activePreviewScopeKey','activePreviewFocusChapter','previewWorkerFailureNotified']) {
    assert.doesNotMatch(core, new RegExp(`\\b${migrated}\\b`));
    assert.doesNotMatch(handler, new RegExp(`\\b${migrated}\\b`));
  }
  for (const method of ['beginRender','isCurrentVersion','commitStable','commitDegraded','failRender']) assert.match(engine, new RegExp(`state\\.${method}`));
  assert.match(handler, /get snapshot\(\)[\s\S]*controller\.getStateSnapshot\(\)/);
  assert.match(webClipper, /webClipperPreviewCommandPort\.snapshot\.mode/);
  assert.match(editorTools, /editorToolsPreviewCommandPort\.snapshot\.lastStableResult/);
  assert.match(core, /coreSettingsStorePort\.get\('previewPerformanceMode'\)/);
  assert.doesNotMatch(core, /previewLineFocusVersion|previewLineFocusTarget|previewLineFocusPromise/);
});

test('Atomic 7.2 stable metadata remains authoritative before Recovery View presentation checks after Atomic 7.14', async () => {
  const [engine, editorTools] = await Promise.all([
    source('src/features/preview/pipeline/preview-render-engine.js'),
    source('src/features/layout/workspace-preferences.js')
  ]);
  const stableRead = engine.indexOf('const lastStable = state.snapshot.lastStableResult;');
  const recoveryInspect = engine.indexOf('recoveryView.inspect()', stableRead);
  const recoveryCall = engine.indexOf('recoveryView.recover({ preserveStable })', recoveryInspect);
  assert.ok(stableRead >= 0);
  assert.ok(recoveryInspect > stableRead);
  assert.ok(recoveryCall > recoveryInspect);
  assert.match(engine, /const preserveStable = Boolean\(lastStable && target\.present && !target\.recovery\)/);
  assert.match(editorTools, /editorToolsPreviewCommandPort\.snapshot\.lastStableResult/);
});

test('Atomic 7.2 state owner stays independent of Atomic 7.13 Recovery View and Atomic 7.14 Controller', async () => {
  const state = await source('src/features/preview/application/preview-state.js');
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-recovery-view/);
  assert.match(tree, /preview-controller/);
  assert.match(tree, /preview-render-engine/);
  assert.doesNotMatch(state, /preview-recovery-view|preview-loading|preview-controller|preview-render-engine|markdownEditorPreview/);
});
