import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_COMMAND_IDS as C, MENU_DECLARATION, createMenuCommandBindings, createMenuState } from '../src/features/menu/index.js';

test('Atomic 6.10 public Menu entry exposes a complete data-only command model', () => {
  assert.equal(MENU_DECLARATION.some(item => item.commandId === C.DOCUMENT_SAVE && item.shortcut === 'Ctrl+S'), true);
  assert.equal(MENU_DECLARATION.some(item => item.commandId === C.LAYOUT_MODE_BOTH), true);
  assert.equal(MENU_DECLARATION.some(item => item.commandId === C.HELP_OPEN), true);
  assert.equal(MENU_DECLARATION.every(item => Object.values(item).every(value => typeof value !== 'function')), true);
  const state = createMenuState();
  const bindings = createMenuCommandBindings();
  bindings.register(C.DOCUMENT_SAVE, () => 'saved');
  assert.equal(bindings.execute(C.DOCUMENT_SAVE).result, 'saved');
  state.destroy();
  bindings.destroy();
  assert.throws(() => state.isEnabled(C.DOCUMENT_SAVE), /destroyed/);
  assert.throws(() => bindings.has(C.DOCUMENT_SAVE), /destroyed/);
});
