import assert from 'node:assert/strict';
import test from 'node:test';

import { mountClassicPreviewSchedulerPort } from '../../../src/features/preview/compatibility/classic-preview-scheduler-port.js';

function createScheduler() {
  const calls = [];
  return {
    calls,
    schedule(...args) { calls.push(['schedule', ...args]); return { token: 'task' }; },
    hasPending(channel) { calls.push(['hasPending', channel]); return channel === 'input'; },
    cancel(channel) { calls.push(['cancel', channel]); return true; },
    cancelAll() { calls.push(['cancelAll']); }
  };
}

test('Atomic 7.4 classic scheduler port delegates without owning scheduling state', () => {
  const host = {};
  const scheduler = createScheduler();
  const mount = mountClassicPreviewSchedulerPort(host, scheduler);
  const callback = () => {};
  const options = { kind: 'timeout', delay: 12 };

  assert.equal(Object.keys(host).includes('markdownEditorPreviewSchedulerPort'), false);
  assert.equal(host.markdownEditorPreviewSchedulerPort, mount.api);
  assert.deepEqual(mount.api.schedule('input', callback, options), { token: 'task' });
  assert.equal(mount.api.hasPending('input'), true);
  assert.equal(mount.api.cancel('focus'), true);
  mount.api.cancelAll();

  assert.deepEqual(scheduler.calls, [
    ['schedule', 'input', callback, options],
    ['hasPending', 'input'],
    ['cancel', 'focus'],
    ['cancelAll']
  ]);
});

test('Atomic 7.4 classic scheduler port unmount is idempotent and terminal', () => {
  const host = {};
  const scheduler = createScheduler();
  const mount = mountClassicPreviewSchedulerPort(host, scheduler);

  mount.destroy();
  mount.destroy();

  assert.equal(Object.hasOwn(host, 'markdownEditorPreviewSchedulerPort'), false);
  assert.throws(() => mount.api.cancel('input'), /destroyed/i);
  assert.doesNotThrow(() => scheduler.cancel('input'));
});
