import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchOpenController } from '../../../src/features/documents/application/launch-open-controller.js';
import { createWindowSessionStorage } from '../../../src/features/documents/infrastructure/window-session-storage.js';

test('launch queue imports every path sequentially and acknowledges after actual completion', async () => {
  const queue = [{ id: 'one', paths: ['中文 空格.md', 'next.txt', 'photo.png'] }], calls = [], errors = [];
  let signal, active = 0;
  const owner = createLaunchOpenController({ launch: {
    subscribe: async handler => { signal = handler; return () => calls.push('dispose'); },
    peek: async () => queue[0], acknowledge: async id => { calls.push(['ack', id]); queue.shift(); }
  }, openPath: async path => { assert.equal(active++, 0); calls.push(path); await Promise.resolve(); active--; if (path === 'next.txt') throw new Error('bad text'); }, reportError: e => errors.push(e.message) });
  await owner.start();
  assert.deepEqual(calls, ['中文 空格.md', 'next.txt', 'photo.png', ['ack', 'one']]);
  queue.push({ id: 'two', paths: ['later.md'] }); signal(); signal();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(x => x === 'later.md').length, 1);
  assert.deepEqual(errors, ['bad text']); await owner.destroy();
  assert.equal(calls.at(-1), 'dispose');
});
test('destroy during import leaves request unacknowledged and does not open later paths', async () => {
  let release, acknowledgements = 0;
  const started = new Promise(resolve => { release = resolve; });
  const paths = [];
  const owner = createLaunchOpenController({ launch: { subscribe: async () => () => {}, peek: async () => ({ id: 'one', paths: ['first.md', 'second.md'] }), acknowledge: async () => acknowledgements++ },
    openPath: async path => { paths.push(path); await started; }, reportError: error => { throw error; } });
  const start = owner.start(); await new Promise(resolve => setImmediate(resolve));
  await owner.destroy(); release(); await start;
  assert.deepEqual(paths, ['first.md']); assert.equal(acknowledgements, 0);
});
test('secondary windows cannot reset or overwrite another window session metadata', () => {
  const map = new Map(); const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
  const main = createWindowSessionStorage(storage), second = createWindowSessionStorage(storage, 'session-123-1');
  main.setItem('md_editor_documents', 'main'); second.setItem('md_editor_documents', 'second');
  second.removeItem('md_editor_documents'); assert.equal(main.getItem('md_editor_documents'), 'main');
  assert.equal(second.getItem('md_editor_documents'), null);
  assert.throws(() => createWindowSessionStorage(storage, '../main'));
});
