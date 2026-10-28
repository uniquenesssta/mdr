import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchPolicyController } from '../../../src/features/settings/application/launch-policy-controller.js';
test('native failure rolls toggle back; multiple-window rejection does not claim success', async () => {
  const renders = [];
  const controller = createLaunchPolicyController({ supported: true, view: { render: value => renders.push(value) }, launch: {
    readContext: async () => ({ enabled: false }), setSingleInstance: async () => { throw new Error('请先关闭其他窗口'); }
  } });
  await controller.refresh(); assert.equal(await controller.change(true), false);
  assert.equal(renders.at(-1).enabled, false); assert.equal(renders.at(-1).busy, false);
  assert.match(renders.at(-1).message, /关闭其他窗口/);
  let reset = false; assert.equal(await controller.reset(() => { reset = true; }), false); assert.equal(reset, false);
});
test('reset rolls native setting back when local preferences fail to persist', async () => {
  const writes = [];
  const controller = createLaunchPolicyController({ supported: true, view: { render() {} }, launch: {
    readContext: async () => ({ enabled: false }), setSingleInstance: async value => { writes.push(value); return value; }
  } });
  await controller.refresh(); assert.equal(await controller.reset(() => false), false); assert.deepEqual(writes, [true, false]);
});
