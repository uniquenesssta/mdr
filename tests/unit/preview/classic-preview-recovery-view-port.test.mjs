import test from 'node:test';
import assert from 'node:assert/strict';
import { mountClassicPreviewRecoveryViewPort } from '../../../src/features/preview/compatibility/classic-preview-recovery-view-port.js';

function createView() {
  const calls = [];
  return {
    calls,
    inspect() { calls.push(['inspect']); return { present: true, recovery: false, empty: false }; },
    recover(options) { calls.push(['recover', options]); return { preserved: true }; },
    isRecoveryBody(body) { calls.push(['isRecoveryBody', body]); return body === 'recovery'; }
  };
}

test('Atomic 7.13 classic Recovery View port delegates the exact View contract without copying state', () => {
  const host = {};
  const view = createView();
  const mount = mountClassicPreviewRecoveryViewPort(host, view);
  const port = host.markdownEditorPreviewRecoveryViewPort;
  assert.deepEqual(port.inspect(), { present: true, recovery: false, empty: false });
  assert.deepEqual(port.recover({ preserveStable: true }), { preserved: true });
  assert.equal(port.isRecoveryBody('recovery'), true);
  assert.deepEqual(view.calls, [
    ['inspect'],
    ['recover', { preserveStable: true }],
    ['isRecoveryBody', 'recovery']
  ]);
  mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorPreviewRecoveryViewPort'), false);
});

test('Atomic 7.13 classic Recovery View port rejects duplicate and malformed ownership', () => {
  assert.throws(() => mountClassicPreviewRecoveryViewPort(null, createView()), /requires a host/);
  assert.throws(() => mountClassicPreviewRecoveryViewPort({}, {}), /view\.inspect/);
  const host = {};
  const first = mountClassicPreviewRecoveryViewPort(host, createView());
  assert.throws(() => mountClassicPreviewRecoveryViewPort(host, createView()), /already mounted/);
  first.destroy();
});

test('Atomic 7.13 classic Recovery View port destroy is idempotent and makes retained API terminal', () => {
  const host = {};
  const mount = mountClassicPreviewRecoveryViewPort(host, createView());
  const port = host.markdownEditorPreviewRecoveryViewPort;
  mount.destroy();
  mount.destroy();
  assert.throws(() => port.inspect(), /destroyed/);
  assert.throws(() => port.recover(), /destroyed/);
});
