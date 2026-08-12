import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PREVIEW_BEHAVIOR_THRESHOLDS } from '../../../src/features/preview/index.js';

const fixtureUrl = new URL('../../fixtures/preview-behavior-thresholds.json', import.meta.url);
const expected = JSON.parse(await readFile(fixtureUrl, 'utf8'));

function assertDeepFrozen(value, path = 'thresholds') {
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') assertDeepFrozen(child, `${path}.${key}`);
  }
}

test('Atomic 7.1 freezes the exact existing preview behavior thresholds', () => {
  assert.deepEqual(PREVIEW_BEHAVIOR_THRESHOLDS, expected);
  assertDeepFrozen(PREVIEW_BEHAVIOR_THRESHOLDS);
});

test('Atomic 7.1 keeps document, scheduling, virtual-window and chapter limits in separate immutable groups', () => {
  assert.deepEqual(Object.keys(PREVIEW_BEHAVIOR_THRESHOLDS), [
    'mode',
    'scheduling',
    'virtualWindow',
    'chapter'
  ]);
  assert.equal(PREVIEW_BEHAVIOR_THRESHOLDS.mode.workerChars, 100000);
  assert.equal(PREVIEW_BEHAVIOR_THRESHOLDS.mode.virtualChars, 400000);
  assert.equal(PREVIEW_BEHAVIOR_THRESHOLDS.mode.chapterChars, 1000000);
  assert.equal(PREVIEW_BEHAVIOR_THRESHOLDS.virtualWindow.maximumBlocks, 180);
  assert.equal(PREVIEW_BEHAVIOR_THRESHOLDS.chapter.priorityChars, 120000);
});
