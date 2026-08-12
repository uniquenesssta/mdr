import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizePreviewModeSetting,
  resolvePreviewMode
} from '../../../src/features/preview/index.js';

const auto = Object.freeze({ previewPerformanceMode: 'auto' });

test('Atomic 7.3 keeps automatic full/virtual/chapter boundaries exact', () => {
  assert.equal(resolvePreviewMode(auto, 0, 0), 'full');
  assert.equal(resolvePreviewMode(auto, 100000, 0), 'full');
  assert.equal(resolvePreviewMode(auto, 399999, 1399), 'full');
  assert.equal(resolvePreviewMode(auto, 400000, 0), 'virtual');
  assert.equal(resolvePreviewMode(auto, 0, 1400), 'virtual');
  assert.equal(resolvePreviewMode(auto, 999999, 11999), 'virtual');
  assert.equal(resolvePreviewMode(auto, 1000000, 0), 'chapter');
  assert.equal(resolvePreviewMode(auto, 0, 12000), 'chapter');
});

test('Atomic 7.3 preserves manual override priority over document size', () => {
  assert.equal(resolvePreviewMode({ previewPerformanceMode: 'full' }, 2000000, 20000), 'full');
  assert.equal(resolvePreviewMode({ previewPerformanceMode: 'virtual' }, 1, 1), 'virtual');
  assert.equal(resolvePreviewMode({ previewPerformanceMode: 'chapter' }, 1, 1), 'chapter');
});

test('Atomic 7.3 normalizes unsupported or missing settings to auto without mutating input', () => {
  const settings = Object.freeze({ previewPerformanceMode: 'unsupported' });
  assert.equal(normalizePreviewModeSetting(settings.previewPerformanceMode), 'auto');
  assert.equal(normalizePreviewModeSetting(undefined), 'auto');
  assert.equal(resolvePreviewMode(settings, 400000, 0), 'virtual');
  assert.deepEqual(settings, { previewPerformanceMode: 'unsupported' });
});

test('Atomic 7.3 mode resolution is a pure presentation strategy and worker threshold alone stays full', () => {
  const settings = Object.freeze({ previewPerformanceMode: 'auto' });
  const first = resolvePreviewMode(settings, 100000, 100);
  const second = resolvePreviewMode(settings, 100000, 100);
  assert.equal(first, 'full');
  assert.equal(second, first);
});
