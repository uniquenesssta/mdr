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
  const rustSource = await readFile(new URL('../../../src-tauri/src/web_fetch/command.rs', import.meta.url), 'utf8');
  const rustClientSource = await readFile(new URL('../../../src-tauri/src/web_fetch/client.rs', import.meta.url), 'utf8');
  const rustResponseSource = await readFile(new URL('../../../src-tauri/src/web_fetch/response.rs', import.meta.url), 'utf8');

  assert.doesNotMatch(clientSource, /startsWith\(['"]https|reqwest|redirect\(|redirect::|Unsupported URL scheme|Response body is empty|status\.is_success/);
  const policySource = await readFile(new URL('../../../src-tauri/src/web_fetch/validation.rs', import.meta.url), 'utf8');
  assert.match(policySource, /fn normalize_url/);
  assert.match(rustSource, /use super::validation::normalize_url/);
  assert.match(rustClientSource, /redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(policySource, /Unsupported URL scheme/);
  assert.match(rustSource, /read_response\(parsed, response\)\.await/);
  assert.match(rustResponseSource, /Response body is empty/);
});

test('invalid web-fetch client dependencies fail at the adapter boundary', () => {
  assert.throws(() => createWebFetchClient(null), /options must be an object/);
  assert.throws(() => createWebFetchClient(), /requires an invoke function/);
  assert.throws(() => createWebFetchClient({ invoke: null }), /requires an invoke function/);
});

test('desktop WebPort reaches the import coordinator through the application composition', async () => {
  const desktop = await readFile(new URL('../../../src/platform/desktop/desktop-platform.js', import.meta.url), 'utf8');
  const clipper = await readFile(new URL('../../../public/app/web-clipper.js', import.meta.url), 'utf8');
  assert.match(desktop, /webFetchClient\.fetchUrl\(url, options\)/);
  const main = await readFile(new URL('../../../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /nativeFetch: platform\.capabilities\.desktop\.webFetch \? \(url, options\) => platform\.web\.fetchText\(url, options\)/);
  assert.match(clipper, /webClipperDocumentUiCommandPort\.invoke\('openWebClipper'/);
  assert.doesNotMatch(clipper, /fetchWithNativeBackend|call\('web', 'fetchText'/);
  assert.doesNotMatch(clipper, /markdownEditorNative/);
});



test('AbortSignal cancels the native request with its exact identifier and ignores late success', async () => {
  const calls = [];
  let resolveFetch;
  const client = createWebFetchClient({ invoke: async (name, args) => {
    calls.push({ name, args });
    if (name === 'fetch_url') return new Promise(resolve => { resolveFetch = resolve; });
  } });
  const controller = new AbortController();
  const pending = client.fetchUrl('https://example.com', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(calls[1].name, 'cancel_fetch_url');
  assert.equal(calls[1].args.requestId, calls[0].args.requestId);
  assert.match(calls[0].args.requestId, /^[a-z0-9-]+$/i);
  resolveFetch({ html: 'stale' });
  await Promise.resolve();
});

test('pre-cancelled signals never invoke and completed calls remove their cancellation listener', async () => {
  const calls = [];
  const client = createWebFetchClient({ invoke: async (name) => { calls.push(name); return { html: 'ok' }; } });
  const before = new AbortController(); before.abort();
  await assert.rejects(client.fetchUrl('x', { signal: before.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 0);
  const after = new AbortController();
  assert.deepEqual(await client.fetchUrl('x', { signal: after.signal }), { html: 'ok' });
  after.abort(); await Promise.resolve();
  assert.deepEqual(calls, ['fetch_url']);
});

test('failed cancellation is reported and native fetch rejection preserves its cause', async () => {
  const failure = new Error('cancel transport failed');
  const client = createWebFetchClient({ invoke: async name => {
    if (name === 'cancel_fetch_url') throw failure;
    return new Promise(() => {});
  } });
  const controller = new AbortController();
  const pending = client.fetchUrl('x', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error === failure);
});


test('native cancellation arriving before its acknowledgement is normalized to AbortError', async () => {
  let rejectFetch;
  const controller = new AbortController();
  const client = createWebFetchClient({ invoke: async name => {
    if (name === 'fetch_url') return new Promise((_, reject) => { rejectFetch = reject; });
    rejectFetch('WEB_FETCH_CANCELLED');
    return new Promise(() => {});
  } });
  const pending = client.fetchUrl('x', { signal: controller.signal });
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, { name: 'AbortError', code: 'WEB_FETCH_CANCELLED' });
});
