import assert from 'node:assert/strict';
import test from 'node:test';

import { mountClassicPreviewLayoutStabilityPort } from '../../../src/features/preview/compatibility/classic-preview-layout-stability-port.js';

function createStability(calls) {
  return {
    connect(value) { calls.push(['connect', value]); return 'connected'; },
    start() { calls.push(['start']); return true; },
    requestRefresh(value) { calls.push(['requestRefresh', value]); return 'scheduled'; },
    cancel() { calls.push(['cancel']); return true; }
  };
}

test('Atomic 7.9 classic port delegates only the Preview Layout Stability contract', () => {
  const calls = [];
  const host = {};
  const mounted = mountClassicPreviewLayoutStabilityPort(host, createStability(calls));
  const port = host.markdownEditorPreviewLayoutStabilityPort;
  const capabilities = { render() {} };

  assert.equal(port.connect(capabilities), 'connected');
  assert.equal(port.start(), true);
  assert.equal(port.requestRefresh({ forceRender: true }), 'scheduled');
  assert.equal(port.cancel(), true);
  assert.deepEqual(calls, [
    ['connect', capabilities],
    ['start'],
    ['requestRefresh', { forceRender: true }],
    ['cancel']
  ]);
  mounted.destroy();
});

test('Atomic 7.9 classic port rejects duplicate ownership and destroy removes only its own host property', () => {
  const host = {};
  const mounted = mountClassicPreviewLayoutStabilityPort(host, createStability([]));
  assert.throws(() => mountClassicPreviewLayoutStabilityPort(host, createStability([])), /already mounted/i);
  const port = host.markdownEditorPreviewLayoutStabilityPort;
  mounted.destroy();
  assert.equal(host.markdownEditorPreviewLayoutStabilityPort, undefined);
  assert.throws(() => port.start(), /destroyed/i);
  assert.doesNotThrow(() => mounted.destroy());
});

test('Atomic 7.9 classic port validates every required controller operation before mounting', () => {
  const host = {};
  assert.throws(() => mountClassicPreviewLayoutStabilityPort(host, {}), /connect/i);
  assert.equal(host.markdownEditorPreviewLayoutStabilityPort, undefined);
});
