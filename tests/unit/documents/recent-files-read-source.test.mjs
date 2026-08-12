import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentFilesReadSource } from '../../../src/features/documents/index.js';

test('Atomic 6.12 Recent Files read source exposes snapshot and subscription only', () => {
  const events = [];
  let listener = null;
  let unsubscribed = 0;
  const snapshot = Object.freeze({ entries: Object.freeze([]), revision: 2 });
  const repository = {
    snapshot,
    subscribe(next) {
      listener = next;
      return () => { unsubscribed += 1; listener = null; };
    },
    add() { throw new Error('write must not be exposed'); },
    clear() { throw new Error('write must not be exposed'); }
  };
  const source = createRecentFilesReadSource(repository);
  assert.equal(source.snapshot, snapshot);
  assert.deepEqual(Object.keys(source).sort(), ['snapshot', 'subscribe']);
  assert.equal('add' in source, false);
  assert.equal('clear' in source, false);
  const unsubscribe = source.subscribe(event => events.push(event));
  const event = Object.freeze({ snapshot });
  listener(event);
  assert.deepEqual(events, [event]);
  unsubscribe();
  unsubscribe();
  assert.equal(unsubscribed, 1);
});

test('Atomic 6.12 Recent Files read source rejects non-subscribable repositories and listeners', () => {
  assert.throws(() => createRecentFilesReadSource({ snapshot: {} }), /subscribable repository/);
  const source = createRecentFilesReadSource({ snapshot: {}, subscribe() { return () => {}; } });
  assert.throws(() => source.subscribe(null), /listener must be a function/);
});
