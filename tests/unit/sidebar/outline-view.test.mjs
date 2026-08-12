import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutlineView } from '../../../src/features/sidebar/outline/outline-view.js';

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, active) { active ? values.add(name) : values.delete(name); return Boolean(active); },
    toString() { return [...values].join(' '); }
  };
}

function element(tag = 'div') {
  const listeners = new Map();
  const node = {
    tagName: tag.toUpperCase(),
    dataset: {},
    attributes: new Map(),
    children: [],
    parentElement: null,
    hidden: false,
    classList: classList(),
    _className: '',
    get className() { return this._className; },
    set className(value) {
      this._className = String(value || '');
      this.classList = classList();
      for (const name of this._className.split(/\s+/).filter(Boolean)) this.classList.add(name);
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    contains(target) { for (let current = target; current; current = current.parentElement) if (current === this) return true; return false; },
    closest(selector) {
      let current = this;
      while (current) {
        if (selector === '[data-outline-action]' && current.dataset?.outlineAction) return current;
        if (selector === '[data-outline-context-action]' && current.dataset?.outlineContextAction) return current;
        if (selector === '.outline-node' && current.classList?.contains('outline-node')) return current;
        current = current.parentElement;
      }
      return null;
    },
    emit(type, target = this) {
      const event = { target, preventDefault() {}, stopPropagation() {} };
      listeners.get(type)?.(event);
      return event;
    },
    listenerCount() { return listeners.size; }
  };
  return node;
}

function findByAction(root, action) {
  if (root.dataset?.outlineAction === action) return root;
  for (const child of root.children || []) {
    const found = findByAction(child, action);
    if (found) return found;
  }
  return null;
}

test('Atomic 6.8 Outline view renders DOM primitives and owns delegated actions', () => {
  const panel = element('section');
  const list = element('div');
  panel.appendChild(list);
  const contextMenu = element('div');
  const separator = element('div');
  const collapseNodeButton = element('button');
  collapseNodeButton.dataset.outlineContextAction = 'collapse-node';
  contextMenu.appendChild(collapseNodeButton);
  const expandButton = element('button');
  expandButton.dataset.outlineContextAction = 'expand-all';
  contextMenu.appendChild(expandButton);
  const calls = [];
  const view = createOutlineView({
    documentRef: { createElement: tag => element(tag) },
    panel, list, contextMenu, contextSeparator: separator, contextCollapseNodeButton: collapseNodeButton,
    isCollapsed: id => id === 'a',
    onToggle: id => calls.push(['toggle', id]),
    onNavigate: (line, id) => calls.push(['navigate', line, id]),
    onExpandAll: () => calls.push(['expand']),
    onCollapseAll: () => calls.push(['collapse-all']),
    onCollapseNode: id => calls.push(['collapse-node', id]),
    openContextMenu: () => calls.push(['menu']),
    closeContextMenus: () => calls.push(['close'])
  });
  view.start();
  view.render([{ id: 'a', level: 1, text: 'Alpha', line: 2, children: [{ id: 'b', level: 2, text: 'Beta', line: 4, children: [] }] }]);
  const root = list.children[0];
  const toggle = findByAction(root, 'toggle');
  const navigate = findByAction(root, 'navigate');
  list.emit('click', toggle);
  list.emit('click', navigate);
  assert.deepEqual(calls.slice(0, 2), [['toggle', 'a'], ['navigate', 2, 'a']]);
  view.setActiveHeading('a');
  assert.equal(view.snapshot.activeHeadingId, 'a');
  const node = root.children[0];
  panel.emit('contextmenu', node);
  assert.equal(collapseNodeButton.hidden, false);
  contextMenu.emit('click', expandButton);
  assert.deepEqual(calls.slice(-3), [['menu'], ['expand'], ['close']]);
  view.destroy();
  assert.equal(list.listenerCount(), 0);
  assert.equal(panel.listenerCount(), 0);
  assert.equal(contextMenu.listenerCount(), 0);
  assert.throws(() => view.render([]), /destroyed/);
});
