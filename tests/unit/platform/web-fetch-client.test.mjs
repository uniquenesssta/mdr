import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createWebFetchClient } from '../../../src/platform/index.js';

function createInvokeRecorder(result) {
  const calls = [];
  const invoke = async (operation, args, details, options) => {
    calls.push({ operation, args, details, options });
    return result;
  };
  return { invoke, calls };
}

test('Atomic Task 3.9 maps fetch_url without changing the existing URL payload', async () => {
  const response = Object.freeze({ success: true, html: '<p>ok</p>', final_url: 'https://example.com/' });
  const { invoke, calls } = createInvokeRecorder(response);
  const client = createWebFetchClient({ invoke });

  assert.equal(await client.fetchUrl(' example.com '), response);
  assert.deepEqual(calls, [{
    operation: 'fetch_url',
    args: { url: ' example.com ' },
    details: { inputLength: 13 },
    options: undefined
  }]);
  assert.ok(Object.isFrozen(client));
});

test('web-fetch client preserves native result and error identity', async () => {
  const result = Object.freeze({ success: true, html: 'body' });
  const success = createWebFetchClient({ invoke: async () => result });
  assert.equal(await success.fetchUrl('https://example.com'), result);

  const expected = new Error('Request failed');
  const failure = createWebFetchClient({ invoke: async () => { throw expected; } });
  await assert.rejects(failure.fetchUrl('https://example.com'), error => error === expected);
});

test('Rust remains authoritative for URL normalization, redirects and HTTP validation', async () => {
  const clientSource = await readFile(new URL('../../../src/platform/desktop/web-fetch-client.js', import.meta.url), 'utf8');
  const rustSource = await readFile(new URL('../../../src-tauri/src/web_fetch.rs', import.meta.url), 'utf8');

  assert.doesNotMatch(clientSource, /startsWith\(['"]https|reqwest|redirect\(|redirect::|Unsupported URL scheme|Response body is empty|status\.is_success/);
  assert.match(rustSource, /fn normalize_url/);
  assert.match(rustSource, /redirect\(reqwest::redirect::Policy::limited\(10\)\)/);
  assert.match(rustSource, /Unsupported URL scheme/);
  assert.match(rustSource, /Response body is empty/);
});

test('invalid web-fetch client dependencies fail at the adapter boundary', () => {
  assert.throws(() => createWebFetchClient(null), /options must be an object/);
  assert.throws(() => createWebFetchClient(), /requires an invoke function/);
  assert.throws(() => createWebFetchClient({ invoke: null }), /requires an invoke function/);
});

test('legacy runtime delegates fetchUrl through the dedicated client', async () => {
  const source = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');
  assert.match(source, /createWebFetchClient\(\{ invoke: invokeClient\.invoke \}\)/);
  assert.match(source, /return webFetchClient\.fetchUrl\(url\)/);
  assert.doesNotMatch(source, /invokeClient\.invoke\('fetch_url'/);
});
