import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createE2EBridge } from '../src/features/e2e/index.js';
import { configureMarkdownEditorE2EPorts, installMarkdownEditorE2EBridge, destroyMarkdownEditorE2EBridge } from '../src/features/e2e/index.js';

function fixture(t, overrides = {}) {
  const host = {}, calls = [];
  let environment = { url: 'http://localhost/', testFlag: false }, queryCount = 0, disposed = 0;
  const api = Object.freeze({ snapshot: () => Object.freeze({ ready: true }), destroy: () => { disposed += 1; } });
  const ports = {
    readEnvironment: () => { calls.push('environment'); return environment; },
    readSlotDescriptor: () => { calls.push('read'); return Object.getOwnPropertyDescriptor(host, 'api'); },
    defineSlot: descriptor => { calls.push('define'); Object.defineProperty(host, 'api', descriptor); },
    deleteSlot: () => { calls.push('delete'); return Reflect.deleteProperty(host, 'api'); },
    ...overrides
  };
  const owner = createE2EBridge(ports);
  t.after(() => owner.destroy());
  return { host, calls, ports, api, owner,
    get environment() { return environment; }, set environment(value) { environment = value; },
    get queryCount() { return queryCount; }, get disposed() { return disposed; },
    configure: () => owner.configure(() => { queryCount += 1; return api; }),
    enable() { environment = { url: 'http://localhost/?e2e=1', testFlag: false }; }
  };
}

test('R15-10 installation is a public DOM-free owner and Runtime delegates its sole gate', () => {
  const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  assert.match(source('src/features/e2e/index.js'), /export \{ createE2EBridge \}/);
  assert.doesNotMatch(source('src/features/e2e/e2e-bridge.js'), /globalThis\.|window\.|document\.|querySelector|setTimeout\(|requestAnimationFrame\(/);
  const runtime = source('src/features/e2e/browser-e2e-bridge.js');
  assert.match(runtime, /createE2EBridge/); assert.match(runtime, /getInstallation\(\)\.install\(\)/);
  assert.doesNotMatch(runtime, /function isE2EEnabled|searchParams|let providers|let installed|previousDescriptor/);
});
for (const name of ['readEnvironment', 'readSlotDescriptor', 'defineSlot', 'deleteSlot']) {
  test('R15-10 validates installation dependency ' + name, t => assert.throws(() => fixture(t, { [name]: null }), TypeError));
}
test('R15-10 construction is cold and exposes frozen scalar diagnostics only', t => {
  const f = fixture(t); assert.deepEqual(f.calls, []); assert.equal(Object.isFrozen(f.owner), true);
  assert.deepEqual(f.owner.getState(), { destroyed: false, cleanupFailed: false, installing: false, installed: false, configured: false });
  assert.equal(Object.isFrozen(f.owner.getState()), true);
});
for (const [name, environment, enabled] of [
  ['default', { url: 'http://localhost/' }, false],
  ['exact query', { url: 'http://localhost/?e2e=1' }, true],
  ['encoded query', { url: 'http://localhost/?e2e=%31' }, true],
  ['wrong query', { url: 'http://localhost/?e2e=true' }, false],
  ['zero query', { url: 'http://localhost/?e2e=0' }, false],
  ['leading zero query', { url: 'http://localhost/?e2e=01' }, false],
  ['fragment', { url: 'http://localhost/#?e2e=1' }, false],
  ['duplicate first value', { url: 'http://localhost/?e2e=0&e2e=1' }, false],
  ['strict flag', { url: 'http://localhost/', testFlag: true }, true],
  ['string flag', { url: 'http://localhost/', testFlag: 'true' }, false],
  ['numeric flag', { url: 'http://localhost/', testFlag: 1 }, false],
  ['false flag with query', { url: 'http://localhost/?e2e=1', testFlag: false }, true],
  ['malformed URL', { url: 'http://[' }, false],
  ['flag despite malformed URL', { url: 'http://[', testFlag: true }, true]
]) test('R15-10 gate handles ' + name, t => {
  const f = fixture(t); f.environment = environment; assert.equal(f.configure(), enabled);
  assert.equal(f.queryCount, 0); assert.equal(f.owner.install(), enabled ? f.api : null);
  assert.equal(f.queryCount, enabled ? 1 : 0); assert.equal(Object.hasOwn(f.host, 'api'), enabled);
  if (!enabled) assert.deepEqual(f.calls.filter(value => value !== 'environment'), []);
});
test('R15-10 unreadable environment fails closed without reading or publishing the slot', t => {
  const f = fixture(t, { readEnvironment: () => { throw Error('PRIVATE'); } });
  assert.equal(f.configure(), false); assert.equal(f.owner.install(), null); assert.equal(f.queryCount, 0); assert.deepEqual(f.calls, []);
});
test('R15-10 enabled installation requires configuration and leaves the host unchanged', t => {
  const f = fixture(t); f.enable(); assert.throws(() => f.owner.install(), /^Error: E2E configuration unavailable$/); assert.equal(Object.hasOwn(f.host, 'api'), false);
});
test('R15-10 disabling the gate discards the configured factory', t => {
  const f = fixture(t); f.enable(); f.configure(); f.environment = { url: 'http://localhost/' };
  assert.equal(f.owner.install(), null); assert.equal(f.owner.getState().configured, false); f.enable();
  assert.throws(() => f.owner.install(), /configuration unavailable/); assert.equal(f.queryCount, 0);
});
test('R15-10 installs once and destroy removes the exact owned global and query', t => {
  const f = fixture(t); f.enable(); f.configure(); assert.equal(f.owner.install(), f.api);
  assert.equal(f.owner.install(), null); assert.throws(() => f.configure(), /bridge busy/); assert.equal(f.queryCount, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.host, 'api'), { value: f.api, configurable: true, enumerable: false, writable: false });
  assert.equal(f.owner.destroy(), true); assert.equal(f.owner.destroy(), true); assert.equal(f.disposed, 1);
  assert.equal(Object.hasOwn(f.host, 'api'), false); assert.equal(f.owner.getState().configured, false);
  assert.throws(() => f.configure(), /bridge unavailable/); assert.throws(() => f.owner.install(), /bridge unavailable/);
});
test('R15-10 restores a pre-existing falsy data descriptor exactly', t => {
  const f = fixture(t); Object.defineProperty(f.host, 'api', { value: null, configurable: true, enumerable: true, writable: true });
  const before = Object.getOwnPropertyDescriptor(f.host, 'api'); f.enable(); f.configure(); f.owner.install();
  assert.equal(f.owner.destroy(), true); assert.deepEqual(Object.getOwnPropertyDescriptor(f.host, 'api'), before);
});
for (const kind of ['external', 'accessor', 'locked']) test('R15-10 preserves a pre-existing ' + kind + ' slot without constructing queries', t => {
  const f = fixture(t); let reads = 0;
  Object.defineProperty(f.host, 'api', kind === 'accessor' ? { configurable: true, get() { reads += 1; throw Error('PRIVATE'); } }
    : { value: kind === 'locked' ? undefined : { external: true }, configurable: kind !== 'locked' });
  const before = Object.getOwnPropertyDescriptor(f.host, 'api'); f.enable(); f.configure(); assert.equal(f.owner.install(), null);
  assert.equal(f.queryCount, 0); assert.equal(reads, 0); f.owner.destroy(); assert.deepEqual(Object.getOwnPropertyDescriptor(f.host, 'api'), before);
});
test('R15-10 teardown preserves a later external replacement', t => {
  const f = fixture(t); f.enable(); f.configure(); f.owner.install(); const replacement = { external: true };
  Object.defineProperty(f.host, 'api', { value: replacement, configurable: true });
  assert.equal(f.owner.destroy(), true); assert.equal(f.host.api, replacement); assert.equal(f.disposed, 1);
});
test('R15-10 throwing factory leaves no global and permits a clean retry', t => {
  const f = fixture(t); f.enable(); f.owner.configure(() => { throw Error('PRIVATE'); });
  assert.throws(() => f.owner.install(), /^Error: E2E installation unavailable$/); assert.equal(Object.hasOwn(f.host, 'api'), false);
  f.configure(); assert.equal(f.owner.install(), f.api);
});
test('R15-10 publication failure disposes the query and rolls back a partial write', t => {
  let f; f = fixture(t, { defineSlot: descriptor => { Object.defineProperty(f.host, 'api', descriptor); throw Error('PRIVATE'); } });
  f.enable(); f.configure(); assert.throws(() => f.owner.install(), /^Error: E2E installation unavailable$/);
  assert.equal(Object.hasOwn(f.host, 'api'), false); assert.equal(f.disposed, 1); assert.equal(f.owner.getState().installed, false);
});
test('R15-10 silent publication failure is detected without accepting a missing global', t => {
  const f = fixture(t, { defineSlot: () => {} }); f.enable(); f.configure();
  assert.throws(() => f.owner.install(), /^Error: E2E installation unavailable$/); assert.equal(f.disposed, 1); assert.equal(Object.hasOwn(f.host, 'api'), false);
});
test('R15-10 destroy during query construction blocks publication and disposes late queries', t => {
  const f = fixture(t); f.enable(); f.owner.configure(() => { f.owner.destroy(); return f.api; });
  assert.throws(() => f.owner.install(), /^Error: E2E installation unavailable$/); assert.equal(f.disposed, 1); assert.equal(Object.hasOwn(f.host, 'api'), false);
});
test('R15-10 destroy during publication removes a late host write', t => {
  let f; f = fixture(t, { defineSlot: descriptor => { f.owner.destroy(); Object.defineProperty(f.host, 'api', descriptor); } });
  f.enable(); f.configure(); assert.throws(() => f.owner.install(), /^Error: E2E installation unavailable$/);
  assert.equal(f.disposed, 1); assert.equal(Object.hasOwn(f.host, 'api'), false); assert.equal(f.owner.getState().destroyed, true);
});
test('R15-10 replacement during query construction is never overwritten', t => {
  const f = fixture(t), replacement = { external: true }; f.enable();
  f.owner.configure(() => { Object.defineProperty(f.host, 'api', { configurable: true, value: replacement }); return f.api; });
  assert.throws(() => f.owner.install(), /installation unavailable/); assert.equal(f.host.api, replacement); assert.equal(f.disposed, 1);
});
test('R15-10 read failure never allocates a query or discloses host errors', t => {
  const f = fixture(t, { readSlotDescriptor: () => { throw Error('PRIVATE'); } }); f.enable(); f.configure();
  assert.throws(() => f.owner.install(), /^Error: E2E installation unavailable$/); assert.equal(f.queryCount, 0);
});
test('R15-10 locked owned global reports incomplete cleanup but disposes queries', t => {
  const f = fixture(t); f.enable(); f.configure(); f.owner.install(); Object.defineProperty(f.host, 'api', { configurable: false });
  assert.equal(f.owner.destroy(), false); assert.equal(f.disposed, 1); assert.equal(f.owner.getState().cleanupFailed, true); assert.equal(f.owner.destroy(), false);
});
test('R15-10 query disposal failure still removes its global and reports failure', t => {
  const f = fixture(t); f.enable(); f.owner.configure(() => ({ destroy() { throw Error('PRIVATE'); } })); f.owner.install();
  assert.equal(f.owner.destroy(), false); assert.equal(Object.hasOwn(f.host, 'api'), false); assert.equal(f.owner.getState().cleanupFailed, true);
});
test('R15-10 restore failures are checked after the descriptor write', t => {
  let f, writes = 0; f = fixture(t, { defineSlot: descriptor => { if (++writes === 1) Object.defineProperty(f.host, 'api', descriptor); } });
  Object.defineProperty(f.host, 'api', { value: null, configurable: true }); f.enable(); f.configure(); f.owner.install();
  assert.equal(f.owner.destroy(), false); assert.equal(f.disposed, 1); assert.equal(f.owner.getState().cleanupFailed, true);
});
test('R15-10 reentrant host read can destroy the owner before any publication', t => {
  let f, reads = 0; f = fixture(t, { readSlotDescriptor: () => { if (++reads === 2) f.owner.destroy(); return Object.getOwnPropertyDescriptor(f.host, 'api'); } });
  f.enable(); f.configure(); assert.throws(() => f.owner.install(), /installation unavailable/);
  assert.equal(f.disposed, 1); assert.equal(f.calls.includes('define'), false); assert.equal(Object.hasOwn(f.host, 'api'), false);
});
test('R15-10 actual Runtime clears a prior configuration when the gate is disabled', t => {
  const saved = new Map(['__MARKDOWN_EDITOR_E2E__', '__markdownEditorE2E', 'location'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    destroyMarkdownEditorE2EBridge();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://localhost/' } });
  Object.defineProperty(globalThis, '__MARKDOWN_EDITOR_E2E__', { configurable: true, writable: true, value: true });
  Object.defineProperty(globalThis, '__markdownEditorE2E', { configurable: true, value: undefined });
  configureMarkdownEditorE2EPorts({ editorApi: { getText:()=>'' }, importDocument:async()=>false, readContext: () => ({ documentId: 'fixture', generation: 1, version: 0 }), readPreviewStats: () => null });
  globalThis.__MARKDOWN_EDITOR_E2E__ = false;
  configureMarkdownEditorE2EPorts(null);
  globalThis.__MARKDOWN_EDITOR_E2E__ = true;
  assert.throws(() => installMarkdownEditorE2EBridge(), /configuration unavailable/);
  assert.equal(globalThis.__markdownEditorE2E, undefined);
});
