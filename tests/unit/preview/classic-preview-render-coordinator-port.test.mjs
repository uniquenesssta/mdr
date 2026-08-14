import assert from 'node:assert/strict';
import test from 'node:test';

import { mountClassicPreviewRenderCoordinatorPort } from '../../../src/features/preview/compatibility/classic-preview-render-coordinator-port.js';

function fakeCoordinator() {
  const calls = [];
  return {
    calls,
    createPlan(input) {
      calls.push(['plan', input]);
      return { strategy: 'dom-incremental', marker: input.marker };
    },
    execute(plan, renderers) {
      calls.push(['execute', plan, renderers]);
      return renderers.renderIncremental(plan);
    }
  };
}

test('classic Render Coordinator port mounts one scoped forwarding view', () => {
  const host = {};
  const coordinator = fakeCoordinator();
  const handle = mountClassicPreviewRenderCoordinatorPort(host, coordinator);
  assert.equal(host.markdownEditorPreviewRenderCoordinatorPort, handle.api);
  const plan = handle.api.createPlan({ marker: 7 });
  const result = handle.api.execute(plan, { renderIncremental: value => ({ marker: value.marker }) });
  assert.deepEqual(result, { marker: 7 });
  assert.deepEqual(coordinator.calls.map(call => call[0]), ['plan', 'execute']);
  handle.destroy();
  assert.equal(host.markdownEditorPreviewRenderCoordinatorPort, undefined);
  handle.destroy();
});

test('classic Render Coordinator port rejects mount collisions', () => {
  const host = { markdownEditorPreviewRenderCoordinatorPort: { existing: true } };
  assert.throws(() => mountClassicPreviewRenderCoordinatorPort(host, fakeCoordinator()), /already mounted/);
});
