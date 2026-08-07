import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createLinkClient } from '../../../src/platform/index.js';

function createInvokeRecorder(result) {
  const calls = [];
  const invoke = async (operation, args, details, options) => {
    calls.push({ operation, args, details, options });
    return result;
  };
  return { invoke, calls };
}

test('Atomic Task 3.9 preserves legacy external-link trim and telemetry fields', async () => {
  const { invoke, calls } = createInvokeRecorder(undefined);
  const client = createLinkClient({ invoke });

  assert.equal(await client.openExternal('  MAILTO:test@example.com  '), undefined);
  assert.deepEqual(calls, [{
    operation: 'open_external_url',
    args: { url: 'MAILTO:test@example.com' },
    details: { scheme: 'mailto', inputLength: 23 },
    options: undefined
  }]);
  assert.ok(Object.isFrozen(client));
});

test('link client does not duplicate Rust supported-scheme policy', async () => {
  const calls = [];
  const client = createLinkClient({
    invoke: async (operation, args) => {
      calls.push({ operation, args });
      return 'delegated';
    }
  });

  assert.equal(await client.openExternal(' javascript:alert(1) '), 'delegated');
  assert.deepEqual(calls, [{ operation: 'open_external_url', args: { url: 'javascript:alert(1)' } }]);

  const clientSource = await readFile(new URL('../../../src/platform/desktop/link-client.js', import.meta.url), 'utf8');
  const rustSource = await readFile(new URL('../../../src-tauri/src/external_link.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(clientSource, /SUPPORTED_SCHEMES|mailto.*tel|javascript:|file:\/\//);
  assert.match(rustSource, /"http" \| "https" \| "mailto" \| "tel"/);
  assert.match(rustSource, /不支持打开此链接/);
});

test('link client preserves native result and error identity', async () => {
  const result = Object.freeze({ opened: true });
  const success = createLinkClient({ invoke: async () => result });
  assert.equal(await success.openExternal('https://example.com'), result);

  const expected = new Error('system open failed');
  const failure = createLinkClient({ invoke: async () => { throw expected; } });
  await assert.rejects(failure.openExternal('https://example.com'), error => error === expected);
});

test('invalid link client dependencies fail at the adapter boundary', () => {
  assert.throws(() => createLinkClient(null), /options must be an object/);
  assert.throws(() => createLinkClient(), /requires an invoke function/);
  assert.throws(() => createLinkClient({ invoke: null }), /requires an invoke function/);
});

test('legacy runtime delegates openExternalUrl through the dedicated client', async () => {
  const source = await readFile(new URL('../../../src/runtime/tauri.js', import.meta.url), 'utf8');
  assert.match(source, /createLinkClient\(\{ invoke: invokeClient\.invoke \}\)/);
  assert.match(source, /return linkClient\.openExternal\(url\)/);
  assert.doesNotMatch(source, /invokeClient\.invoke\('open_external_url'/);
});
