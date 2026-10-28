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

test('localized root-not-found termination still requires confirmed exit and preserves unrelated failures', async () => {
  const error = Object.assign(new Error('taskkill failed'), { status: 128, stderr: Buffer.from('错误: 没有找到进程 "2908"。') });
  const seen = []; let tick = 0;
  await confirmTaskkillExit(error, 2908, { wait: async () => { tick++; }, isRunning: pid => { seen.push(pid); return tick < 2; } });
  assert.equal(tick, 2); assert.deepEqual(seen, [2908, 2908]);
  await assert.rejects(confirmTaskkillExit(error, 2908, { wait: async () => {}, attempts: 2, isRunning: () => true }), value => value === error);
  const unrelated = Object.assign(new Error('another process'), { status: 128, stderr: Buffer.from('错误: 没有找到进程 "8000"。') });
  await assert.rejects(confirmTaskkillExit(unrelated, 2908, { isRunning: () => false }), value => value === unrelated);
  const denied = Object.assign(new Error('access denied'), { status: 5, stderr: Buffer.from('进程 "2908" 拒绝访问。') });
  await assert.rejects(confirmTaskkillExit(denied, 2908, { isRunning: () => false }), value => value === denied);
  const withParent = Object.assign(new Error('termination race'), { status: 128, stderr: Buffer.from('错误: 无法终止 PID 8028 (属于 PID 2908 子进程)的进程。\n错误: 无法终止 PID 2908 (属于 PID 9999 子进程)的进程。') });
  const probed = new Set();
  await confirmTaskkillExit(withParent, 2908, { wait: async () => {}, isRunning: pid => { probed.add(pid); return pid === 9999; } });
  assert.deepEqual([...probed].sort(), [2908, 8028]);
  await assert.rejects(confirmTaskkillExit(withParent, 2908, { wait: async () => {}, attempts: 2, isRunning: pid => pid === 8028 }), value => value === withParent);
});
