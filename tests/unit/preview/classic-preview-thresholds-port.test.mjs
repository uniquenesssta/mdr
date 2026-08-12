import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PREVIEW_BEHAVIOR_THRESHOLDS,
  mountClassicPreviewThresholdsPort
} from '../../../src/features/preview/index.js';

test('Atomic 7.1 classic threshold port exposes the one frozen owner without copying state', () => {
  const target = {};
  const mounted = mountClassicPreviewThresholdsPort(target);
  const descriptor = Object.getOwnPropertyDescriptor(target, 'markdownEditorPreviewThresholdsPort');

  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, false);
  assert.equal(mounted.api.snapshot, PREVIEW_BEHAVIOR_THRESHOLDS);
  assert.equal(target.markdownEditorPreviewThresholdsPort.snapshot, PREVIEW_BEHAVIOR_THRESHOLDS);

  assert.throws(
    () => mountClassicPreviewThresholdsPort(target),
    /already mounted/
  );

  mounted.destroy();
  mounted.destroy();
  assert.equal(Object.hasOwn(target, 'markdownEditorPreviewThresholdsPort'), false);
  assert.throws(() => mounted.api.snapshot, /destroyed/);
});

test('Atomic 7.1 classic threshold port rejects invalid targets', () => {
  assert.throws(() => mountClassicPreviewThresholdsPort(null), TypeError);
  assert.throws(() => mountClassicPreviewThresholdsPort(undefined), TypeError);
});
