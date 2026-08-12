import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmenuPositioner, mountClassicSubmenuPositionerPort } from '../src/features/menu/index.js';

test('Atomic 6.11 public Menu entry exposes one lifecycle-owned Submenu Positioner boundary', () => {
  assert.equal(typeof createSubmenuPositioner, 'function');
  assert.equal(typeof mountClassicSubmenuPositionerPort, 'function');

  const runtime = {
    innerWidth: 800,
    innerHeight: 600,
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  const root = { ownerDocument: { defaultView: runtime, activeElement: null }, querySelectorAll() { return []; } };
  const positioner = createSubmenuPositioner({ root, runtime });
  const host = {};
  const mounted = mountClassicSubmenuPositionerPort(host, positioner);
  assert.equal(positioner.start(), true);
  assert.equal(host.markdownEditorSubmenuPositionerPort.closeAll(), true);
  mounted.destroy();
  positioner.destroy();
  assert.equal(host.markdownEditorSubmenuPositionerPort, undefined);
});
