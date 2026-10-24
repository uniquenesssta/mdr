import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewLayoutStability, PREVIEW_BEHAVIOR_THRESHOLDS } from '../../../src/features/preview/index.js';
function fixture() {
  const calls = [], root = { clientWidth: 400, clientHeight: 250 }, pane = { classList: { contains: () => false } };
  const capabilities = { isSuspended: () => false, hasStablePreview: () => true, inspectRenderTarget: () => ({ present: true }),
    render() {}, refreshViewport() {}, invalidateGeometry() {}, notifyGeometryChanged() {} };
  const owner = createPreviewLayoutStability({ root, pane, thresholds: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.layout,
    scheduler: { schedule(channel) { calls.push(['schedule', channel]); return 'scheduled'; }, cancel(channel) { calls.push(['cancel', channel]); return true; } },
    createResizeObserver: () => ({ observe(node) { calls.push(['observe', node]); }, disconnect() { calls.push(['disconnect']); } }) });
  return { owner, capabilities, calls, root, pane };
}
test('R16-08 direct Layout Stability owns observation and the layout scheduling channel', () => {
  const h = fixture(); assert.equal(h.owner.connect(h.capabilities), true);
  assert.equal(h.owner.start(), true); assert.equal(h.owner.start(), false);
  assert.equal(h.owner.requestRefresh({ forceRender: true }), 'scheduled');
  assert.equal(h.owner.cancel(), true);
  assert.deepEqual(h.calls, [['observe', h.pane], ['observe', h.root], ['schedule','layout'], ['cancel','layout']]);
  h.owner.destroy();
});
test('R16-08 Layout Stability rejects duplicate connections and disposes its observer exactly once', () => {
  const h = fixture(); h.owner.connect(h.capabilities); h.owner.start();
  assert.throws(() => h.owner.connect(h.capabilities), /already connected/);
  h.owner.destroy(); h.owner.destroy();
  assert.equal(h.calls.filter(row => row[0] === 'disconnect').length, 1);
  assert.throws(() => h.owner.start(), /destroyed/);
});
test('R16-08 Layout Stability validates each connected capability before activation', () => {
  const h = fixture(); assert.throws(() => h.owner.connect({}), /isSuspended/);
  assert.throws(() => h.owner.start(), /not connected/); h.owner.destroy();
});
