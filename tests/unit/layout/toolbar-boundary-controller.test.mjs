import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolbarBoundaryController } from '../../../src/features/layout/toolbar/toolbar-boundary-controller.js';

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createHarness({ width = 430, formatWidth = 300, actionsWidth = 80, narrow = false, observer = true, fontsReady = null } = {}) {
  const classList = createClassList();
  let offsetReads = 0;
  const toolbar = {
    classList,
    clientWidth: width,
    get offsetWidth() { offsetReads += 1; return this.clientWidth; },
    getBoundingClientRect() { return { width: this.clientWidth }; }
  };
  const formatGroup = { scrollWidth: formatWidth };
  const actions = { scrollWidth: actionsWidth };
  const records = [];
  const listeners = new Map();
  let frameId = 0;
  const frames = new Map();
  let observed = 0;
  let disconnected = 0;
  let observerCallback = null;
  const resizeTarget = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); }
  };
  const controller = createToolbarBoundaryController({
    toolbar,
    formatGroup,
    actions,
    matchMedia: () => ({ matches: narrow }),
    getStyle: () => ({ paddingLeft: '10px', paddingRight: '10px', columnGap: '10px', gap: '10px' }),
    createResizeObserver: observer ? callback => {
      observerCallback = callback;
      return {
        observe(target) { assert.equal(target, toolbar); observed += 1; },
        disconnect() { disconnected += 1; }
      };
    } : null,
    resizeTarget,
    requestFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    fontsReady,
    record: (name, entry) => records.push([name, entry])
  });
  return {
    toolbar, formatGroup, actions, records, listeners, frames, controller,
    flushFrame() {
      for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
    },
    triggerObserver() { observerCallback?.(); },
    get observed() { return observed; },
    get disconnected() { return disconnected; },
    get offsetReads() { return offsetReads; }
  };
}

test('Atomic 6.5 measures real content width and toggles only the double-row boundary class', () => {
  const h = createHarness();
  h.controller.start();
  h.flushFrame();
  assert.equal(h.toolbar.classList.contains('toolbar-boundary-wrap'), false);
  assert.ok(h.offsetReads > 0, 'wide measurement resets to the single-row presentation before measuring');

  h.toolbar.clientWidth = 380;
  h.controller.refresh();
  h.flushFrame();
  assert.equal(h.toolbar.classList.contains('toolbar-boundary-wrap'), true);
  assert.equal(h.records.at(-1)[0], 'layout.toolbar-boundary-change');
  assert.deepEqual(h.records.at(-1)[1].details, {
    wrapped: true,
    toolbarWidth: 380,
    availableWidth: 360,
    requiredWidth: 390
  });

  h.toolbar.clientWidth = 440;
  h.triggerObserver();
  h.flushFrame();
  assert.equal(h.toolbar.classList.contains('toolbar-boundary-wrap'), false);
  assert.equal(h.records.at(-1)[1].details.wrapped, false);
  h.controller.destroy();
});

test('Atomic 6.5 narrow interactive breakpoint forces wrapping even when content fits', () => {
  const h = createHarness({ width: 1000, formatWidth: 120, actionsWidth: 80, narrow: true });
  h.controller.start();
  h.flushFrame();
  assert.equal(h.toolbar.classList.contains('toolbar-boundary-wrap'), true);
  assert.equal(h.offsetReads, 0, 'forced narrow wrapping does not need a single-row reset measurement');
  h.controller.destroy();
});

test('Atomic 6.5 hidden toolbar clears boundary wrapping without changing toolbar items', () => {
  const h = createHarness({ width: 300 });
  h.controller.start();
  h.flushFrame();
  assert.equal(h.toolbar.classList.contains('toolbar-boundary-wrap'), true);
  h.toolbar.classList.add('hidden');
  h.controller.refresh();
  h.flushFrame();
  assert.equal(h.toolbar.classList.contains('toolbar-boundary-wrap'), false);
  assert.equal(h.toolbar.classList.contains('hidden'), true);
  h.controller.destroy();
});

test('Atomic 6.5 destroy disconnects ResizeObserver, cancels RAF and blocks stale font completion', async () => {
  const font = deferred();
  const h = createHarness({ fontsReady: font.promise });
  h.controller.start();
  assert.equal(h.observed, 1);
  assert.equal(h.frames.size, 1);
  h.controller.destroy();
  h.controller.destroy();
  assert.equal(h.disconnected, 1);
  assert.equal(h.frames.size, 0);
  font.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.frames.size, 0);
  assert.throws(() => h.controller.refresh(), /destroyed/);
  assert.throws(() => h.controller.start(), /destroyed/);
});

test('Atomic 6.5 fallback resize listener schedules measurement and is removed on destroy', () => {
  const h = createHarness({ observer: false });
  h.controller.start();
  h.flushFrame();
  assert.equal(h.listeners.has('resize'), true);
  h.toolbar.clientWidth = 360;
  h.listeners.get('resize')();
  h.flushFrame();
  assert.equal(h.toolbar.classList.contains('toolbar-boundary-wrap'), true);
  h.controller.destroy();
  assert.equal(h.listeners.size, 0);
});
