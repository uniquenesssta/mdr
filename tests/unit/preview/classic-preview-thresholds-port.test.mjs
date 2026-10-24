import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_BEHAVIOR_THRESHOLDS, resolvePreviewMode } from '../../../src/features/preview/index.js';
import { PREVIEW_BEHAVIOR_THRESHOLDS as canonical } from '../../../src/features/preview/pipeline/preview-thresholds.js';

test('R16-08 public threshold capability exposes the one recursively frozen owner', () => {
  assert.equal(PREVIEW_BEHAVIOR_THRESHOLDS, canonical);
  const check = value => { assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) if (child && typeof child === 'object') check(child); };
  check(canonical);
  assert.throws(() => { canonical.mode.virtualChars = 0; }, TypeError);
});

test('R16-08 the direct resolver preserves threshold boundaries without a mounted DOM object', () => {
  const threshold = canonical.mode;
  assert.equal(resolvePreviewMode({}, threshold.virtualChars - 1, 0), 'full');
  assert.equal(resolvePreviewMode({}, threshold.virtualChars, 0), 'virtual');
  assert.equal(resolvePreviewMode({}, threshold.chapterChars, 0), 'chapter');
  assert.equal(resolvePreviewMode({}, 0, threshold.virtualBlocks), 'virtual');
  assert.equal(resolvePreviewMode({}, 0, threshold.chapterBlocks), 'chapter');
});
