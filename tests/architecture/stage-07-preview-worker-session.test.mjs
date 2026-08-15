import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('Atomic 7.6 keeps one Worker Session owner beside canonical protocol/client/runtime modules', async () => {
  const entries = (await readdir(new URL('src/features/preview/worker/', root))).sort();
  for (const file of ['preview-worker-protocol.js','preview-worker-session.js','preview-worker-client.js','preview-worker.js']) assert.ok(entries.includes(file));
  const [session, entry] = await Promise.all([
    source('src/features/preview/worker/preview-worker-session.js'), source('src/features/preview/index.js')
  ]);
  assert.match(entry, /preview-worker-session\.js/);
  assert.match(session, /preview-worker-protocol\.js/);
  for (const token of ['generation','syncedVersion','requestId','restart']) assert.match(session, new RegExp(token));
  assert.doesNotMatch(session, /document\.|localStorage|sessionStorage|marked|markdown-body|querySelector|createElement/);
});

test('canonical Worker client delegates session state and response correlation to Atomic 7.6 Worker Session', async () => {
  const client = await source('src/features/preview/worker/preview-worker-client.js');
  assert.match(client, /createPreviewWorkerSession/);
  assert.doesNotMatch(client, /this\.workerVersion\s*=/);
  assert.doesNotMatch(client, /this\.initialized\s*=/);
  assert.doesNotMatch(client, /this\.requestId\s*=/);
  assert.doesNotMatch(client, /handleMessage\s*\(/);
  assert.doesNotMatch(client, /resetWorker\s*\(/);
  assert.doesNotMatch(client, /addEventListener\(['\"]message['\"]/);
  assert.doesNotMatch(client, /addEventListener\(['\"]error['\"]/);
});

test('Worker failure still never falls through to main-thread whole-document rendering after Atomic 7.14', async () => {
  const engine = await source('src/features/preview/pipeline/preview-render-engine.js');
  assert.match(engine, /if\s*\(!patchResult\s*&&\s*workerFailed\)\s*\{/);
  assert.match(engine, /if\s*\(!patchResult\s*&&\s*!workerFailed\)\s*\{/);
  const workerFallback = engine.indexOf('if (!patchResult && workerFailed)');
  const mainFallback = engine.indexOf('if (!patchResult && !workerFailed)');
  assert.ok(workerFallback >= 0 && mainFallback > workerFallback);
});

test('Atomic 7.6 session remains DOM-free after Atomic 7.14 moves Worker runtime ownership', async () => {
  const session = await source('src/features/preview/worker/preview-worker-session.js');
  assert.doesNotMatch(session, /preview-controller|preview-render-engine|document\.|querySelector|createElement/);
});
