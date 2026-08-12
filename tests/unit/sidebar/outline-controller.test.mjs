import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutlineController } from '../../../src/features/sidebar/outline/outline-controller.js';

function harness() {
  const renders = [];
  const activeIds = [];
  const navigations = [];
  const persistence = [];
  let now = 0;
  const collapsed = new Set();
  const view = {
    start() {},
    render(tree) { renders.push(tree); return { headings: tree.length, rows: tree.length }; },
    setActiveHeading(id) { activeIds.push(id); return true; },
    destroy() { view.destroyed = true; }
  };
  const collapseStore = {
    restore() { return { restored: true }; },
    isCollapsed(id) { return collapsed.has(id); },
    toggle(id) { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); persistence.push(['toggle', id]); return Promise.resolve({ ok: true }); },
    collapse(id) { collapsed.add(id); persistence.push(['collapse', id]); return Promise.resolve({ ok: true }); },
    expandAll() { collapsed.clear(); persistence.push(['expand']); return Promise.resolve({ ok: true }); },
    collapseAll(ids) { collapsed.clear(); for (const id of ids) collapsed.add(id); persistence.push(['all', [...ids]]); return Promise.resolve({ ok: true }); },
    destroy() { collapseStore.destroyed = true; }
  };
  const records = [];
  const controller = createOutlineController({
    view,
    collapseStore,
    getActiveLine: () => 6,
    navigateToLine(line) { navigations.push(line); return true; },
    now: () => ++now,
    record(operation, entry) { records.push([operation, entry]); },
    reportError() {}
  });
  return { controller, view, collapseStore, renders, activeIds, navigations, persistence, records };
}

const index = [
  { id: 'a', level: 1, text: 'A', line: 2 },
  { id: 'b', level: 2, text: 'B', line: 5 },
  { id: 'c', level: 1, text: 'C', line: 10 }
];

test('Atomic 6.8 updates index while inactive and renders only when Sidebar activates Outline', () => {
  const h = harness();
  h.controller.start();
  const update = h.controller.replaceIndex(index, { documentKey: 'doc-1', version: 4 });
  assert.equal(update.changed, true);
  assert.equal(h.renders.length, 0);
  h.controller.activate();
  assert.equal(h.renders.length, 1);
  assert.equal(h.activeIds.at(-1), 'b');
  assert.equal(h.records.at(-1)[0], 'renderOutline');
  h.controller.deactivate();
  h.controller.updateActiveLine(11);
  assert.equal(h.activeIds.at(-1), 'b');
  h.controller.activate();
  assert.equal(h.activeIds.at(-1), 'b');
  h.controller.destroy();
});

test('Atomic 6.8 rejects stale index results only within the same document identity', () => {
  const h = harness();
  h.controller.start();
  h.controller.replaceIndex(index, { documentKey: 'doc-1', version: 8 });
  const stale = h.controller.replaceIndex([{ id: 'old', level: 1, text: 'Old', line: 1 }], { documentKey: 'doc-1', version: 7 });
  assert.equal(stale.accepted, false);
  assert.equal(stale.stale, true);
  assert.equal(h.controller.snapshot.headings[0].id, 'a');
  const nextDocument = h.controller.replaceIndex([{ id: 'new', level: 1, text: 'New', line: 1 }], { documentKey: 'doc-2', version: 0 });
  assert.equal(nextDocument.accepted, true);
  assert.equal(h.controller.snapshot.headings[0].id, 'new');
  h.controller.destroy();
});

test('Atomic 6.8 owns collapse actions and navigation without a second Outline state center', async () => {
  const h = harness();
  h.controller.start();
  h.controller.replaceIndex(index, { documentKey: 'doc-1', version: 1 });
  h.controller.activate();
  await h.controller.collapseAll();
  assert.deepEqual(h.persistence.at(-1), ['all', ['a']]);
  await h.controller.toggleNode('a');
  await h.controller.collapseNode('a');
  await h.controller.expandAll();
  assert.equal(h.controller.navigate(10), true);
  assert.deepEqual(h.navigations, [10]);
  assert.equal(h.activeIds.at(-1), 'c');
  h.controller.destroy();
  assert.equal(h.view.destroyed, true);
  assert.equal(h.collapseStore.destroyed, true);
  assert.throws(() => h.controller.refresh(), /destroyed/);
});
