import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewState } from '../../../src/features/preview/index.js';

test('R16-08 explicit PreviewState remains the sole snapshot and version owner', () => {
  const state = createPreviewState(), api = state;
  assert.equal(api.snapshot, state.snapshot);
  const version = api.beginRender();
  assert.equal(version, 1);
  assert.equal(api.setFocusSection(version, { headingId: 'a', startLine: 1, endLine: 10 }), true);
  assert.equal(state.snapshot.focusSection.headingId, 'a');
  assert.equal(api.commitStable(version, { mode: 'full', result: { scopeKey: 'full', renderMode: 'whole-document', sourceLength: 50, blockCount: 3, mountedBlocks: 3, documentVersion: 1 } }), true);
  assert.equal(api.snapshot.lastStableResult, state.snapshot.lastStableResult);
  const staleVersion = api.beginRender();
  assert.equal(api.commitStable(version, { mode: 'full', result: {} }), false);
  assert.equal(api.snapshot.version, staleVersion);
  state.destroy();
  assert.throws(() => api.snapshot, /destroyed/);
});

test('R16-08 independent PreviewState owners remain isolated and destruction is terminal and idempotent', () => {
  const first = createPreviewState(), second = createPreviewState();
  first.beginRender();
  assert.equal(second.snapshot.version, 0);
  first.destroy(); first.destroy();
  assert.throws(() => first.subscribe(() => {}), /destroyed/);
  assert.equal(second.beginRender(), 1);
  second.destroy();
});
