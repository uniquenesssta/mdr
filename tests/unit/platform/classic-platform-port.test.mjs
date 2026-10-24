import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatform, PlatformCapabilityUnavailableError } from '../../../src/platform/index.js';
test('R16-08 explicit Platform uses typed capabilities and methods without the old call/supports facade', async () => {
  const calls = [], runtime = { confirm(message) { calls.push(message); return true; } };
  const platform = createPlatform({ runtime });
  assert.equal(platform.capabilities.desktop.window, false);
  assert.equal(platform.capabilities.desktop.dialogs, false);
  assert.equal(platform.dialogs.confirm('ok?'), true);
  assert.deepEqual(calls, ['ok?']);
  assert.equal(Object.hasOwn(platform, 'call'), false); assert.equal(Object.hasOwn(platform, 'supports'), false);
  assert.equal(Object.isFrozen(platform), true);
  assert.equal(globalThis.markdownEditorPlatformPort, undefined); assert.equal(globalThis.markdownEditorNative, undefined);
  await platform.destroy(); await platform.destroy();
});
test('R16-08 unsupported and destroyed typed Platform calls fail explicitly', async () => {
  const platform = createPlatform({ runtime: {} });
  assert.throws(() => platform.files.readText('a.md'), PlatformCapabilityUnavailableError);
  assert.throws(() => platform.dialogs.openDirectory({}), PlatformCapabilityUnavailableError);
  assert.equal(platform.files.missing, undefined);
  await platform.destroy();
  assert.throws(() => platform.files.readText('a.md'), /destroyed/);
});
