import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.5 keeps one pure Worker Protocol owner beside the Atomic 7.6 session', async () => {
  const workerEntries = (await readdir(new URL('src/features/preview/worker/', root))).sort();
  assert.deepEqual(workerEntries, ['preview-worker-protocol.js', 'preview-worker-session.js']);

  const protocol = await source('src/features/preview/worker/preview-worker-protocol.js');
  const entry = await source('src/features/preview/index.js');

  for (const type of ['reset', 'transactions', 'render-window', 'focus', 'cancel', 'error', 'ack']) {
    assert.match(protocol, new RegExp(`['\\"]${type}['\\"]`));
  }
  for (const field of ['generation', 'version', 'requestId']) {
    assert.match(protocol, new RegExp(`\\b${field}\\b`));
  }
  assert.match(entry, /preview-worker-protocol\.js/);
  assert.doesNotMatch(protocol, /new\s+Worker\s*\(|self\.onmessage|postMessage\s*\(|document\.|localStorage|sessionStorage/);
});

test('Atomic 7.5 legacy Worker runtime and Atomic 7.6 session consume the shared protocol without duplicate message authority', async () => {
  const runtime = await source('src/preview/preview-worker.js');
  const client = await source('src/preview/preview-worker-client.js');
  const session = await source('src/features/preview/worker/preview-worker-session.js');

  for (const text of [runtime, session]) {
    assert.match(text, /preview-worker-protocol\.js/);
    for (const legacy of ['update', 'renderBlocks', 'result', 'prewarm-result']) {
      assert.doesNotMatch(text, new RegExp(`type\\s*[:=]{1,3}\\s*['\\"]${legacy}['\\"]`));
      assert.doesNotMatch(text, new RegExp(`message\\.type\\s*={2,3}\\s*['\\"]${legacy}['\\"]`));
    }
  }

  assert.match(client, /createPreviewWorkerSession/);
  assert.doesNotMatch(client, /createPreviewWorkerMessage|parsePreviewWorkerMessage/);
  assert.match(session, /generation/);
  assert.match(session, /requestId/);
  assert.match(runtime, /generation/);
  assert.match(runtime, /requestId/);
});

test('Atomic 7.5/7.6 remain intact while Atomic 7.7 may add Render Coordinator but not later preview owners', async () => {
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
    'virtual-preview-controller',
    'preview-layout-stability',
    'preview-focus-controller',
    'preview-enhancement-coordinator',
    'preview-dom-renderer'
  ]) {
    assert.doesNotMatch(tree, new RegExp(premature));
  }
});