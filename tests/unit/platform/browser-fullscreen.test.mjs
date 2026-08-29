import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserFullscreen } from '../../../src/platform/index.js';

function createFullscreenSurface() {
  const log = [];
  const listeners = new Map();
  const target = {
    async requestFullscreen() { log.push('requestFullscreen'); documentObject.fullscreenElement = target; }
  };
  const documentObject = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: target,
    async exitFullscreen() { log.push('exitFullscreen'); documentObject.fullscreenElement = null; },
    addEventListener(type, handler) { log.push(['add', type]); listeners.set(type, handler); },
    removeEventListener(type, handler) {
      log.push(['remove', type]);
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
  return { documentObject, target, log, listeners };
}

test('Atomic Task 3.10 fullscreen exposes enabled active enter and exit without UI policy', async () => {
  const surface = createFullscreenSurface();
  const adapter = createBrowserFullscreen({ documentObject: surface.documentObject });

  assert.equal(adapter.isEnabled(), true);
  assert.equal(adapter.isActive(), false);
  await adapter.enter();
  assert.equal(adapter.isActive(), true);
  await adapter.exit();
  assert.equal(adapter.isActive(), false);
  assert.deepEqual(surface.log, ['requestFullscreen', 'exitFullscreen']);
  assert.ok(Object.isFrozen(adapter));
});

test('fullscreen subscription reports active state and disposer is idempotent', () => {
  const surface = createFullscreenSurface();
  const received = [];
  const adapter = createBrowserFullscreen({ documentObject: surface.documentObject });
  const dispose = adapter.subscribe(active => received.push(active));

  surface.documentObject.fullscreenElement = surface.target;
  surface.listeners.get('fullscreenchange')();
  surface.documentObject.fullscreenElement = null;
  surface.listeners.get('webkitfullscreenchange')();
  dispose();
  dispose();

  assert.deepEqual(received, [true, false]);
  assert.deepEqual(surface.log.map(entry => Array.isArray(entry) ? entry : [entry]), [
    ['add', 'fullscreenchange'],
    ['add', 'webkitfullscreenchange'],
    ['remove', 'fullscreenchange'],
    ['remove', 'webkitfullscreenchange']
  ]);
});

test('legacy WebKit fullscreen surfaces remain supported', async () => {
  const log = [];
  const target = { async webkitRequestFullscreen() { log.push('enter'); } };
  const documentObject = {
    webkitFullscreenEnabled: true,
    webkitFullscreenElement: target,
    documentElement: target,
    async webkitExitFullscreen() { log.push('exit'); },
    addEventListener() {},
    removeEventListener() {}
  };
  const adapter = createBrowserFullscreen({ documentObject });
  assert.equal(adapter.isEnabled(), true);
  assert.equal(adapter.isActive(), true);
  await adapter.enter();
  await adapter.exit();
  assert.deepEqual(log, ['enter', 'exit']);
});

test('fullscreen unsupported operations and invalid handlers fail explicitly', async () => {
  const documentObject = { documentElement: {}, addEventListener() {}, removeEventListener() {} };
  const adapter = createBrowserFullscreen({ documentObject });
  assert.equal(adapter.isEnabled(), false);
  assert.equal(adapter.isActive(), false);
  await assert.rejects(adapter.enter(), /fullscreen enter is unavailable/);
  assert.throws(() => adapter.subscribe(null), /handler must be a function/);
  assert.throws(() => createBrowserFullscreen(null), /options must be an object/);
});
