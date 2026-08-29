import test from 'node:test';
import assert from 'node:assert/strict';
import { mountClassicSubmenuPositionerPort } from '../../../src/features/menu/compatibility/classic-submenu-positioner-port.js';

test('Atomic 6.11 classic submenu port delegates close without owning geometry state and unmounts exactly itself', () => {
  const calls = [];
  const host = {};
  const positioner = { closeAll() { calls.push('close'); return true; } };
  const mounted = mountClassicSubmenuPositionerPort(host, positioner);
  assert.equal(host.markdownEditorSubmenuPositionerPort.closeAll(), true);
  assert.deepEqual(calls, ['close']);
  assert.throws(() => mountClassicSubmenuPositionerPort(host, positioner), /already mounted/);
  mounted.destroy();
  assert.equal(host.markdownEditorSubmenuPositionerPort, undefined);
  assert.throws(() => mounted.api.closeAll(), /destroyed/);
  mounted.destroy();
});
