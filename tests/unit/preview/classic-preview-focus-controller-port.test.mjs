import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewFocusController } from '../../../src/features/preview/index.js';
function fixture(overrides = {}) {
  const calls = [], pending = new Map();
  const scheduler = { schedule(channel, run) { pending.set(channel, run); return true; }, cancel(channel) { return pending.delete(channel); }, hasPending(channel) { return pending.has(channel); } };
  const controller = createPreviewFocusController({ scheduler });
  const capabilities = { isSuspended: () => false, isCursorTrackingEligible: () => true,
    getFocusSection: () => null, getMode: () => 'full', isVirtualWindowActive: () => true,
    virtualWindowContainsLine: () => true, refreshPreview: () => calls.push('refresh'),
    ensureLineVisible(line) { calls.push(['ensure', line]); return { line }; },
    invalidateAnchors: () => calls.push('invalidate'), scrollToLine: (...args) => calls.push(['scroll', ...args]), ...overrides };
  controller.connect(capabilities);
  return { controller, capabilities, calls, pending };
}
test('R16-08 direct focus capability schedules and positions through the canonical controller', async () => {
  const h = fixture();
  assert.equal(h.controller.scheduleCursorFocus(7), true);
  h.pending.get('focus')();
  assert.equal(await h.controller.focusLine(9, { scroll: false }), true);
  assert.deepEqual(h.calls, ['refresh', ['ensure', 9], 'invalidate']);
  assert.equal(h.controller.cancel(), true);
  assert.equal(h.pending.size, 0); h.controller.destroy();
});
test('R16-08 Focus validates dependencies and rejects a second capability owner', () => {
  assert.throws(() => createPreviewFocusController({ scheduler: {} }), /Scheduler/);
  const h = fixture();
  assert.throws(() => h.controller.connect(h.capabilities), /already connected/);
  h.controller.destroy(); h.controller.destroy();
  assert.throws(() => h.controller.cancel(), /destroyed/);
});
test('R16-08 cancelled chapter focus cannot position a late refreshed scope', async () => {
  let resolve; const wait = new Promise(done => { resolve = done; });
  const h = fixture({ getMode: () => 'chapter', virtualWindowContainsLine: () => false, refreshPreview: () => wait });
  const pending = h.controller.focusLine(40);
  h.controller.cancel(); resolve();
  assert.equal(await pending, false);
  assert.deepEqual(h.calls, []); h.controller.destroy();
  await assert.rejects(h.controller.focusLine(1), /destroyed/);
});
