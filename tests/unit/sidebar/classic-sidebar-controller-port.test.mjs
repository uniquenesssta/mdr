import test from 'node:test';
import assert from 'node:assert/strict';
import { mountClassicSidebarControllerPort } from '../../../src/features/sidebar/compatibility/classic-sidebar-controller-port.js';

test('Atomic 6.7 classic Sidebar port forwards controller state and commands without copying state', async () => {
  const host = {};
  const calls = [];
  const controller = {
    activeTab: 'files',
    isActive(tab) { calls.push(['isActive', tab]); return tab === this.activeTab; },
    select(tab, options) { calls.push(['select', tab, options]); this.activeTab = tab; return Promise.resolve({ ok: true, activeTab: tab }); },
    registerLifecycle(tab, lifecycle) { calls.push(['register', tab, lifecycle]); return () => calls.push(['unregister', tab]); }
  };
  const port = mountClassicSidebarControllerPort(host, controller);
  assert.equal(host.markdownEditorSidebarControllerPort, port);
  assert.equal(port.activeTab, 'files');
  assert.equal(port.isActive('files'), true);
  const result = await port.select('outline', { reason: 'test' });
  assert.deepEqual(result, { ok: true, activeTab: 'outline' });
  assert.equal(port.activeTab, 'outline');
  const lifecycle = { activate() {}, deactivate() {} };
  const unregister = port.registerLifecycle('outline', lifecycle);
  unregister();
  assert.deepEqual(calls.map(item => item[0]), ['isActive', 'select', 'register', 'unregister']);
  port.destroy();
  assert.equal(host.markdownEditorSidebarControllerPort, undefined);
});

test('Atomic 6.7 classic Sidebar port rejects duplicate mount and becomes terminal after destroy', () => {
  const host = {};
  const controller = { activeTab: 'docs', isActive: () => false, select: () => Promise.resolve(), registerLifecycle: () => () => {} };
  const port = mountClassicSidebarControllerPort(host, controller);
  assert.throws(() => mountClassicSidebarControllerPort(host, controller), /already mounted/);
  port.destroy();
  port.destroy();
  assert.throws(() => port.isActive('docs'), /destroyed/);
  assert.throws(() => port.select('files'), /destroyed/);
});
