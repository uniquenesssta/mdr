import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.5 owns one pure Worker Protocol module under the preview feature', async () => {
  const workerEntries = (await readdir(new URL('src/features/preview/worker/', root))).sort();
  assert.deepEqual(workerEntries, ['preview-worker-protocol.js']);

  const protocol = await source('src/features/preview/worker/preview-worker-protocol.js');
  const entry = await source('src/features/preview/index.js');

  for (const type of ['reset', 'transactions', 'render-window', 'focus', 'cancel', 'error', 'ack']) {
    assert.match(protocol, new RegExp(`['\"]${type}['\"]`));
  }
  for (const field of ['generation', 'version', 'requestId']) {
    assert.match(protocol, new RegExp(`\\b${field}\\b`));
  }
  assert.match(entry, /preview-worker-protocol\.js/);
  assert.doesNotMatch(protocol, /new\s+Worker\s*\(|self\.onmessage|postMessage\s*\(|document\.|localStorage|sessionStorage/);
});

test('Atomic 7.5 legacy Worker runtime and client consume the shared protocol instead of owning message names', async () => {
  const runtime = await source('src/preview/preview-worker.js');
  const client = await source('src/preview/preview-worker-client.js');

  for (const text of [runtime, client]) {
    assert.match(text, /preview-worker-protocol\.js/);
    for (const legacy of ['update', 'renderBlocks', 'result', 'prewarm-result']) {
      assert.doesNotMatch(text, new RegExp(`type\\s*[:=]{1,3}\\s*['\"]${legacy}['\"]`));
      assert.doesNotMatch(text, new RegExp(`message\\.type\\s*={2,3}\\s*['\"]${legacy}['\"]`));
    }
  }

  assert.match(client, /generation/);
  assert.match(client, /requestId/);
  assert.match(runtime, /generation/);
  assert.match(runtime, /requestId/);
});

test('Atomic 7.5 does not introduce Worker Session or later preview owners', async () => {
  const featureRoot = new URL('src/features/preview/', root);
  const entries = await readdir(featureRoot, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    paths.push(entry.name);
    if (!entry.isDirectory()) continue;
    for (const child of await readdir(new URL(`${entry.name}/`, featureRoot))) {
      paths.push(`${entry.name}/${child}`);
    }
  }
  const tree = paths.join('\n');

  for (const premature of [
    'preview-worker-session',
    'preview-render-coordinator',
    'virtual-preview-controller',
    'preview-layout-stability',
    'preview-focus-controller',
    'preview-enhancement-coordinator',
    'preview-dom-renderer'
  ]) {
    assert.doesNotMatch(tree, new RegExp(premature));
  }
});
