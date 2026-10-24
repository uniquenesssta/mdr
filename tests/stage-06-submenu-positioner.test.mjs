import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmenuPositioner } from '../src/features/menu/index.js';
import * as menu from '../src/features/menu/index.js';

test('Atomic 6.11 public Menu entry exposes one lifecycle-owned Submenu Positioner boundary', () => {
  assert.equal(typeof createSubmenuPositioner, 'function');
  assert.equal(Object.hasOwn(menu, 'mountClassicSubmenuPositionerPort'), false);

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
  assert.equal(positioner.start(), true);
  assert.equal(positioner.closeAll(), true);
  positioner.destroy();
  assert.equal(host.markdownEditorSubmenuPositionerPort, undefined);
});
