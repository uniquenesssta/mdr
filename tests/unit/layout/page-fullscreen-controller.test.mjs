import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState } from '../../../src/features/layout/state/layout-state.js';
import {
  createPageFullscreenController,
  PAGE_FULLSCREEN_STORAGE_KEY
} from '../../../src/features/layout/fullscreen/page-fullscreen-controller.js';

function createClassList() {
  const values = new Set();
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
    toggle(name, active) { active ? values.add(name) : values.delete(name); return Boolean(active); },
    values
  };
}
function createHarness(initial = null) {
  const state = createLayoutState();
  const app = { classList: createClassList() };
  const body = { classList: createClassList() };
  const values = new Map();
  if (initial !== null) values.set(PAGE_FULLSCREEN_STORAGE_KEY, initial);
  const writes = [];
  const geometry = [];
  const storage = {
    get(key) { return values.has(key) ? values.get(key) : null; },
    set(key, value) { writes.push([key, value]); values.set(key, value); }
  };
  const controller = createPageFullscreenController({
    state, app, body, storage,
    onGeometryChanged: event => geometry.push(event)
  });
  return { state, app, body, values, writes, geometry, storage, controller };
}

test('Atomic 6.6 page fullscreen restores persisted state without rewriting persistence', () => {
  const h = createHarness('true');
  h.controller.start();
  assert.equal(h.state.snapshot.fullscreen.page, true);
  assert.equal(h.app.classList.contains('page-fullscreen'), true);
  assert.equal(h.app.classList.contains('is-page-fullscreen'), true);
  assert.equal(h.body.classList.contains('page-fullscreen-active'), true);
  assert.equal(h.body.classList.contains('is-page-fullscreen-active'), true);
  assert.deepEqual(h.writes, []);
  assert.equal(h.geometry.length, 1);
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.6 page fullscreen toggles from LayoutState authority and persists the exact legacy key', async () => {
  const h = createHarness('false');
  h.controller.start();
  h.app.classList.add('is-page-fullscreen');
  const result = await h.controller.toggle();
  assert.deepEqual({ ok: result.ok, active: result.active, changed: result.changed, persisted: result.persisted }, {
    ok: true, active: true, changed: true, persisted: true
  });
  assert.equal(h.state.snapshot.fullscreen.page, true);
  assert.deepEqual(h.writes, [[PAGE_FULLSCREEN_STORAGE_KEY, 'true']]);
  assert.equal(h.app.classList.contains('page-fullscreen'), true);
  assert.equal(h.body.classList.contains('is-page-fullscreen-active'), true);
  assert.equal(h.geometry.length, 1);
  h.controller.destroy();
  h.state.destroy();
});

test('Atomic 6.6 page fullscreen returns persistence failure without hiding the state transition', async () => {
  const h = createHarness('false');
  h.storage.set = () => { throw new Error('storage denied'); };
  const controller = createPageFullscreenController({
    state: h.state, app: h.app, body: h.body, storage: h.storage,
    onGeometryChanged: event => h.geometry.push(event)
  });
  controller.start();
  const result = await controller.toggle();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'persistence-failed');
  assert.match(result.error.message, /storage denied/);
  assert.equal(h.state.snapshot.fullscreen.page, true);
  assert.equal(h.app.classList.contains('is-page-fullscreen'), true);
  controller.destroy();
  h.state.destroy();
});

test('Atomic 6.6 page fullscreen destroy is idempotent, clears owned classes and is terminal', async () => {
  const h = createHarness('true');
  h.controller.start();
  h.controller.destroy();
  h.controller.destroy();
  assert.equal(h.app.classList.contains('page-fullscreen'), false);
  assert.equal(h.app.classList.contains('is-page-fullscreen'), false);
  assert.equal(h.body.classList.contains('page-fullscreen-active'), false);
  assert.equal(h.body.classList.contains('is-page-fullscreen-active'), false);
  assert.throws(() => h.controller.start(), /destroyed/);
  assert.throws(() => h.controller.toggle(), /destroyed/);
  h.state.destroy();
});
