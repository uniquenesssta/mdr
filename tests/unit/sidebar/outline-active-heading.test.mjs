import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveOutlineHeading } from '../../../src/features/sidebar/outline/outline-active-heading.js';

const headings = Object.freeze([
  Object.freeze({ id: 'a', line: 2 }),
  Object.freeze({ id: 'b', line: 5 }),
  Object.freeze({ id: 'c', line: 12 })
]);

test('Atomic 6.8 active heading uses the nearest heading at or before the source line', () => {
  assert.equal(resolveActiveOutlineHeading(headings, 1).id, 'a');
  assert.equal(resolveActiveOutlineHeading(headings, 2).id, 'a');
  assert.equal(resolveActiveOutlineHeading(headings, 9).id, 'b');
  assert.equal(resolveActiveOutlineHeading(headings, 99).id, 'c');
  assert.equal(resolveActiveOutlineHeading([], 4), null);
});
