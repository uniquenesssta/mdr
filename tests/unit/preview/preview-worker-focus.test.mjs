import assert from 'node:assert/strict';
import test from 'node:test';
import { startPreviewWorker } from '../../../src/features/preview/worker/preview-worker.js';
import { createPreviewWorkerMessage } from '../../../src/features/preview/worker/preview-worker-protocol.js';
import { PreviewWorkerClient } from '../../../src/features/preview/worker/preview-worker-client.js';

const text = '# First\n\nfirst paragraph\n\n# Second\n\nsecond paragraph\n\n# Third\n\nthird paragraph\n';

function createWorkerHarness() {
  let reply, sequence = 0;
  const scope = { postMessage(value) { reply = value; } };
  const worker = startPreviewWorker(scope);
  return { destroy: worker.destroy,
    send(type, payload, version = 0) {
      scope.onmessage({ data: createPreviewWorkerMessage(type, { generation: 1, version, requestId: ++sequence }, payload) });
      return reply;
    }
  };
}

test('same-version focus changes chapters without reparsing or republishing the complete block/index metadata', () => {
  const h = createWorkerHarness();
  try {
    h.send('reset', { source: text, focusLine: 1, indexOnly: true });
    const first = h.send('focus', { focusLine: 7 });
    assert.equal(first.type, 'ack');
    assert.equal(first.acknowledges, 'focus');
    assert.equal(first.result.parsedChars, 0);
    assert.equal(first.result.reason, 'unchanged');
    assert.equal(first.result.fullBlocks, null);
    assert.equal(first.result.blockPatch, null);
    assert.equal(first.result.headings, null);
    assert.deepEqual(first.result.changedIds, []);
    assert.equal(first.result.focusChapter.startLine, 5);
    assert.ok(first.result.renderedBlocks.some(block => block.html.includes('second paragraph')));
    assert.deepEqual(h.send('focus', { focusLine: 7 }).result.renderedBlocks, [], 'cached chapter HTML is not retransmitted');
  } finally { h.destroy(); }
});

test('focus rejects stale versions and reset invalidates cached chapter content and definitions', () => {
  const h = createWorkerHarness();
  try {
    h.send('reset', { source: text, focusLine: 1 });
    assert.equal(h.send('focus', { focusLine: 7 }, 1).type, 'error');
    assert.equal(h.send('focus', { focusLine: 7 }).type, 'ack');
    h.send('reset', { source: '# Other\n\n[new][ref]\n\n[ref]: https://example.com/new\n', focusLine: 1, indexOnly: true });
    const next = h.send('focus', { focusLine: 3 });
    assert.equal(next.type, 'ack');
    assert.ok(next.result.renderedBlocks.some(block => block.html.includes('https://example.com/new')));
    assert.ok(next.result.renderedBlocks.every(block => !block.html.includes('second paragraph')));
  } finally { h.destroy(); }
});

class WorkerTransport {
  constructor() {
    this.listeners = new Map(); this.sent = [];
    this.scope = { postMessage: data => queueMicrotask(() => {
      for (const listener of this.listeners.get('message') || []) listener({ data: structuredClone(data) });
    }) };
    this.worker = startPreviewWorker(this.scope);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(message) { this.sent.push(message); queueMicrotask(() => this.scope.onmessage({ data: structuredClone(message) })); }
  terminate() { this.worker.destroy(); }
}

test('client uses focus for unchanged text, honors the requested line and resets on same-version document replacement', async () => {
  const transport = new WorkerTransport();
  const client = new PreviewWorkerClient({ createWorker: () => transport });
  const source = { text, generation: 1, documentId: 'one',
    getDocumentVersion: () => 0, getSelection: () => ({ from: 0, to: 1 }),
    getLineNumberAtPosition: () => 1, getChangesSince: () => [],
    createSnapshotPayload() { return { source: this.text }; }
  };
  try {
    const initial = await client.update(source, () => source.text);
    const result = await client.update(source, () => source.text, false, { focusLine: 7 });
    assert.equal(transport.sent.at(-1).type, 'focus');
    assert.equal(result.focusChapter.startLine, 5);
    assert.equal(result.blocks.length, initial.blocks.length);
    assert.equal(result.statistics.characters, text.length);
    await client.update(source, () => source.text, true);
    assert.equal(transport.sent.at(-1).type, 'transactions', 'forced updates retain model recomputation');
    source.generation += 1; source.documentId = 'two'; source.text = '# Replacement\n';
    const replacement = await client.update(source, () => source.text);
    assert.equal(transport.sent.at(-1).type, 'reset');
    assert.equal(replacement.blocks[0].raw, source.text);
  } finally { client.destroy(); }
});
