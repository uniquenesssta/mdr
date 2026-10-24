import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewEnhancementCoordinator, PREVIEW_BEHAVIOR_THRESHOLDS } from '../../../src/features/preview/index.js';
function fixture() {
  const calls = [], pending = new Map();
  const coordinator = createPreviewEnhancementCoordinator({ thresholds: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.enhancement,
    scheduler: { schedule(channel, callback) { pending.set(channel, callback); return true; }, cancel(channel) { pending.delete(channel); calls.push(channel); }, hasPending() { return false; } } });
  const capabilities = { getLineRange: () => ({ start: 1, end: 1 }), getPriority: () => 0, hasMath: () => false,
    hasMermaid: () => false, isConnected: () => true, styleRoots() {}, renderMath() {}, renderMermaid() {},
    animate() {}, onBatchComplete() {}, isVersionCurrent: () => true };
  return { coordinator, calls, pending, capabilities };
}
test('R16-08 direct Enhancement Coordinator owns versions and cancellation of queued work', () => {
  const h = fixture(); h.coordinator.connect(h.capabilities);
  assert.equal(h.coordinator.begin(12), 12);
  assert.equal(h.coordinator.enqueue([{}]), 1);
  assert.ok(h.coordinator.getStats().pending > 0);
  assert.equal(h.pending.has('enhancement'), true);
  assert.equal(h.coordinator.cancel(), true);
  assert.equal(h.pending.size, 0); assert.equal(h.coordinator.getStats().pending, 0);
  h.coordinator.destroy();
});
test('R16-08 Enhancement Coordinator validates dependencies and one-time capability ownership', () => {
  const h = fixture(); assert.throws(() => h.coordinator.connect({}), /getLineRange/);
  h.coordinator.connect(h.capabilities);
  assert.throws(() => h.coordinator.connect(h.capabilities), /already connected/);
  assert.throws(() => h.coordinator.schedulePostprocess({ run: null }), /run/); h.coordinator.destroy();
});
test('R16-08 Enhancement disposal clears queued jobs and is terminal and idempotent', () => {
  const h = fixture(); h.coordinator.connect(h.capabilities); h.coordinator.begin(1); h.coordinator.enqueue([{}]);
  h.coordinator.destroy(); h.coordinator.destroy();
  assert.equal(h.pending.size, 0); assert.equal(h.coordinator.getStats().pending, 0);
  assert.throws(() => h.coordinator.cancel(), /destroyed/);
  assert.throws(() => h.coordinator.enqueue([{}]), /destroyed/);
});
