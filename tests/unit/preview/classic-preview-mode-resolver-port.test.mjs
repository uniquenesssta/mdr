import assert from 'node:assert/strict';
import test from 'node:test';

import { mountClassicPreviewModeResolverPort } from '../../../src/features/preview/index.js';

test('Atomic 7.3 classic resolver port exposes the pure resolver without owning mode state', () => {
  const target = {};
  const mounted = mountClassicPreviewModeResolverPort(target);
  const api = target.markdownEditorPreviewModeResolverPort;

  assert.ok(api);
  assert.equal(Object.keys(target).includes('markdownEditorPreviewModeResolverPort'), false);
  assert.equal(api.normalizeSetting('invalid'), 'auto');
  assert.equal(api.resolve({ previewPerformanceMode: 'auto' }, 400000, 0), 'virtual');
  assert.equal(api.resolve({ previewPerformanceMode: 'full' }, 2000000, 20000), 'full');

  mounted.destroy();
  assert.equal(Object.hasOwn(target, 'markdownEditorPreviewModeResolverPort'), false);
  assert.throws(() => api.resolve({ previewPerformanceMode: 'auto' }, 0, 0), /destroyed/);
  mounted.destroy();
});

test('Atomic 7.3 classic resolver port rejects duplicate ownership on the same host', () => {
  const target = {};
  const mounted = mountClassicPreviewModeResolverPort(target);
  assert.throws(() => mountClassicPreviewModeResolverPort(target), /already mounted/);
  mounted.destroy();
});
