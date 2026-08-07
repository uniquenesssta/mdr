import assert from 'node:assert/strict';
import test from 'node:test';
import { mountClassicPlatformPort } from '../../../src/platform/compatibility/classic-platform-port.js';

function createHost() { return { removeAttribute() {} }; }
function createPlatform() {
  const calls = [];
  return {
    calls,
    capabilities: Object.freeze({ isDesktop: true, desktop: Object.freeze({ window: true, fileSystem: true }) }),
    files: Object.freeze({ readText(path) { calls.push(['files.readText', path]); return 'text'; } }),
    dialogs: Object.freeze({ confirm(message) { calls.push(['dialogs.confirm', message]); return true; } })
  };
}

test('Atomic Task 3.12 classic bridge exposes call/supports only on the dedicated host', () => {
  const host = createHost();
  const platform = createPlatform();
  const mount = mountClassicPlatformPort(host, platform);
  const port = host.markdownEditorPlatformPort;
  assert.ok(Object.isFrozen(port));
  assert.deepEqual(Object.keys(port), ['supports', 'call']);
  assert.equal(port.supports('desktop.window'), true);
  assert.equal(port.supports('desktop.dialogs'), false);
  assert.equal(port.call('files', 'readText', 'a.md'), 'text');
  assert.equal(port.call('dialogs', 'confirm', 'ok?'), true);
  assert.deepEqual(platform.calls, [['files.readText', 'a.md'], ['dialogs.confirm', 'ok?']]);
  assert.equal(globalThis.markdownEditorPlatformPort, undefined);
  assert.equal(globalThis.markdownEditorNative, undefined);
  mount.destroy();
  mount.destroy();
  assert.equal(host.markdownEditorPlatformPort, undefined);
});

test('classic bridge fails explicitly for unknown calls and invalid/terminal mounts', () => {
  const host = createHost();
  const mount = mountClassicPlatformPort(host, createPlatform());
  assert.throws(() => host.markdownEditorPlatformPort.call('files', 'missing'), /Unknown Platform method/);
  mount.destroy();
  assert.throws(() => mountClassicPlatformPort(null, createPlatform()), /requires a DOM host/);
  assert.throws(() => mountClassicPlatformPort(createHost(), null), /requires a Platform object/);
});
