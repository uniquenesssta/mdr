import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { createWebClipperController, createWebFetchCoordinator } from '../src/features/import/index.js';
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

test('public clipper input changes cancel coordinator results and release subscriptions', () => {
  const c = createWebFetchCoordinator();
  const controller = createWebClipperController({ fetchCoordinator: c, extract: value => value, convert: value => value, insertMarkdown() {} });
  controller.open(); const old = c.manualHtml(html);
  let changes = 0; const off = controller.subscribe(() => changes++);
  controller.setInput('url', 'changed');
  assert.equal(c.isCurrent(old), false); assert.equal(changes, 2);
  off(); controller.close(); assert.equal(changes, 2);
  controller.destroy(); controller.destroy();
  assert.throws(() => controller.setInput('manualHtml', html), /destroyed/); c.destroy();
});

test('clipper close/reopen and edited inputs reject late HTML', async () => {
  const waiting = deferred();
  const c = createWebFetchCoordinator({ nativeFetch: () => waiting.promise });
  const controller = createWebClipperController({ fetchCoordinator: c, extract: value => value, convert: value => value, insertMarkdown() {} });
  controller.open(); controller.setInput('url', 'old'); const pending = controller.fetch();
  controller.close(); controller.open(); waiting.resolve('late html'); await pending;
  assert.equal(controller.snapshot.hasContent, false); assert.equal(controller.snapshot.status, 'idle');
  controller.setInput('url', 'new'); await controller.fetch(); assert.equal(controller.snapshot.hasContent, true);
  controller.setInput('manualHtml', 'manual'); assert.equal(controller.snapshot.hasContent, false);
  controller.destroy(); c.destroy();
});

test('web routing has one feature owner and the production inventory includes it', async () => {
  const source = await readFile(new URL('../public/app/web-clipper.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /await fetch\(|allorigins|codetabs|fetchWithNativeBackend|status\.innerHTML/);
  assert.doesNotMatch(source, /openUrlModal|markdownEditorWeb(?:Clipper|Fetch)Port|webClipperDocumentUiCommandPort/);
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const menu = await readFile(new URL('../src/features/menu/compatibility/classic-menu-command-adapter.js', import.meta.url), 'utf8');
  assert.match(main, /openWebClipper: \(\) => webClipperView\.open\(\)/);
  assert.match(menu, /\[C\.IMPORT_WEB\]: \(\) => invokeDocument\('openWebClipper'\)/);
  const controller = await readFile(new URL('../src/features/import/web-clipper/web-clipper-controller.js', import.meta.url), 'utf8');
  assert.match(controller, /fetchCoordinator\.isCurrent\(result\)/);
  await assertProductionInventory();
});

test('retired import ports, global opener and inline clipper markup cannot re-enter production', async () => {
  for (const name of ['classic-web-fetch-port', 'classic-html-extractor-port', 'classic-html-markdown-port', 'classic-web-clipper-port']) {
    await assert.rejects(access(new URL('../src/features/import/compatibility/' + name + '.js', import.meta.url)), { code: 'ENOENT' });
  }
  const entry = await readFile(new URL('../src/features/import/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /mountClassic|compatibility\//);
  const html = await readFile(new URL('../public/compatibility/business-content.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="(?:url-modal|url-input|manual-html)"|openUrlModal/);
  const registry = await readFile(new URL('../src/ui/compatibility/mount-modal-shells.js', import.meta.url), 'utf8');
  assert.doesNotMatch(registry, /url-modal/);
  for (const name of ['web-clipper', 'events', 'editor-tools']) {
    const source = await readFile(new URL('../public/app/' + name + '.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /function\s+(?:openUrlModal|triggerImportFile|importFile|fetchUrl|insertUrlMarkdown)\s*\(|mountClassic(?:Web|Html)/);
  }
});
