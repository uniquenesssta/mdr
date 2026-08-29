import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_COMMAND_IDS as C, createMenuCommandBindings } from '../../../src/features/menu/menu-command-bindings.js';

test('Atomic 6.10 command bindings register handlers without owning business state', () => {
  const bindings = createMenuCommandBindings();
  const calls = [];
  const unregister = bindings.register(C.DOCUMENT_SAVE, payload => calls.push(payload));
  const execution = bindings.execute(C.DOCUMENT_SAVE, { source: 'menu' });
  assert.equal(execution.closeMenu, true);
  assert.deepEqual(calls, [{ source: 'menu' }]);
  assert.throws(() => bindings.register(C.DOCUMENT_SAVE, () => {}), /already registered/);
  unregister();
  assert.equal(bindings.has(C.DOCUMENT_SAVE), false);
  bindings.destroy();
  assert.throws(() => bindings.has(C.DOCUMENT_SAVE), /destroyed/);
});

test('Atomic 6.10 command bindings preserve stay-open policy independently of declaration', () => {
  const bindings = createMenuCommandBindings();
  bindings.register(C.EDITOR_TABLE_VISUAL_TOGGLE, () => true, { closeMenu: false });
  assert.equal(bindings.execute(C.EDITOR_TABLE_VISUAL_TOGGLE).closeMenu, false);
  bindings.destroy();
});
