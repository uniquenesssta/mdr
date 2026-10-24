import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewRenderCoordinator } from '../../../src/features/preview/index.js';
test('R16-08 direct render coordination keeps the model result and dispatches only the selected renderer', () => {
  const coordinator = createPreviewRenderCoordinator(), result = { blocks: [{ id: 'one' }] }, calls = [];
  const plan = coordinator.createPlan({ modelResult: result });
  assert.equal(plan.strategy, 'dom-incremental');
  assert.equal(plan.renderResult, result);
  assert.equal(Object.isFrozen(plan), true);
  const outcome = coordinator.execute(plan, { renderIncremental(context) { calls.push(context); return 'rendered'; } });
  assert.equal(outcome, 'rendered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].renderResult, result);
  assert.equal(Object.isFrozen(calls[0]), true);
  coordinator.destroy();
});
test('R16-08 render coordinator validates dispatch and becomes terminal without any mounted host', () => {
  const coordinator = createPreviewRenderCoordinator(), plan = coordinator.createPlan({});
  assert.throws(() => coordinator.execute(null, {}), /render plan/);
  assert.throws(() => coordinator.execute(plan, {}), /renderIncremental/);
  coordinator.destroy(); coordinator.destroy();
  assert.throws(() => coordinator.createPlan({}), /destroyed/);
  assert.throws(() => coordinator.execute(plan, {}), /destroyed/);
});
