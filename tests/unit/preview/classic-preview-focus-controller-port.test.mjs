import assert from 'node:assert/strict';
import test from 'node:test';
import { mountClassicPreviewFocusControllerPort } from '../../../src/features/preview/compatibility/classic-preview-focus-controller-port.js';

function createController(log = []) {
  return {
    connect(value) { log.push(['connect', value]); return 'connected'; },
    scheduleCursorFocus(line) { log.push(['schedule', line]); return true; },
    focusLine(line, options) { log.push(['focus', line, options]); return Promise.resolve(true); },
    cancel() { log.push(['cancel']); return true; }
  };
}

test('Atomic 7.11 classic focus port forwards the exact scoped controller contract', async () => {
  const host = {};
  const log = [];
  const owner = mountClassicPreviewFocusControllerPort(host, createController(log));
  const port = host.markdownEditorPreviewFocusControllerPort;
  const capabilities = { value: 1 };
  assert.equal(port.connect(capabilities), 'connected');
  assert.equal(port.scheduleCursorFocus(7), true);
  assert.equal(await port.focusLine(9, { scroll: false }), true);
  assert.equal(port.cancel(), true);
  assert.deepEqual(log, [
    ['connect', capabilities],
    ['schedule', 7],
    ['focus', 9, { scroll: false }],
    ['cancel']
  ]);
  owner.destroy();
});

test('Atomic 7.11 classic focus port rejects duplicate ownership and removes only itself', () => {
  const host = {};
  const owner = mountClassicPreviewFocusControllerPort(host, createController());
  assert.throws(() => mountClassicPreviewFocusControllerPort(host, createController()), /already mounted/);
  const replacement = {};
  host.markdownEditorPreviewFocusControllerPort = replacement;
  owner.destroy();
  assert.equal(host.markdownEditorPreviewFocusControllerPort, replacement);
  owner.destroy();
});

test('Atomic 7.11 classic focus port validates every required operation and becomes terminal after destroy', async () => {
  const host = {};
  assert.throws(
    () => mountClassicPreviewFocusControllerPort(host, { connect() {}, scheduleCursorFocus() {}, focusLine() {} }),
    /cancel/
  );
  const owner = mountClassicPreviewFocusControllerPort(host, createController());
  const port = host.markdownEditorPreviewFocusControllerPort;
  owner.destroy();
  assert.throws(() => port.cancel(), /destroyed/);
  await assert.rejects(Promise.resolve().then(() => port.focusLine(1)), /destroyed/);
});
