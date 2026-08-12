import test from 'node:test';
import assert from 'node:assert/strict';
import { mountClassicOutlineControllerPort } from '../../../src/features/sidebar/compatibility/classic-outline-controller-port.js';

test('Atomic 6.8 classic Outline port is stateless and forwards only to the canonical controller', () => {
  const calls = [];
  const controller = {
    replaceIndex(...args) { calls.push(['index', ...args]); return { accepted: true }; },
    replacePreviewBlocks(...args) { calls.push(['blocks', ...args]); return { accepted: true }; },
    updateActiveLine(...args) { calls.push(['line', ...args]); return null; },
    refresh(...args) { calls.push(['refresh', ...args]); return { rendered: true }; },
    get snapshot() { return { active: true }; }
  };
  const host = {};
  const port = mountClassicOutlineControllerPort(host, controller);
  assert.equal(host.markdownEditorOutlineControllerPort, port);
  assert.deepEqual(port.replaceIndex([{ id: 'a' }], { version: 1 }), { accepted: true });
  port.replacePreviewBlocks([], { version: 2 });
  port.updateActiveLine(4);
  port.refresh('test');
  assert.deepEqual(port.snapshot, { active: true });
  assert.deepEqual(calls.map(item => item[0]), ['index', 'blocks', 'line', 'refresh']);
  port.destroy();
  assert.equal('markdownEditorOutlineControllerPort' in host, false);
  assert.throws(() => port.updateActiveLine(1), /destroyed/);
});
