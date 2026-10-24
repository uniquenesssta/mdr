import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmenuPositioner } from '../../../src/features/menu/index.js';
test('R16-08 explicit Submenu Positioner owns its lifecycle and no host publication', () => {
  const root = { querySelectorAll: () => [] }, runtime = { setTimeout: () => 1, clearTimeout() {} };
  const positioner = createSubmenuPositioner({ root, runtime });
  assert.equal(positioner.start(), true); assert.equal(positioner.start(), false);
  assert.equal(positioner.closeAll(), true);
  positioner.destroy(); positioner.destroy();
  assert.throws(() => positioner.closeAll(), /destroyed/);
  assert.throws(() => positioner.start(), /destroyed/);
  assert.equal(Object.hasOwn(root, 'markdownEditorSubmenuPositionerPort'), false);
});
