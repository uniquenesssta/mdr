import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpConnection, waitForJson } from './e2e/lib/cdp-browser.mjs';

test('an unanswered CDP cleanup command rejects and releases its pending entry', async () => {
  const connection = new CdpConnection('unused', { commandTimeoutMs: 20 });
  connection.socket = { readyState: WebSocket.OPEN, send() {}, close() {} };
  await assert.rejects(connection.send('Fetch.disable'), /Fetch.disable: CDP response timed out/);
  assert.equal(connection.pending.size, 0);
  connection.close();
});

test('explicit CDP close rejects in-flight commands without waiting for the socket event', async () => {
  const connection = new CdpConnection('unused', { commandTimeoutMs: 10000 });
  let closed = 0;
  connection.socket = { readyState: WebSocket.OPEN, send() {}, close() { closed++; } };
  const rejected = assert.rejects(connection.send('Runtime.evaluate'), /CDP connection closed/);
  connection.close();
  await rejected;
  assert.equal(connection.pending.size, 0);
  assert.equal(connection.listeners.size, 0);
  assert.equal(closed, 1);
});

test('a synchronous socket send failure does not leave a timeout or pending command', async () => {
  const connection = new CdpConnection('unused', { commandTimeoutMs: 10000 });
  connection.socket = { readyState: WebSocket.OPEN, send() { throw new Error('socket failed'); }, close() {} };
  await assert.rejects(connection.send('Fetch.disable'), /socket failed/);
  assert.equal(connection.pending.size, 0);
  connection.close();
});


test('CDP readiness aborts an unresponsive HTTP probe within its total deadline', async () => {
  let aborted = false;
  await assert.rejects(waitForJson('http://127.0.0.1:1/json/list', 100, {
    fetch: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('probe aborted')); }, { once: true });
    })
  }), /CDP endpoint did not become ready: probe aborted/);
  assert.equal(aborted, true);
});

test('CDP startup reports an exited process before attempting another connection', async () => {
  let requested = false;
  await assert.rejects(waitForJson('unused', 30000, {
    checkProcess() { throw new Error('Chromium exited before CDP readiness: code=1'); },
    fetch: async () => { requested = true; }
  }), /Chromium exited.*code=1/);
  assert.equal(requested, false);
});

test('CDP startup keeps the connection error cause and successful target JSON', async () => {
  await assert.rejects(waitForJson('owned-endpoint', 100, {
    fetch: async () => { throw new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }
  }), /endpoint=owned-endpoint; cause=ECONNREFUSED/);
  const targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://owned' }];
  assert.equal(await waitForJson('owned-endpoint', 1000, {
    fetch: async () => ({ ok: true, json: async () => targets })
  }), targets);
});
