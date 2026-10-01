import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpConnection } from './e2e/lib/cdp-browser.mjs';

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
