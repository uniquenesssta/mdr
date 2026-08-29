import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewState, mountClassicPreviewStatePort } from '../../../src/features/preview/index.js';

function createHost() {
  return {
    removeAttribute() {}
  };
}

test('Atomic 7.2 classic PreviewState port exposes the canonical state without copying it', () => {
  const host = createHost();
  const state = createPreviewState();
  const mount = mountClassicPreviewStatePort(host, state);
  const api = host.markdownEditorPreviewStatePort;

  assert.equal(api.snapshot, state.snapshot);
  const version = api.beginRender();
  assert.equal(version, 1);
  assert.equal(api.snapshot, state.snapshot);
  assert.equal(api.setFocusSection(version, { headingId: 'a', startLine: 1, endLine: 10 }), true);
  assert.equal(state.snapshot.focusSection.headingId, 'a');
  assert.equal(api.commitStable(version, {
    mode: 'full',
    result: { scopeKey: 'full', renderMode: 'whole-document', sourceLength: 50, blockCount: 3, mountedBlocks: 3, documentVersion: 1 }
  }), true);
  assert.equal(api.snapshot.lastStableResult, state.snapshot.lastStableResult);

  mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorPreviewStatePort'), false);
  assert.throws(() => api.snapshot, /Classic Preview State port is destroyed/);
  state.destroy();
});

test('Atomic 7.2 classic PreviewState port duplicate mount is rejected and destroy is idempotent', () => {
  const host = createHost();
  const state = createPreviewState();
  const mount = mountClassicPreviewStatePort(host, state);
  assert.throws(() => mountClassicPreviewStatePort(host, state), /already mounted/);
  mount.destroy();
  mount.destroy();
  state.destroy();
});
