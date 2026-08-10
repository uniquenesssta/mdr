import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditorController, mountClassicEditorControllerPort } from '../../../src/features/editor/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const readText = path => readFile(resolve(ROOT, path), 'utf8');

function createHarness() {
  let adapterVersion = 0;
  let adapterListener = null;
  let unsubscribed = false;
  const reports = [];
  const replaceCalls = [];
  const state = {
    documentId: 'doc-1', generation: 2, version: 0, backendVersion: 0,
    dirty: false, length: 5, lines: 1, journalEntries: 0, journalChars: 0,
    nonWhitespaceCount: 5
  };
  const adapter = {
    getDocumentVersion: () => adapterVersion,
    subscribeDocumentChanges(listener) {
      adapterListener = listener;
      return () => { unsubscribed = true; adapterListener = null; };
    },
    emit(entry) {
      adapterVersion = Number(entry.version) || 0;
      adapterListener?.(entry);
    }
  };
  const model = {
    getDocumentVersion: () => state.version,
    getState: () => ({ ...state }),
    getTextLength: () => state.length,
    getNonWhitespaceCount: () => state.nonWhitespaceCount,
    replaceRange(replacement, from, to, selectionMode) {
      replaceCalls.push({ replacement, from, to, selectionMode });
    }
  };
  const commit = entry => {
    state.version = Number(entry.version) || 0;
    state.dirty = true;
    state.length = Number(entry.length ?? state.length);
    state.lines = Number(entry.lines ?? state.lines);
    state.nonWhitespaceCount = Number(entry.nonWhitespaceCount ?? state.nonWhitespaceCount);
    adapter.emit(entry);
  };
  const controller = createEditorController({
    model,
    adapter,
    reportError(message, error) { reports.push({ message, error }); }
  });
  return { adapter, model, state, commit, controller, reports, replaceCalls, get unsubscribed() { return unsubscribed; } };
}

test('Atomic 5.8 publishes one frozen model-authoritative transaction after the adapter journal version is committed', () => {
  const harness = createHarness();
  const received = [];
  harness.controller.subscribeTransactions(event => received.push(event));
  harness.commit({ version: 1, suppressed: false, changes: [{ from: 1, to: 2, insert: 'X' }], length: 5, lines: 1, nonWhitespaceCount: 5 });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    type: 'transaction', documentId: 'doc-1', generation: 2, version: 1,
    changes: [{ from: 1, to: 2, insert: 'X' }], length: 5, lines: 1,
    nonWhitespaceCount: 5, interactive: true
  });
  assert.equal(Object.isFrozen(received[0]), true);
  assert.equal(Object.isFrozen(received[0].changes), true);
  assert.equal(Object.isFrozen(received[0].changes[0]), true);
});

test('Atomic 5.8 preserves suppressed programmatic mutations as non-interactive transactions', () => {
  const harness = createHarness();
  const received = [];
  harness.controller.subscribeTransactions(event => received.push(event));
  harness.commit({ version: 1, suppressed: true, changes: [{ from: 0, to: 5, insert: '' }], length: 0, lines: 1, nonWhitespaceCount: 0 });
  assert.equal(received[0].interactive, false);
  assert.equal(received[0].version, harness.model.getDocumentVersion());
});

test('Atomic 5.8 rejects an adapter transaction that the DocumentModel has not committed', () => {
  const harness = createHarness();
  const received = [];
  harness.controller.subscribeTransactions(event => received.push(event));
  harness.adapter.emit({ version: 1, suppressed: false, changes: [{ from: 0, to: 0, insert: 'x' }] });
  assert.equal(received.length, 0);
  assert.equal(harness.reports.length, 1);
  assert.equal(harness.reports[0].error.code, 'EDITOR_TRANSACTION_VERSION_MISMATCH');
});

test('Atomic 5.8 setText routes whole-body writes through DocumentModel.replaceRange and never writes the adapter directly', () => {
  const harness = createHarness();
  harness.controller.setText('next body');
  assert.deepEqual(harness.replaceCalls, [{ replacement: 'next body', from: 0, to: 5, selectionMode: 'end' }]);
});

test('Atomic 5.8 listener failures are reported without blocking sibling transaction subscribers', () => {
  const harness = createHarness();
  const received = [];
  harness.controller.subscribeTransactions(() => { throw new Error('listener boom'); });
  harness.controller.subscribeTransactions(event => received.push(event.version));
  harness.commit({ version: 1, suppressed: false, changes: [{ from: 0, to: 0, insert: 'x' }], length: 6, lines: 1, nonWhitespaceCount: 6 });
  assert.deepEqual(received, [1]);
  assert.equal(harness.reports.some(report => report.message.includes('listener failed')), true);
});

test('Atomic 5.8 destroy is idempotent, unsubscribes the adapter and makes stateful operations terminal', () => {
  const harness = createHarness();
  harness.controller.destroy();
  harness.controller.destroy();
  assert.equal(harness.unsubscribed, true);
  assert.throws(() => harness.controller.setText('late'), /destroyed/);
  assert.throws(() => harness.controller.subscribeTransactions(() => {}), /destroyed/);
  assert.throws(() => harness.controller.state, /destroyed/);
});

test('Atomic 5.8 classic port is scoped, rejects duplicate ownership and becomes terminal on destroy', () => {
  const harness = createHarness();
  const host = {};
  const port = mountClassicEditorControllerPort(host, harness.controller);
  assert.equal(host.markdownEditorEditorControllerPort, port);
  assert.throws(() => mountClassicEditorControllerPort(host, harness.controller), /already mounted/);
  port.setText('classic');
  assert.equal(harness.replaceCalls.at(-1).replacement, 'classic');
  port.destroy();
  port.destroy();
  assert.equal('markdownEditorEditorControllerPort' in host, false);
  assert.throws(() => port.setText('late'), /destroyed/);
});

test('Atomic 5.8 production integration gives input one Controller transaction path and removes direct classic editor.value writes without starting 5.9', async () => {
  const [main, events, bootstrap, tools, clipper, controller, editorIndex] = await Promise.all([
    readText('src/main.js'), readText('public/app/events.js'), readText('public/app/bootstrap.js'),
    readText('public/app/editor-tools.js'), readText('public/app/web-clipper.js'),
    readText('src/features/editor/application/editor-controller.js'), readText('src/features/editor/index.js')
  ]);
  assert.equal(main.includes("from './features/editor/index.js'"), true);
  assert.equal(main.includes("from './editor/index.js'"), false);
  assert.ok(main.indexOf('createDocumentModel(editorHost)') < main.indexOf('createEditorController({'));
  assert.equal(main.includes('mountClassicEditorControllerPort(compatibilityPlatformHost, editorController)'), true);
  assert.equal(events.includes('subscribeTransactions(transaction =>'), true);
  assert.equal(events.includes("editor.addEventListener('input'"), false);
  assert.equal(events.includes('editor.addEventListener("input"'), false);
  for (const [pathName, source] of [['bootstrap', bootstrap], ['editor-tools', tools], ['web-clipper', clipper], ['events', events]]) {
    assert.doesNotMatch(source, /editor\.value\s*=(?!=)/, pathName);
  }
  assert.doesNotMatch(clipper, /if \(count\) el\.value\s*=(?!=)/);
  assert.equal(editorIndex.includes('createEditorController'), true);
  assert.doesNotMatch(controller, /\b(?:undo|redo|history)\b/i);
  assert.equal(controller.includes('@codemirror/'), false);
});
