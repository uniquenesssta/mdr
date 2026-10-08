import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebClipperController, createWebFetchCoordinator } from '../src/features/import/index.js';

function host(overrides = {}) {
  const inserted = [];
  const fetchCoordinator = createWebFetchCoordinator({ nativeFetch: async () => '<p>fetched</p>' });
  const controller = createWebClipperController({ fetchCoordinator, extract: value => value, convert: value => value, insertMarkdown: value => inserted.push(value), ...overrides });
  return { controller, inserted, destroy() { controller.destroy(); fetchCoordinator.destroy(); } };
}
test('manual insertion, duplicate clicks, conversion failure and retry preserve session boundaries', async () => {
  let fail = true;
  const h = host({ convert: value => { if (fail) throw new Error('conversion'); return value; } });
  h.controller.open(); assert.equal(h.controller.insert().status, 'empty');
  h.controller.setInput('manualHtml', '<p>manual</p>');
  assert.equal(h.controller.insert().status, 'error'); fail = false;
  assert.equal(h.controller.insert().status, 'inserted');
  assert.equal(h.controller.insert().status, 'closed'); assert.deepEqual(h.inserted, ['<p>manual</p>']);
  h.controller.open(); assert.equal(h.controller.snapshot.manualHtml, ''); assert.equal(h.controller.snapshot.hasContent, false);
  h.destroy(); h.destroy(); assert.throws(() => h.controller.open(), /destroyed/);
});
test('changed manual input and destroy isolate unfinished fetches and listeners', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const h = host({ fetchCoordinator: { cancel() {}, fetchUrl: () => pending, isCurrent: () => true } });
  let updates = 0; const off = h.controller.subscribe(() => updates++);
  h.controller.open(); const fetch = h.controller.fetch();
  h.controller.setInput('manualHtml', 'new'); h.controller.insert();
  const before = updates; resolve({ status: 'success', html: 'old' }); await fetch;
  assert.equal(updates, before); assert.deepEqual(h.inserted, ['new']);
  off(); h.destroy(); assert.equal(updates, before);
});
test('unexpected fetch errors expose manual input; empty conversion performs no insertion', async () => {
  const h = host({ fetchCoordinator: { cancel() {}, async fetchUrl() { throw new Error('network'); }, isCurrent: () => true }, convert: () => '' });
  h.controller.open(); await h.controller.fetch(); assert.equal(h.controller.snapshot.error, 'network'); assert.equal(h.controller.snapshot.showManual, true);
  h.controller.setInput('manualHtml', 'x'); assert.equal(h.controller.insert().status, 'no-content'); assert.deepEqual(h.inserted, []); h.destroy();
});
test('public clipper owns open sessions and disposes subscriptions without an activation bridge', () => {
  const h = host(); let updates = 0;
  const off = h.controller.subscribe(() => updates++);
  h.controller.open(); h.controller.setInput('manualHtml', 'first');
  h.controller.open(); assert.equal(h.controller.snapshot.manualHtml, '');
  off(); const before = updates;
  h.controller.close(); assert.equal(updates, before);
  h.destroy(); h.destroy();
  assert.throws(() => h.controller.open(), /destroyed/);
  assert.throws(() => h.controller.subscribe(() => {}), /destroyed/);
});
