import test from 'node:test';
import assert from 'node:assert/strict';
import { createShellMenus } from '../../../src/features/menu/shell-menus.js';
import { createLifecycleResourceLedger } from '../../helpers/lifecycle-resource-ledger.mjs';

function fixture() {
  const ledger = createLifecycleResourceLedger(), menus = [], triggers = [];
  for (const id of ['file-menu', 'edit-menu', 'app-view-menu', 'insert-menu']) {
    const trigger = ledger.createEventTarget({ dataset: { menuToggle: id }, expanded: 'false',
      setAttribute(_, value) { this.expanded = value; },
      getBoundingClientRect: () => ({ left: 20, right: 70, top: 0, bottom: 30 }) });
    const owner = { classList: ledger.createClassList('menu-dropdown'), querySelector: () => trigger };
    menus.push({ id, classList: ledger.createClassList(), parentElement: owner, style: ledger.createStyle(),
      getBoundingClientRect: () => ({ width: 200, height: 250 }) });
    triggers.push(trigger);
  }
  const document = { getElementById: id => menus.find(menu => menu.id === id), querySelectorAll(selector) {
    if (selector === '[data-menu-toggle]') return triggers;
    if (selector === '.menu-dropdown-list.show') return menus.filter(menu => menu.classList.contains('show'));
    if (selector.includes('aria-expanded')) return triggers.filter(trigger => trigger.expanded === 'true');
    return [];
  } };
  const shell = createShellMenus({ document, window: { innerWidth: 1280, innerHeight: 800 },
    toast: { classList: ledger.createClassList() }, coreSubmenuPositionerPort: { closeAll() {} },
    coreEditorUiCommandPort: { register: () => () => {} } });
  return { shell, ledger, menus, triggers };
}

test('top-level menus require one initial click and then switch on hover without another click', () => {
  const h = fixture();
  h.triggers[0].dispatch('pointerenter', { pointerType: 'mouse', buttons: 0 });
  assert.equal(h.menus.some(menu => menu.classList.contains('show')), false);
  h.triggers[0].dispatch('click', { detail: 1 });
  for (let index = 0; index < h.triggers.length; index += 1) {
    h.triggers[index].dispatch('pointerenter', { pointerType: 'mouse', buttons: 0 });
    assert.deepEqual(h.menus.filter(menu => menu.classList.contains('show')).map(menu => menu.id), [h.menus[index].id]);
    assert.equal(h.triggers[index].expanded, 'true');
  }
  h.shell.destroy();
  assert.equal(h.ledger.snapshot().total, 0);
});

test('click dismissal disarms hover switching while keyboard and touch retain explicit toggling', () => {
  const h = fixture(), button = h.triggers[0], menu = h.menus[0];
  button.dispatch('click', { detail: 1 });
  assert.equal(menu.classList.contains('show'), true);
  button.dispatch('click', { detail: 1 });
  assert.equal(menu.classList.contains('show'), false);
  button.dispatch('pointerenter', { pointerType: 'mouse', buttons: 0 });
  assert.equal(menu.classList.contains('show'), false);
  button.dispatch('pointerenter', { pointerType: 'touch', buttons: 0 });
  assert.equal(menu.classList.contains('show'), false);
  button.dispatch('click', { detail: 0 });
  assert.equal(menu.classList.contains('show'), true);
  h.shell.destroy();
});
