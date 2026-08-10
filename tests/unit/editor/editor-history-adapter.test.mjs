import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorHistoryAdapter,
  mountClassicEditorHistoryPort
} from '../../../src/features/editor/index.js';

function createNeutralAdapter(overrides = {}) {
  const calls = [];
  const adapter = {
    undo() { calls.push('undo'); return true; },
    redo() { calls.push('redo'); return false; },
    isolateHistory() { calls.push('isolate'); return undefined; },
    ...overrides
  };
  return { adapter, calls };
}

test('Editor History Adapter delegates undo/redo/isolate without owning document history state', () => {
  const { adapter, calls } = createNeutralAdapter();
  const historyAdapter = createEditorHistoryAdapter({ adapter });

  assert.equal(historyAdapter.undo(), true);
  assert.equal(historyAdapter.redo(), false);
  assert.equal(historyAdapter.isolate(), undefined);
  assert.deepEqual(calls, ['undo', 'redo', 'isolate']);
  for (const forbidden of ['historyStack', 'historyIndex', 'text', 'snapshot', 'adapter']) {
    assert.equal(Object.hasOwn(historyAdapter, forbidden), false, `history adapter must not expose ${forbidden}`);
  }
});

test('Editor History Adapter validates the neutral history contract and preserves delegated errors', () => {
  assert.throws(() => createEditorHistoryAdapter(), /adapter/i);
  assert.throws(() => createEditorHistoryAdapter({ adapter: { undo() {}, redo() {} } }), /isolateHistory/i);

  const expected = new Error('undo failed');
  const historyAdapter = createEditorHistoryAdapter({
    adapter: {
      undo() { throw expected; },
      redo() { return true; },
      isolateHistory() {}
    }
  });
  assert.throws(() => historyAdapter.undo(), error => error === expected);
});

test('Editor History Adapter destroy is idempotent and terminal without destroying the injected editor adapter', () => {
  const { adapter, calls } = createNeutralAdapter();
  const historyAdapter = createEditorHistoryAdapter({ adapter });
  historyAdapter.destroy();
  historyAdapter.destroy();
  assert.throws(() => historyAdapter.undo(), /destroyed/i);
  assert.throws(() => historyAdapter.redo(), /destroyed/i);
  assert.throws(() => historyAdapter.isolate(), /destroyed/i);
  assert.deepEqual(calls, []);
});

test('classic History port is scoped, stateless, independently destroyable and forwards only history operations', () => {
  const { adapter, calls } = createNeutralAdapter();
  const historyAdapter = createEditorHistoryAdapter({ adapter });
  const host = {};
  const port = mountClassicEditorHistoryPort(host, historyAdapter);

  assert.equal(host.markdownEditorEditorHistoryPort, port);
  assert.equal(port.undo(), true);
  assert.equal(port.redo(), false);
  assert.equal(port.isolate(), undefined);
  assert.deepEqual(calls, ['undo', 'redo', 'isolate']);
  assert.throws(() => mountClassicEditorHistoryPort(host, historyAdapter), /already mounted/i);

  port.destroy();
  port.destroy();
  assert.equal(host.markdownEditorEditorHistoryPort, undefined);
  assert.throws(() => port.undo(), /destroyed/i);
  assert.equal(historyAdapter.undo(), true, 'port destruction must not destroy the application adapter');
  historyAdapter.destroy();
});
