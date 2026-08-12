import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_DECLARATION } from '../../../src/features/menu/menu-state.js';
import { createMenuView } from '../../../src/features/menu/menu-view.js';

function classList(...initial) {
  const set = new Set(initial);
  return {
    add: (...values) => values.forEach(value => set.add(value)),
    remove: (...values) => values.forEach(value => set.delete(value)),
    contains: value => set.has(value),
    toggle(value, active) { active ? set.add(value) : set.delete(value); return Boolean(active); }
  };
}
function el({ id = '', classes = [] } = {}) {
  const listeners = new Map();
  const attrs = new Map();
  const node = {
    id, dataset: {}, hidden: false, children: [], parentElement: null, classList: classList(...classes),
    append(...items) { items.forEach(item => { item.parentElement = node; node.children.push(item); }); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    removeAttribute(name) { attrs.delete(name); },
    addEventListener(type, listener, capture) { listeners.set(`${type}:${Boolean(capture)}`, listener); },
    removeEventListener(type, listener, capture) { const key = `${type}:${Boolean(capture)}`; if (listeners.get(key) === listener) listeners.delete(key); },
    contains(target) { for (let cur = target; cur; cur = cur.parentElement) if (cur === node) return true; return false; },
    closest(selector) {
      let cur = node;
      while (cur) {
        if (selector === '[data-menu-command]' && cur.dataset?.menuCommand) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      if (selector.startsWith('#')) return findById(node, selector.slice(1));
      return null;
    },
    emitCaptureClick(target) {
      let prevented = 0; let stopped = 0;
      listeners.get('click:true')?.({ target, preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
      return { prevented, stopped };
    },
    listenerCount() { return listeners.size; }
  };
  return node;
}
function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) { const found = findById(child, id); if (found) return found; }
  return null;
}
const item = () => el({ classes: ['menu-item'] });
const sep = () => el({ classes: ['menu-separator'] });
function submenu(children) {
  const owner = el({ classes: ['menu-item', 'menu-submenu'] });
  const list = el({ classes: ['menu-dropdown-list', 'menu-submenu-list'] });
  list.append(...children);
  owner.append(el(), list);
  return owner;
}
function makeRoot() {
  const root = el();
  const file = el({ id: 'file-menu' });
  const recent = el({ id: 'recent-files-menu-item', classes: ['menu-item', 'menu-submenu'] });
  recent.append(el(), el({ id: 'recent-files-menu', classes: ['menu-dropdown-list', 'menu-submenu-list'] }));
  file.append(item(), item(), item(), item(), item(), item(), recent, sep(), item(), sep(), submenu([item(), item(), item(), item(), item()]));
  const edit = el({ id: 'edit-menu' });
  edit.append(item(), item(), sep(), item(), item(), item(), item(), sep(), item());
  const view = el({ id: 'app-view-menu' });
  view.append(item(), sep(), item(), item(), item(), sep(), item(), item());
  const insert = el({ id: 'insert-menu' });
  insert.append(submenu([item(), item(), item(), item(), item(), item()]), item(), item(), item(), item(), item(), submenu([item(), item()]), item());
  const help = el({ id: 'help-menu' });
  help.append(item());
  root.append(file, edit, view, insert, help);
  return root;
}

test('Atomic 6.10 MenuView binds command metadata, blocks legacy bubbling and destroys its listener', () => {
  const root = makeRoot();
  const view = createMenuView({ root });
  assert.equal(view.bindDeclaration(MENU_DECLARATION), MENU_DECLARATION.length);
  const save = findById(root, 'file-menu').children[2];
  assert.equal(save.dataset.menuCommand, 'document.save');
  assert.equal(save.dataset.menuShortcut, 'Ctrl+S');
  const calls = [];
  view.start(payload => calls.push(payload.commandId));
  const event = root.emitCaptureClick(save);
  assert.deepEqual(calls, ['document.save']);
  assert.deepEqual(event, { prevented: 1, stopped: 1 });
  view.setCommandState('document.save', { enabled: false, visible: true });
  root.emitCaptureClick(save);
  assert.deepEqual(calls, ['document.save']);
  view.destroy();
  assert.equal(root.listenerCount(), 0);
  assert.equal(save.dataset.menuCommand, undefined);
  assert.throws(() => view.bindDeclaration(MENU_DECLARATION), /destroyed/);
});
