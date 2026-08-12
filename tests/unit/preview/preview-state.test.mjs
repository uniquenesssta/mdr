import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewState } from '../../../src/features/preview/index.js';

test('Atomic 7.2 PreviewState owns one immutable runtime snapshot', () => {
  const state = createPreviewState();
  assert.deepEqual(state.snapshot, {
    mode: 'full',
    version: 0,
    status: 'idle',
    lastStableResult: null,
    focusSection: null,
    error: null
  });
  assert.equal(Object.isFrozen(state.snapshot), true);
  state.destroy();
});

test('Atomic 7.2 PreviewState rejects stale render commits and keeps the newest generation authoritative', () => {
  const state = createPreviewState();
  const first = state.beginRender();
  const second = state.beginRender();

  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(state.isCurrentVersion(first), false);
  assert.equal(state.isCurrentVersion(second), true);
  assert.equal(state.commitStable(first, {
    mode: 'virtual',
    focusSection: { headingId: 'stale', startLine: 1, endLine: 20 },
    result: { scopeKey: 'virtual', renderMode: 'stale', sourceLength: 400000, blockCount: 1400, mountedBlocks: 24, documentVersion: 1 }
  }), false);
  assert.equal(state.snapshot.version, 2);
  assert.equal(state.snapshot.status, 'rendering');

  assert.equal(state.commitStable(second, {
    mode: 'virtual',
    focusSection: { headingId: 'current', startLine: 21, endLine: 80, focusIndex: 5 },
    result: { scopeKey: 'virtual', renderMode: 'worker-virtual', sourceLength: 450000, blockCount: 1600, mountedBlocks: 36, documentVersion: 2 }
  }), true);
  assert.equal(state.snapshot.mode, 'virtual');
  assert.equal(state.snapshot.status, 'stable');
  assert.equal(state.snapshot.focusSection.headingId, 'current');
  assert.equal(state.snapshot.focusSection.focusIndex, 5);
  assert.equal(state.snapshot.lastStableResult.scopeKey, 'virtual');
  state.destroy();
});

test('Atomic 7.2 PreviewState owns error and preserves the last stable result across a failed render', () => {
  const state = createPreviewState();
  const stableVersion = state.beginRender();
  state.commitStable(stableVersion, {
    mode: 'chapter',
    focusSection: { headingId: 'chapter-a', startLine: 100, endLine: 180 },
    result: { scopeKey: 'chapter:chapter-a', renderMode: 'worker-chapter-preview', sourceLength: 1000000, blockCount: 12000, mountedBlocks: 96, documentVersion: 7 }
  });
  const stableResult = state.snapshot.lastStableResult;

  const failedVersion = state.beginRender();
  assert.equal(state.failRender(failedVersion, {
    mode: 'chapter',
    error: { name: 'WorkerError', message: 'worker unavailable', source: 'worker' }
  }), true);
  assert.equal(state.snapshot.status, 'error');
  assert.equal(state.snapshot.error.source, 'worker');
  assert.equal(state.snapshot.lastStableResult, stableResult);
  assert.equal(Object.isFrozen(state.snapshot.error), true);
  assert.equal(Object.isFrozen(state.snapshot.lastStableResult), true);
  state.destroy();
});

test('Atomic 7.2 PreviewState stores data-only stable metadata, never DOM or arbitrary runtime objects', () => {
  const state = createPreviewState();
  const version = state.beginRender();
  assert.throws(() => state.commitStable(version, {
    mode: 'full',
    result: { scopeKey: 'full', renderMode: 'whole-document', sourceLength: 10, blockCount: 1, mountedBlocks: 1, documentVersion: 1, body: { nodeType: 1 } }
  }), /Unknown Preview stable result field: body/);
  state.destroy();
});

test('Atomic 7.2 PreviewState suspend/reset lifecycle preserves or clears stable state explicitly', () => {
  const state = createPreviewState();
  const version = state.beginRender();
  state.commitStable(version, {
    mode: 'full',
    result: { scopeKey: 'full', renderMode: 'whole-document', sourceLength: 20, blockCount: 2, mountedBlocks: 2, documentVersion: 3 }
  });
  const stableResult = state.snapshot.lastStableResult;

  const suspendedVersion = state.invalidate({ mode: 'hybrid', status: 'suspended', clearStable: false, clearError: false });
  assert.equal(suspendedVersion, 2);
  assert.equal(state.snapshot.mode, 'hybrid');
  assert.equal(state.snapshot.status, 'suspended');
  assert.equal(state.snapshot.lastStableResult, stableResult);

  const resetVersion = state.invalidate({ mode: 'full', status: 'idle', clearStable: true, clearError: true, focusSection: null });
  assert.equal(resetVersion, 3);
  assert.equal(state.snapshot.lastStableResult, null);
  assert.equal(state.snapshot.focusSection, null);
  assert.equal(state.snapshot.error, null);
  state.destroy();
});

test('Atomic 7.2 PreviewState subscriptions are synchronous, disposable and terminal after destroy', () => {
  const state = createPreviewState();
  const events = [];
  const unsubscribe = state.subscribe(event => events.push(event));
  state.beginRender();
  assert.equal(events.length, 1);
  assert.equal(events[0].previous.version, 0);
  assert.equal(events[0].current.version, 1);
  unsubscribe();
  state.beginRender();
  assert.equal(events.length, 1);
  state.destroy();
  assert.throws(() => state.beginRender(), /Preview State is destroyed/);
  assert.throws(() => state.snapshot, /Preview State is destroyed/);
});
