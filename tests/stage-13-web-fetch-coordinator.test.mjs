import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createWebFetchCoordinator, mountClassicWebFetchPort } from '../src/features/import/index.js';
import { createWebFetchClient } from '../src/platform/desktop/web-fetch-client.js';
import { assertProductionInventory } from './support/production-inventory.mjs';

const html = '<p>' + 'article 中文 '.repeat(20) + '</p>';
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (text = html) => ({ ok: true, text: async () => text });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('native success/failure are explicit and never escape into a browser proxy', async () => {
  for (const value of [html, '', new Error('denied')]) {
    let calls = 0;
    const c = createWebFetchCoordinator({ nativeFetch: async (url, { signal }) => {
      calls++; assert.equal(url, 'https://example.test'); assert.equal(signal.aborted, false);
      if (value instanceof Error) throw value; return value;
    }, browserFetch: () => assert.fail('native fallback is forbidden') });
    const result = await c.fetchUrl(' https://example.test ', { useLocalProxy: true });
    assert.equal(result.source, 'native'); assert.equal(calls, 1);
    assert.equal(result.status, value === html ? 'success' : 'manual-required');
    assert.equal(result.html, value === html ? html : '');
    assert.equal(Object.isFrozen(result), true);
    c.destroy();
  }
});

test('local proxy retains URL encoding, content alias and error hints without public fallback', async () => {
  for (const data of [{ content: html }, { success: false, error: '<img onerror=bad()>', hint: '<script>bad()</script>' }, {}]) {
    const calls = [];
    const c = createWebFetchCoordinator({ browserFetch: async (url, options) => {
      calls.push(url); assert.ok(options.signal);
      return { ok: true, json: async () => data };
    } });
    const result = await c.fetchUrl('https://example.test/?a=1&b=2', { useLocalProxy: true, proxyUrl: ' http://localhost:8765/fetch ' });
    assert.deepEqual(calls, ['http://localhost:8765/fetch?url=https%3A%2F%2Fexample.test%2F%3Fa%3D1%26b%3D2']);
    assert.equal(result.status, data.content ? 'success' : 'manual-required');
    if (data.hint) assert.equal(result.hint, data.hint);
    c.destroy();
  }
});

test('public proxy order, JSON/base64 decoding, short body rejection and final failure stay explicit', async () => {
  for (const successAt of [0, 1, 2, -1]) {
    const calls = [];
    const c = createWebFetchCoordinator({ browserFetch: async url => {
      const index = calls.push(url) - 1;
      if (index !== successAt) return response('too short');
      return index === 1 ? { ok: true, json: async () => ({ contents: btoa('x'.repeat(110)) }) } : response();
    } });
    const result = await c.fetchUrl('example.test');
    assert.equal(calls.length, successAt < 0 ? 3 : successAt + 1);
    assert.match(calls[0], /allorigins.win\/raw/);
    if (calls.length > 1) assert.match(calls[1], /allorigins.win\/get/);
    if (calls.length > 2) assert.match(calls[2], /codetabs.com/);
    assert.equal(result.status, successAt < 0 ? 'manual-required' : 'success');
    if (successAt === 1) assert.equal(result.html, 'x'.repeat(110));
    c.destroy();
  }
});

test('replacement, parent abort, manual input and destruction settle requests and quarantine late results', async () => {
  for (const mode of ['replace', 'parent', 'manual', 'destroy']) {
    const waiting = deferred(); let signal;
    const c = createWebFetchCoordinator({ nativeFetch: (url, options) => {
      if (url === 'new') return Promise.resolve('new html');
      signal = options.signal; return waiting.promise;
    } });
    const parent = new AbortController();
    const pending = c.fetchUrl('old', { signal: parent.signal });
    let current;
    if (mode === 'replace') current = await c.fetchUrl('new');
    if (mode === 'parent') parent.abort();
    if (mode === 'manual') current = c.manualHtml(' <p>manual</p> ');
    if (mode === 'destroy') c.destroy();
    const old = await pending;
    assert.equal(old.status, 'cancelled'); assert.equal(signal.aborted, true); assert.equal(c.isCurrent(old), false);
    waiting.resolve('late html'); await tick();
    if (current) assert.equal(c.isCurrent(current), true);
    c.destroy(); c.destroy();
    await assert.rejects(c.fetchUrl('again'), /destroyed/);
  }
});

test('empty and pre-aborted requests do no I/O; one total deadline stops proxy fallback', async () => {
  let calls = 0, signal;
  const c = createWebFetchCoordinator({ timeoutMs: 15, browserFetch: (_url, options) => {
    calls++; signal = options.signal; return new Promise(() => {});
  } });
  assert.equal((await c.fetchUrl(' ')).status, 'empty');
  const parent = new AbortController(); parent.abort();
  assert.equal((await c.fetchUrl('old', { signal: parent.signal })).status, 'cancelled');
  assert.equal(calls, 0);
  const result = await c.fetchUrl('example.test');
  assert.equal(result.status, 'manual-required'); assert.match(result.error, /exceeded/);
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
  c.destroy();
});

test('native adapter receives the exact request cancellation; cancellation failures remain observable', async () => {
  for (const fail of [false, true]) {
    const calls = [], errors = [], waiting = deferred();
    const client = createWebFetchClient({ invoke: async (name, args) => {
      calls.push({ name, args });
      if (name === 'fetch_url') return waiting.promise;
      if (fail) throw new Error('cancel IPC failed');
    } });
    const c = createWebFetchCoordinator({ nativeFetch: client.fetchUrl, onCleanupError: error => errors.push(error.message) });
    const pending = c.fetchUrl('https://example.test'); await tick(); c.cancel();
    assert.equal((await pending).status, 'cancelled'); await tick();
    assert.deepEqual(calls.map(x => x.name), ['fetch_url', 'cancel_fetch_url']);
    assert.equal(calls[0].args.requestId, calls[1].args.requestId);
    assert.deepEqual(errors, fail ? ['cancel IPC failed'] : []);
    waiting.resolve(html); await tick(); c.destroy();
  }
});

test('scoped classic port cancels input changes, removes listeners and preserves replacement owners', () => {
  const c = createWebFetchCoordinator(), host = {}, input = new EventTarget();
  const port = mountClassicWebFetchPort(host, c);
  let changes = 0; port.api.watchInputs([input], () => changes++);
  const old = c.manualHtml(html); input.dispatchEvent(new Event('input'));
  assert.equal(c.isCurrent(old), false); assert.equal(changes, 1);
  assert.throws(() => mountClassicWebFetchPort(host, c), /already mounted/);
  Object.defineProperty(host, 'markdownEditorWebFetchPort', { value: 'replacement', configurable: true });
  port.destroy(); port.destroy(); input.dispatchEvent(new Event('change'));
  assert.equal(changes, 1); assert.equal(host.markdownEditorWebFetchPort, 'replacement');
  assert.throws(() => port.api.manualHtml(html), /destroyed/); c.destroy();
});

test('classic UI close/reopen and edited inputs cannot receive late HTML; errors remain inert text', async () => {
  const source = await readFile(new URL('../public/app/web-clipper.js', import.meta.url), 'utf8');
  const waiting = deferred(), nodes = new Map();
  class Element extends EventTarget {
    value = ''; checked = false; textContent = ''; classList = { toggle() {}, remove() {}, add() {} };
    set innerHTML(_) { assert.fail('untrusted fetch error inserted as HTML'); }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const c = createWebFetchCoordinator({ nativeFetch: url => url === 'bad' ? Promise.reject(new Error('<img onerror=bad()>')) : waiting.promise });
  const port = mountClassicWebFetchPort({}, c);
  const context = vm.createContext({ document: { getElementById: node }, fetchedHtml: '', webClipperFetchPort: port.api,
    webClipperPlatformPort: { supports: () => true }, CustomEvent: class extends Event { constructor(type, { detail }) { super(type); this.detail = detail; } },
    t: (key, error) => error || key });
  vm.runInContext(source.slice(source.indexOf('    function setClipperHidden'), source.indexOf('    // 提取网页元信息')), context);
  let onClose; node('url-modal').addEventListener('markdown-editor:modal-shell-open', event => { onClose = event.detail.options.onClose; });
  context.openUrlModal(); node('url-input').value = 'old'; const pending = context.fetchUrl();
  onClose(); context.openUrlModal(); waiting.resolve('late html'); await pending;
  assert.equal(context.fetchedHtml, ''); assert.equal(node('url-status').textContent, '');
  node('url-input').value = 'bad'; await context.fetchUrl();
  assert.equal(node('url-status').textContent, '<img onerror=bad()>');
  context.fetchedHtml = 'previous'; node('url-input').dispatchEvent(new Event('input'));
  assert.equal(context.fetchedHtml, ''); port.destroy(); c.destroy();
});

test('web routing has one feature owner and the production inventory includes it', async () => {
  const source = await readFile(new URL('../public/app/web-clipper.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /await fetch\(|allorigins|codetabs|fetchWithNativeBackend|status\.innerHTML/);
  assert.match(source, /webClipperFetchPort\.isCurrent\(result\)/);
  await assertProductionInventory();
});
