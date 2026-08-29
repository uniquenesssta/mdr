import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.5 keeps one pure Worker Protocol owner beside session/client/runtime modules', async () => {
  const entries = (await readdir(new URL('src/features/preview/worker/', root))).sort();
  for (const file of ['preview-worker-protocol.js','preview-worker-session.js','preview-worker-client.js','preview-worker.js']) assert.ok(entries.includes(file));
  const [protocol, entry] = await Promise.all([
    source('src/features/preview/worker/preview-worker-protocol.js'), source('src/features/preview/index.js')
  ]);
  for (const type of ['reset','transactions','render-window','focus','cancel','error','ack']) assert.match(protocol, new RegExp(`['\\"]${type}['\\"]`));
  for (const field of ['generation','version','requestId']) assert.match(protocol, new RegExp(`\\b${field}\\b`));
  assert.match(entry, /preview-worker-protocol\.js/);
  assert.doesNotMatch(protocol, /new\s+Worker\s*\(|self\.onmessage|postMessage\s*\(|document\.|localStorage|sessionStorage/);
});

test('Atomic 7.5 canonical Worker runtime and 7.6 session consume the shared protocol without duplicate authority', async () => {
  const [runtime, client, session] = await Promise.all([
    source('src/features/preview/worker/preview-worker.js'),
    source('src/features/preview/worker/preview-worker-client.js'),
    source('src/features/preview/worker/preview-worker-session.js')
  ]);
  for (const text of [runtime, session]) {
    assert.match(text, /preview-worker-protocol\.js/);
    for (const legacy of ['update','renderBlocks','result','prewarm-result']) {
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

test('Atomic 7.5 protocol remains import-safe and isolated after Atomic 7.14 moves the Worker runtime', async () => {
  const [protocol, runtime] = await Promise.all([
    source('src/features/preview/worker/preview-worker-protocol.js'),
    source('src/features/preview/worker/preview-worker.js')
  ]);
  assert.doesNotMatch(protocol, /WorkerGlobalScope|globalThis|onmessage/);
  assert.match(runtime, /export function startPreviewWorker\(scope\)/);
  assert.match(runtime, /typeof WorkerGlobalScope !== 'undefined'/);
});
