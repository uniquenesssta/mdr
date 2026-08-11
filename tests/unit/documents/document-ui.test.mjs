import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocumentTitleView } from '../../../src/features/documents/ui/document-title-view.js';
import { mountClassicDocumentUiCommandPort } from '../../../src/features/documents/compatibility/classic-document-ui-command-port.js';

function createInput() {
  const listeners = new Map();
  return {
    ownerDocument: {},
    value: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    emit(type) { listeners.get(type)?.({ target: this }); },
    listenerCount() { return listeners.size; }
  };
}

function createSession() {
  let listeners = new Set();
  let snapshot = Object.freeze({ records: Object.freeze([{ id: 'a', title: 'A.md' }]), activeId: 'a', revision: 0 });
  return {
    get records() { return snapshot.records; },
    get activeId() { return snapshot.activeId; },
    get snapshot() { return snapshot; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(next) {
      const previous = snapshot;
      snapshot = Object.freeze({ ...next, revision: previous.revision + 1 });
      for (const listener of [...listeners]) listener({ snapshot, previous });
    },
    listenerCount() { return listeners.size; }
  };
}

test('Atomic 5.12 Document Title View is session-read-only, sends title drafts and cleans listener/subscription ownership', () => {
  const input = createInput();
  const session = createSession();
  const drafts = [];
  const view = createDocumentTitleView({ input, session, updateTitleDraft: value => drafts.push(value) });
  assert.equal(input.value, 'A.md');
  assert.equal(input.listenerCount(), 1);
  assert.equal(session.listenerCount(), 1);
  input.value = 'Draft.md';
  input.emit('input');
  assert.deepEqual(drafts, ['Draft.md']);
  session.update({ records: Object.freeze([{ id: 'b', title: 'B.md' }]), activeId: 'b' });
  assert.equal(input.value, 'B.md');
  view.destroy();
  view.destroy();
  assert.equal(input.listenerCount(), 0);
  assert.equal(session.listenerCount(), 0);
});

test('Atomic 5.12 scoped Document UI compatibility port owns callbacks only and removes them deterministically', () => {
  const host = {};
  const calls = [];
  const port = mountClassicDocumentUiCommandPort(host);
  const unregister = port.register({ open: id => calls.push(['open', id]), close: id => calls.push(['close', id]) });
  port.invoke('open', 'a');
  port.invoke('close', 'b');
  assert.deepEqual(calls, [['open', 'a'], ['close', 'b']]);
  assert.throws(() => port.register({ open() {} }), /already registered/);
  unregister();
  assert.equal(port.has('open'), false);
  port.destroy();
  assert.equal(host.markdownEditorDocumentUiCommandPort, undefined);
  assert.throws(() => port.invoke('open', 'a'), /destroyed/);
});
