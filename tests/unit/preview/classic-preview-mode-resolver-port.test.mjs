import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePreviewModeSetting, resolvePreviewMode } from '../../../src/features/preview/index.js';

test('R16-08 the direct Preview resolver preserves normalization and explicit mode overrides', () => {
  assert.equal(normalizePreviewModeSetting('invalid'), 'auto');
  assert.equal(resolvePreviewMode({ previewPerformanceMode: 'auto' }, 400000, 0), 'virtual');
  assert.equal(resolvePreviewMode({ previewPerformanceMode: 'full' }, 2000000, 20000), 'full');
  for (const mode of ['full','virtual','chapter']) assert.equal(resolvePreviewMode({ previewPerformanceMode: mode }, 0, 0), mode);
});

test('R16-08 resolver calls own no mutable mode or host lifecycle state', () => {
  const settings = Object.freeze({ previewPerformanceMode: 'auto' });
  const before = Object.getOwnPropertyNames(globalThis);
  assert.equal(resolvePreviewMode(settings, 2000000, 0), 'chapter');
  assert.equal(resolvePreviewMode(settings, 0, 0), 'full');
  assert.equal(settings.previewPerformanceMode, 'auto');
  assert.deepEqual(Object.getOwnPropertyNames(globalThis), before);
});
