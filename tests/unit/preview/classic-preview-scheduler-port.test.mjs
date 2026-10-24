import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewScheduler, createPreviewCancellation } from '../../../src/features/preview/index.js';
function fixture() {
  let next = 0; const timers = new Map(), cancellation = createPreviewCancellation();
  const scheduler = createPreviewScheduler({ cancellation, setTimer(fn) { const id = ++next; timers.set(id, () => { timers.delete(id); fn(); }); return id; }, clearTimer(id) { timers.delete(id); } });
  return { scheduler, cancellation, timers };
}
test('R16-08 explicit Preview scheduling coalesces work and cancelled callbacks cannot commit', async () => {
  const h = fixture(), calls = [];
  const old = h.scheduler.schedule('input', () => calls.push('old'), { delay: 12 });
  const late = [...h.timers.values()][0];
  const next = h.scheduler.schedule('input', () => calls.push('current'));
  assert.equal(old.signal.aborted, true);
  assert.equal(h.scheduler.hasPending('input'), true);
  late(); [...h.timers.values()][0](); await next.done; await old.done;
  assert.deepEqual(calls, ['current']);
  h.scheduler.cancelAll(); assert.equal(h.timers.size, 0);
  h.scheduler.destroy(); h.cancellation.destroy();
});
test('R16-08 scheduler rejects malformed work and terminal disposal clears every channel', () => {
  const h = fixture();
  assert.throws(() => h.scheduler.schedule('unknown', () => {}), /Unsupported/);
  for (const channel of ['input','focus','layout','enhancement']) h.scheduler.schedule(channel, () => {});
  assert.equal(h.timers.size, 4);
  h.scheduler.destroy(); h.scheduler.destroy();
  assert.equal(h.timers.size, 0);
  assert.throws(() => h.scheduler.cancel('input'), /destroyed/);
  h.cancellation.destroy();
});
