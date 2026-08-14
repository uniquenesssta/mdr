import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualSpacerView } from '../../../src/features/preview/render/virtual-window/spacer-view.js';

function node() {
  return {
    className: '',
    style: {},
    attributes: {},
    removed: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    remove() { this.removed = true; }
  };
}

test('Atomic 7.10 spacer view owns only top/bottom buffer nodes and their heights', () => {
  const created = [];
  const view = createVirtualSpacerView({ documentRef: { createElement() { const value = node(); created.push(value); return value; } } });
  const parent = { children: [], append(...nodes) { this.children.push(...nodes); } };
  view.appendTo(parent);
  view.update(120.4, 980);
  assert.equal(parent.children.length, 2);
  assert.equal(view.top.className, 'virtual-preview-spacer virtual-preview-spacer-top');
  assert.equal(view.bottom.className, 'virtual-preview-spacer virtual-preview-spacer-bottom');
  assert.equal(view.top.style.height, '120.4px');
  assert.equal(view.bottom.style.height, '980px');
  assert.equal(view.top.attributes['aria-hidden'], 'true');
  view.destroy();
  assert.equal(view.top.removed, true);
  assert.throws(() => view.update(1, 1), /destroyed/);
});
