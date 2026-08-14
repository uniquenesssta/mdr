import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

async function exists(path) {
  try { await access(new URL(path, root)); return true; } catch { return false; }
}

test('Atomic 7.13 creates the taskbook Preview Recovery View and one scoped classic bridge', async () => {
  const [entry, view, port] = await Promise.all([
    source('src/features/preview/index.js'),
    source('src/features/preview/ui/preview-recovery-view.js'),
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

test('Atomic 7.13 composition mounts and destroys one Recovery View while classic preview delegates recovery presentation', async () => {
  const [main, preview] = await Promise.all([source('src/main.js'), source('public/app/preview.js')]);
  assert.match(main, /createPreviewRecoveryView\(\{/);
  assert.match(main, /mountClassicPreviewRecoveryViewPort\(\s*compatibilityPlatformHost,\s*previewRecoveryView\s*\)/);
  assert.match(main, /previewRecoveryViewPort\.destroy\(\)/);
  assert.match(main, /previewRecoveryView\.destroy\(\)/);
  assert.match(preview, /markdownEditorPreviewRecoveryViewPort/);
  assert.match(preview, /previewRecoveryViewPort\.recover\(/);
  assert.match(preview, /previewRecoveryViewPort\.inspect\(/);
  assert.doesNotMatch(preview, /createElement\('div'\)[\s\S]{0,240}preview-loading/);
  assert.doesNotMatch(preview, /后台预览恢复中，编辑内容与自动保存不受影响/);
});

test('Atomic 7.13 routes exhausted render fallback through degraded/error state without clearing the editor', async () => {
  const preview = await source('public/app/preview.js');
  assert.match(preview, /source:\s*'render'/);
  assert.match(preview, /render-safe-fallback-stale/);
  assert.match(preview, /render-safe-fallback-paused/);
  assert.match(preview, /classicPreviewStatePort\.failRender\(/);
  assert.doesNotMatch(preview, /editor\.(?:value|textContent)\s*=\s*['"]{0,1}/);
});

test('Atomic 7.13 advances Recovery View only and does not start Atomic 7.14 legacy preview deletion', async () => {
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-recovery-view/);
  assert.equal(await exists('public/app/preview.js'), true);
  assert.equal(await exists('src/features/preview/application/preview-controller.js'), false);
});
