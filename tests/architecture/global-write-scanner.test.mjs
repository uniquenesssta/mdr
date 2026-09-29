import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBusinessGlobalWrites } from '../../scripts/architecture/source-analysis.mjs';

test('global-write scanner distinguishes equality capability checks from assignments', () => {
  const source = `
    if (typeof globalThis.requestAnimationFrame === 'function') use(globalThis.requestAnimationFrame);
    if (window.flag == true || window.flag !== false) use(window.flag);
    if (globalThis['cancelIdleCallback'] === undefined) fallback();
    if (window['status'] == 'ready') read();
  `;
  assert.deepEqual(collectBusinessGlobalWrites('src/probe.js', source), []);
});

test('global-write scanner still detects direct compound and logical assignments', () => {
  const source = `
    window.direct = () => {};
    globalThis['bracket'] = true;
    window.fallback ??= 1;
    globalThis.logical ||= 2;
    window.enabled &&= false;
    window.counter += 1;
    globalThis['remaining'] -= 1;
  `;
  assert.deepEqual(collectBusinessGlobalWrites('src/probe.js', source).map(record => record.global).sort(), [
    'window.direct', 'globalThis.bracket', 'window.fallback', 'globalThis.logical',
    'window.enabled', 'window.counter', 'globalThis.remaining'
  ].sort());
});
