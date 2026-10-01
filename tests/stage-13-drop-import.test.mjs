import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { createDropImportController, mountClassicDropImportPort } from '../src/features/import/index.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}, commands = {}) {
  const handlers = new Map(), calls = [], errors = []; let visible = false;
  const target = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => { assert.equal(handlers.get(name), fn); handlers.delete(name); }
  };
  const c = createDropImportController({ target, onSubscriptionError: e => errors.push(e), ...options });
  const callbacks = {
    setOverlayVisible: value => { visible = value; },
    openBrowserText: file => { calls.push(['browserText', file]); return true; },
    openBrowserImage: file => { calls.push(['browserImage', file]); return true; },
    openNativeText: path => { calls.push(['nativeText', path]); return true; },
    openNativeImage: path => { calls.push(['nativeImage', path]); return true; },
    unsupported: value => calls.push(['unsupported', value]),
    onError: error => calls.push(['error', error]), ...commands
  };
  c.start(callbacks);
  return { c, callbacks, handlers, calls, errors, get visible() { return visible; }, fire(type, files) { return handlers.get(type)({ preventDefault() { calls.push(['prevent', type]); }, dataTransfer: { files } }); } };
}

test('nested DOM drag counters balance, clamp and reset on empty drop; destroy removes every listener', async () => {
  const h = harness(); assert.equal(h.handlers.size, 4);
  h.fire('dragenter'); h.fire('dragenter'); h.fire('dragleave'); assert.equal(h.visible, true);
  h.fire('dragleave'); h.fire('dragleave'); assert.equal(h.visible, false);
  h.fire('dragenter'); h.fire('dragover'); assert.equal(h.visible, true);
  assert.equal(await h.fire('drop', []), false); assert.equal(h.visible, false);
  h.fire('dragenter'); const late = h.handlers.get('dragenter'); h.c.destroy(); h.c.destroy();
  assert.equal(h.visible, false); assert.equal(h.handlers.size, 0);
  late({ preventDefault() { assert.fail('late event must not run'); } });
  assert.throws(() => h.c.openPath('a.md'), /destroyed/);
  assert.throws(() => h.c.start(h.callbacks), /destroyed/);
});

test('browser routes only first metadata item, text before MIME, with no content access', async () => {
  const h = harness();
  const file = { name: 'a.MD', type: 'image/png' };
  for (const key of ['content', 'text', 'arrayBuffer', 'size']) Object.defineProperty(file, key, { get() { assert.fail('controller read ' + key); } });
  assert.equal(await h.fire('drop', [file, { name: 'ignored.md' }]), true);
  assert.equal(h.calls[1][0], 'browserText'); assert.equal(h.calls[1][1], file);
  await h.fire('drop', [{ name: 'photo.bin', type: 'image/bmp' }]); assert.equal(h.calls.at(-1)[0], 'browserImage');
  await h.fire('drop', [{ name: 'a.pdf', type: '' }]); assert.equal(h.calls.at(-1)[0], 'unsupported');
  h.c.destroy();
});

test('native normalized events suppress DOM duplicate, use first path and clear overlay on leave', async () => {
  let handler, disposed = 0;
  const h = harness({ nativeDrop: true, nativeFiles: true, subscribeNative: fn => { handler = fn; return () => disposed++; } });
  await tick(); await h.fire('drop', [{ name: 'duplicate.md' }]); assert.equal(h.calls.length, 1);
  await handler({ type: 'over' }); assert.equal(h.visible, true);
  assert.equal(await handler({ type: 'drop', paths: [' C:\\a.MD ', 'C:\\b.md'] }), true);
  assert.deepEqual(h.calls.at(-1), ['nativeText', 'C:\\a.MD']); assert.equal(h.visible, false);
  await handler({ type: 'over' }); await handler({ type: 'leave' }); assert.equal(h.visible, false);
  assert.equal(await h.c.openPath('a.bmp'), false); assert.equal(h.calls.at(-1)[0], 'unsupported');
  assert.equal(await h.c.openPath('a.SVG'), true); assert.equal(h.calls.at(-1)[0], 'nativeImage');
  assert.equal(await h.c.openPath(' '), false);
  await h.c.destroy(); await handler({ type: 'over' }); assert.equal(h.visible, false); assert.equal(disposed, 1);
});

test('native subscription arriving after destroy is disposed once and cannot route', async () => {
  const pending = deferred(); let handler, disposed = 0;
  const h = harness({ nativeDrop: true, nativeFiles: true, subscribeNative: fn => { handler = fn; return pending.promise; } });
  h.c.destroy(); pending.resolve(() => disposed++); await tick();
  assert.equal(disposed, 1); assert.equal(await handler({ type: 'drop', paths: ['a.md'] }), false);
  assert.deepEqual(h.calls, []); h.c.destroy(); assert.equal(disposed, 1);
});

test('native subscription and cleanup failures report once without unhandled rejection', async () => {
  const error = new Error('native unavailable');
  for (const subscribeNative of [() => { throw error; }, () => Promise.reject(error), () => Promise.resolve(undefined)]) {
    const h = harness({ nativeDrop: true, subscribeNative }); await tick(); assert.equal(h.errors.length, 1); h.c.destroy();
  }
  const h = harness({ nativeDrop: true, subscribeNative: () => () => { throw error; } }); await tick();
  await h.c.destroy(); assert.deepEqual(h.errors, [error]);
});

test('new drops and destruction invalidate pending commands and suppress stale failure notifications', async () => {
  for (const mode of ['replace', 'destroy']) {
    const pending = deferred(); let request;
    const h = harness({}, { openBrowserImage: (_file, value) => { request = value; return pending.promise; } });
    const reading = h.fire('drop', [{ name: 'a.png', type: 'image/png' }]); assert.equal(request.isCurrent(), true);
    if (mode === 'replace') await h.fire('drop', [{ name: 'new.md' }]); else h.c.destroy();
    assert.equal(request.isCurrent(), false); pending.reject(new Error('late failure')); assert.equal(await reading, false);
    assert.equal(h.calls.some(call => call[0] === 'error'), false); h.c.destroy();
  }
  const error = new Error('read failed');
  const h = harness({}, { openBrowserText: () => { throw error; } });
  assert.equal(await h.fire('drop', [{ name: 'a.md' }]), false); assert.deepEqual(h.calls.at(-1), ['error', error]); h.c.destroy();
});

test('scoped drop bridge has duplicate protection, terminal teardown and safe remount', async () => {
  const target = { addEventListener() {}, removeEventListener() {} };
  const c = createDropImportController({ target });
  assert.throws(() => c.openPath('a.md'), /not started/);
  assert.throws(() => c.start({}), /requires setOverlayVisible/);
  assert.throws(() => mountClassicDropImportPort(null, c), /requires a host/);
  const host = {}, mounted = mountClassicDropImportPort(host, c), api = mounted.api;
  assert.equal(host.markdownEditorDropImportPort, api); assert.equal(Object.isFrozen(api), true); assert.deepEqual(Object.keys(host), []);
  assert.throws(() => mountClassicDropImportPort(host, c), /already mounted/);
  const h = harness(); api.register(h.callbacks); assert.equal(await api.openPath('a.md'), false);
  assert.throws(() => api.register(h.callbacks), /already started/);
  mounted.destroy(); mounted.destroy(); assert.equal(Object.hasOwn(host, 'markdownEditorDropImportPort'), false);
  assert.throws(() => api.openPath('a.md'), /destroyed/); assert.throws(() => api.register({}), /destroyed/);
  const replacement = mountClassicDropImportPort(host, c); mounted.destroy(); assert.equal(host.markdownEditorDropImportPort, replacement.api);
  replacement.destroy(); c.destroy(); h.c.destroy();
});

test('production routing has one owner and deletes the obsolete classifier bridge', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [events, main, drop, fixture] = await Promise.all([read('public/app/events.js'), read('src/main.js'), read('src/features/import/files/drop-import-controller.js'), read('tests/architecture/fixtures/production-modules.json')]);
  assert.doesNotMatch(events, /dragCounter|addEventListener\('drag(?:enter|leave|over)'|addEventListener\('drop'|call\('dragDrop', 'subscribe'|eventsImportClassifierPort/);
  assert.match(events, /return eventsDropImportPort\.openPath\(path\)/);
  assert.doesNotMatch(drop, /FileReader|readAs|\.readText\(|\.readImage\(|showToast|classList/);
  assert.equal(main.match(/dropImportController\.destroy\(\)/g).length, 2);
  assert.equal(main.match(/dropImportPort\.destroy\(\)/g).length, 2);
  assert.doesNotMatch(fixture, /classic-import-classifier-port/);
  await assert.rejects(access(new URL('../src/features/import/compatibility/classic-import-classifier-port.js', import.meta.url)), { code: 'ENOENT' });
});
