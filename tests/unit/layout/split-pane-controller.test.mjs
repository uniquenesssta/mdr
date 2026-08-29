import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import { createSplitPaneController } from '../../../src/features/layout/split/split-pane-controller.js';

function element() {
  const classes = new Set();
  const attrs = new Map();
  const listeners = new Map();
  const use = { setAttribute(name, value) { attrs.set(`use:${name}`, value); } };
  return {
    classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
    style: {},
    setAttribute(name, value) { attrs.set(name, value); },
    querySelector(selector) { return selector === 'use' ? use : null; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    emit(type, event = {}) { listeners.get(type)?.(event); },
    attrs, listeners
  };
}
function fixture(initial) {
  const state = createLayoutState(initial);
  const editorPane = element(); const previewPane = element(); const resizer = element();
  const editorButton = element(); const previewButton = element();
  const data = new Map(); const requests = []; const compact = [];
  const controller = createSplitPaneController({
    state, editorPane, previewPane, resizer,
    editorCollapseButton: editorButton, previewCollapseButton: previewButton,
    storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) },
    requestLayoutMode: mode => requests.push(mode),
    activateCompactPane: (pane, reason) => { compact.push([pane, reason]); return true; },
    getCollapseLabel: (pane, collapsed) => `${pane}:${collapsed ? 'expand' : 'collapse'}`
  });
  return { state, controller, editorPane, previewPane, resizer, editorButton, previewButton, data, requests, compact };
}

test('Atomic 6.3 SplitPane restores/persists collapse state and never permits both panes collapsed', () => {
  const f = fixture();
  f.data.set('md_editor_editor_collapsed', 'true');
  f.controller.start();
  assert.equal(f.state.snapshot.split.editorCollapsed, true);
  assert.equal(f.state.snapshot.split.previewCollapsed, false);
  assert.equal(f.resizer.classList.contains('is-hidden'), true);
  f.controller.togglePane('editor');
  assert.equal(f.state.snapshot.split.editorCollapsed, false);
  f.controller.togglePane('preview');
  assert.equal(f.state.snapshot.split.previewCollapsed, true);
  const blocked = f.controller.togglePane('editor');
  assert.equal(blocked.changed, false);
  assert.equal(f.state.snapshot.split.editorCollapsed, false);
  assert.equal(f.data.get('md_editor_preview_collapsed'), 'true');
  f.controller.destroy();
  assert.equal(f.previewButton.listeners.size, 0);
  f.state.destroy();
});

test('Atomic 6.3 SplitPane delegates hybrid and compact mutual-exclusion requests without owning those policies', () => {
  const f = fixture({ mode: 'hybrid', split: { editorCollapsed: false, previewCollapsed: true } });
  f.controller.start();
  f.controller.togglePane('editor');
  assert.deepEqual(f.requests, ['preview']);
  f.state.setMode('both');
  f.state.setSplit({ compactActive: true, editorCollapsed: false, previewCollapsed: true });
  f.controller.togglePane('preview');
  assert.deepEqual(f.compact, [['preview', 'toggle:preview']]);
  f.controller.destroy(); f.state.destroy();
});
