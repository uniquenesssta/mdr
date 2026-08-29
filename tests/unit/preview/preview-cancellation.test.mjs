import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewCancellation } from '../../../src/features/preview/pipeline/preview-cancellation.js';

test('Atomic 7.4 cancellation tokens are independent per preview scheduling channel', () => {
  const cancellation = createPreviewCancellation();
  const inputV1 = cancellation.issue('input');
  const layoutV1 = cancellation.issue('layout');

  assert.equal(cancellation.isCurrent(inputV1), true);
  assert.equal(cancellation.isCurrent(layoutV1), true);

  const inputV2 = cancellation.issue('input');
  assert.equal(cancellation.isCurrent(inputV1), false);
  assert.equal(cancellation.isCurrent(inputV2), true);
  assert.equal(cancellation.isCurrent(layoutV1), true);

  cancellation.cancel('input');
  assert.equal(cancellation.isCurrent(inputV2), false);
  assert.equal(cancellation.isCurrent(layoutV1), true);
});

test('Atomic 7.4 stale tokens cannot commit side effects', () => {
  const cancellation = createPreviewCancellation();
  const stale = cancellation.issue('enhancement');
  const current = cancellation.issue('enhancement');
  const commits = [];

  assert.equal(cancellation.commit(stale, () => commits.push('stale')), false);
  assert.equal(cancellation.commit(current, () => commits.push('current')), true);
  assert.deepEqual(commits, ['current']);
});

test('Atomic 7.4 destroy invalidates every channel and makes mutation terminal', () => {
  const cancellation = createPreviewCancellation();
  const focus = cancellation.issue('focus');
  const layout = cancellation.issue('layout');

  cancellation.destroy();

  assert.equal(cancellation.isCurrent(focus), false);
  assert.equal(cancellation.isCurrent(layout), false);
  assert.throws(() => cancellation.issue('input'), /destroyed/i);
  assert.throws(() => cancellation.cancel('input'), /destroyed/i);
});
