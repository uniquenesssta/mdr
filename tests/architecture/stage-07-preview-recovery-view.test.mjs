import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
async function exists(path) { try { await access(new URL(path, root)); return true; } catch { return false; } }

test('Atomic 7.13 keeps the taskbook Preview Recovery View and scoped classic bridge', async () => {
  const [entry, view, port] = await Promise.all([
    source('src/features/preview/index.js'), source('src/features/preview/ui/preview-recovery-view.js'),
    source('src/features/preview/compatibility/classic-preview-recovery-view-port.js')
  ]);
  assert.match(entry, /createPreviewRecoveryView/);
  assert.match(entry, /mountClassicPreviewRecoveryViewPort/);
  assert.match(view, /DEFAULT_RECOVERY_MESSAGE/);
  assert.match(view, /preserveStable/);
  assert.match(port, /markdownEditorPreviewRecoveryViewPort/);
});

test('Atomic 7.13 Recovery View owns recovery DOM only and never edits document or Preview state', async () => {
  const view = await source('src/features/preview/ui/preview-recovery-view.js');
  assert.match(view, /root\.replaceChildren\(recoveryBody\)/);
  assert.match(view, /dataset\.previewRecovery = 'true'/);
  assert.doesNotMatch(view, /window\.|localStorage|sessionStorage|DocumentModel|previewState|beginRender|commitStable|commitDegraded|failRender|editor\.|setText|replaceRange|Worker/);
});

test('Atomic 7.13 composition owns Recovery View while Atomic 7.14 RenderEngine delegates recovery presentation', async () => {
  const [main, engine] = await Promise.all([source('src/main.js'), source('src/features/preview/pipeline/preview-render-engine.js')]);
  assert.match(main, /createPreviewRecoveryView\(\{/);
  assert.match(main, /mountClassicPreviewRecoveryViewPort\(\s*compatibilityPlatformHost,\s*previewRecoveryView\s*\)/);
  assert.match(main, /previewRecoveryViewPort\.destroy\(\)/);
  assert.match(main, /previewRecoveryView\.destroy\(\)/);
  assert.match(engine, /recoveryView\.recover\(/);
  assert.match(engine, /recoveryView\.inspect\(/);
  assert.doesNotMatch(engine, /createElement\('div'\)[\s\S]{0,240}preview-loading/);
  assert.doesNotMatch(engine, /后台预览恢复中，编辑内容与自动保存不受影响/);
});

test('Atomic 7.13 routes exhausted render fallback through degraded/error state without clearing the editor', async () => {
  const engine = await source('src/features/preview/pipeline/preview-render-engine.js');
  assert.match(engine, /safeError\(error, 'render'\)/);
  assert.match(engine, /render-safe-fallback-stale/);
  assert.match(engine, /render-safe-fallback-paused/);
  assert.match(engine, /state\.failRender\(/);
  assert.doesNotMatch(engine, /editor\.(?:value|textContent)\s*=\s*['"]{0,1}/);
});

test('Atomic 7.13 Recovery View remains intact after Atomic 7.14 deletes the legacy preview pipeline', async () => {
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-recovery-view/);
  assert.match(tree, /preview-controller/);
  assert.match(tree, /preview-render-engine/);
  assert.equal(await exists('public/app/preview.js'), false);
  assert.equal(await exists('src/preview/preview-worker-client.js'), false);
  assert.equal(await exists('src/preview/virtual-preview.js'), false);
});
