import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmTaskkillExit } from './e2e/lib/cdp-browser.mjs';
const failure = () => Object.assign(new Error('taskkill failed'), { status: 255, stderr: Buffer.from('ERROR: process with PID 8028 (child process of PID 2908) could not be terminated.') });
test('taskkill race is accepted only when root and every reported child have exited', async () => {
  const seen = new Set(); let tick = 0;
  await confirmTaskkillExit(failure(), 2908, { wait: async () => { tick++; }, isRunning: pid => { seen.add(pid); return tick < 2; } });
  assert.equal(tick, 2); assert.deepEqual([...seen].sort(), [2908, 8028]);
});
test('surviving child, unknown command failure and inaccessible process remain failures', async () => {
  const error = failure();
  await assert.rejects(confirmTaskkillExit(error, 2908, { wait: async () => {}, attempts: 2, isRunning: pid => pid === 8028 }), value => value === error);
  const unknown = new Error('command unavailable');
  await assert.rejects(confirmTaskkillExit(unknown, 2908), value => value === unknown);
  const denied = Object.assign(new Error('denied'), { code: 'EPERM' });
  await assert.rejects(confirmTaskkillExit(error, 2908, { wait: async () => {}, isRunning: () => { throw denied; } }), value => value === denied);
});
