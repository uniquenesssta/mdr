import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Atomic 7.6 introduces exactly one Worker Session owner beside the protocol', async () => {
  const workerEntries = (await readdir(new URL('src/features/preview/worker/', root))).sort();
  assert.deepEqual(workerEntries, ['preview-worker-protocol.js', 'preview-worker-session.js']);

  const session = await source('src/features/preview/worker/preview-worker-session.js');
  const entry = await source('src/features/preview/index.js');
  assert.match(entry, /preview-worker-session\.js/);
  assert.match(session, /preview-worker-protocol\.js/);
  assert.match(session, /generation/);
  assert.match(session, /syncedVersion/);
  assert.match(session, /requestId/);
  assert.match(session, /restart/);
  assert.doesNotMatch(session, /document\.|localStorage|sessionStorage|marked|markdown-body|querySelector|createElement/);
});

test('legacy Worker client delegates session state and response correlation to Worker Session', async () => {
  const client = await source('src/preview/preview-worker-client.js');
  assert.match(client, /createPreviewWorkerSession/);
  assert.doesNotMatch(client, /this\.workerVersion\s*=/);
  assert.doesNotMatch(client, /this\.initialized\s*=/);
  assert.doesNotMatch(client, /this\.requestId\s*=/);
  assert.doesNotMatch(client, /handleMessage\s*\(/);
  assert.doesNotMatch(client, /resetWorker\s*\(/);
  assert.doesNotMatch(client, /addEventListener\(['\"]message['\"]/);
  assert.doesNotMatch(client, /addEventListener\(['\"]error['\"]/);
});

test('Worker failure never falls through to main-thread whole-document rendering', async () => {
  const preview = await source('public/app/preview.js');
  assert.match(preview, /if\s*\(!patchResult\s*&&\s*workerFailed\)\s*\{/);
  assert.doesNotMatch(
    preview,
    /if\s*\(!patchResult\s*&&\s*workerFailed\s*&&\s*sourceLength\s*>=\s*classicPreviewBehaviorThresholds\.mode\.virtualChars\)/
  );
  assert.match(preview, /if\s*\(!patchResult\s*&&\s*!workerFailed\)\s*\{/);
});

test('Atomic 7.6 remains intact while Atomic 7.7-7.11 may add Render Coordinator, DOM Renderers, Layout Stability, Virtual Window and Focus but not later preview owners', async () => {
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
    'preview-enhancement-coordinator'
  ]) {
    assert.doesNotMatch(tree, new RegExp(premature));
  }
});
