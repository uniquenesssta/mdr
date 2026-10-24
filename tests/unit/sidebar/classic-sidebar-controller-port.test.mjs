import test from 'node:test';
import assert from 'node:assert/strict';
import { createSidebarTabController, createSidebarState } from '../../../src/features/sidebar/index.js';
function fixture() {
  const state = createSidebarState(), listeners = new Map(), calls = [];
  const tabs = {}, panels = {};
  for (const tab of ['docs','files','outline']) {
    tabs[tab] = { classList: { toggle() {} }, addEventListener(_type, callback) { listeners.set(tab, callback); }, removeEventListener() { listeners.delete(tab); } };
    panels[tab] = { classList: { toggle() {} } };
  }
  const controller = createSidebarTabController({ state, tabs, panels, storage: { get: () => 'files', set: async () => {} } });
  return { controller, state, listeners, calls };
}
test('R16-08 direct Sidebar controller projects its canonical state and owns registered child lifecycles', async () => {
  const h = fixture();
  const unregister = h.controller.registerLifecycle('outline', { activate: () => h.calls.push('activate'), deactivate: () => h.calls.push('deactivate') });
  h.controller.start(); assert.equal(h.controller.activeTab, 'files'); assert.equal(h.controller.isActive('files'), true);
  await h.controller.select('outline', { reason: 'test' });
  assert.equal(h.controller.activeTab, h.state.snapshot.activeTab); assert.equal(h.controller.activeTab, 'outline');
  assert.deepEqual(h.calls, ['activate']);
  unregister(); assert.deepEqual(h.calls, ['activate','deactivate']);
  h.controller.destroy(); assert.equal(h.listeners.size, 0); h.state.destroy();
});
test('R16-08 Sidebar lifecycle registration is unique and controller disposal is terminal', () => {
  const h = fixture(); h.controller.registerLifecycle('outline', { activate() {}, deactivate() {} });
  assert.throws(() => h.controller.registerLifecycle('outline', { activate() {}, deactivate() {} }), /already/);
  h.controller.start(); h.controller.destroy(); h.controller.destroy();
  assert.equal(h.listeners.size, 0);
  assert.throws(() => h.controller.isActive('docs'), /destroyed/);
  assert.throws(() => h.controller.select('files'), /destroyed/); h.state.destroy();
});
