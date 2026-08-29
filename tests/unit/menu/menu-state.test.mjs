import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_DECLARATION, createMenuState } from '../../../src/features/menu/menu-state.js';

const EXPECTED_KEYS = ['commandId', 'enabledSelector', 'labelKey', 'shortcut', 'visibleSelector'];

test('Atomic 6.10 Menu declaration is data-only and limited to the five allowed fields', () => {
  assert.ok(MENU_DECLARATION.length > 30);
  assert.equal(new Set(MENU_DECLARATION.map(item => item.commandId)).size, MENU_DECLARATION.length);
  for (const item of MENU_DECLARATION) {
    assert.deepEqual(Object.keys(item).sort(), EXPECTED_KEYS);
    assert.equal(typeof item.labelKey, 'string');
    assert.equal(typeof item.commandId, 'string');
    assert.equal(typeof item.shortcut, 'string');
    assert.equal(typeof item.enabledSelector, 'string');
    assert.equal(typeof item.visibleSelector, 'string');
    assert.ok(Object.isFrozen(item));
    assert.equal(Object.values(item).some(value => typeof value === 'function'), false);
  }
});

test('Atomic 6.10 MenuState owns selector state and is terminal after destroy', () => {
  const state = createMenuState({ selectors: { writable: false } });
  const events = [];
  state.subscribe((next, previous, event) => events.push({ next, previous, event }));
  assert.equal(state.isEnabled(MENU_DECLARATION[0].commandId), true);
  state.setSelector('writable', true, 'test');
  assert.equal(events.length, 1);
  assert.equal(events[0].event.reason, 'test');
  state.destroy();
  assert.throws(() => state.get(MENU_DECLARATION[0].commandId), /destroyed/);
});
