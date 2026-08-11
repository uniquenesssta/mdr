import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import { createSidebarLayoutController } from '../../../src/features/layout/sidebar/sidebar-layout-controller.js';

function element() {
  const classes = new Set();
  const attributes = new Map();
  return {
    classes, attributes,
    classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } },
    setAttribute(name, value) { attributes.set(name, String(value)); }
  };
}

test('Atomic 6.4 SidebarLayout projects authoritative visibility and auto-collapse without owning state', () => {
  const state = createLayoutState();
  const sidebar = element(); const resizer = element(); const geometry = [];
  const controller = createSidebarLayoutController({ state, sidebar, resizer, onGeometryChanged: event => geometry.push(event) });
  controller.start();
  assert.equal(sidebar.classes.has('is-hidden'), false);
  assert.equal(sidebar.attributes.get('aria-hidden'), 'false');
  state.setSidebar({ autoCollapsed: true });
  assert.equal(sidebar.classes.has('hidden'), true);
  assert.equal(resizer.classes.has('is-hidden'), true);
  assert.equal(sidebar.attributes.get('aria-hidden'), 'true');
  assert.equal(geometry.length, 1);
  state.setSidebar({ autoCollapsed: false, visible: false });
  assert.equal(sidebar.classes.has('is-hidden'), true);
  assert.equal(geometry.length, 1, 'effective visibility did not change');
  state.setSidebar({ visible: true });
  assert.equal(sidebar.classes.has('is-hidden'), false);
  assert.equal(geometry.length, 2);
  controller.destroy();
  state.setSidebar({ visible: false });
  assert.equal(sidebar.classes.has('is-hidden'), false, 'destroyed projection must stop reacting');
  assert.throws(() => controller.reconcile(), /destroyed/);
  state.destroy();
});
