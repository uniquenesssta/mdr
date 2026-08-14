import assert from 'node:assert/strict';
import test from 'node:test';
import { mountClassicPreviewEnhancementCoordinatorPort } from '../../../src/features/preview/compatibility/classic-preview-enhancement-coordinator-port.js';

const METHODS = ['connect', 'begin', 'setPriorityRange', 'enqueue', 'schedulePostprocess', 'cancel', 'getStats'];

function createCoordinator(log = []) {
  return Object.fromEntries(METHODS.map(method => [method, (...args) => {
    log.push([method, ...args]);
    return method;
  }]));
}

test('Atomic 7.12 classic port forwards the exact scoped coordinator contract', () => {
  const host = {};
  const log = [];
  const mount = mountClassicPreviewEnhancementCoordinatorPort(host, createCoordinator(log));
  const port = host.markdownEditorPreviewEnhancementCoordinatorPort;
  assert.ok(port);
  assert.deepEqual(Object.keys(port).sort(), [...METHODS].sort());
  assert.equal(port.begin(12), 'begin');
  assert.deepEqual(log, [['begin', 12]]);
  mount.destroy();
});

test('Atomic 7.12 classic port rejects duplicate ownership and validates required methods', () => {
  const host = {};
  const mount = mountClassicPreviewEnhancementCoordinatorPort(host, createCoordinator());
  assert.throws(() => mountClassicPreviewEnhancementCoordinatorPort(host, createCoordinator()), /already mounted/);
  mount.destroy();
  assert.throws(() => mountClassicPreviewEnhancementCoordinatorPort({}, {}), /coordinator\.connect/);
});

test('Atomic 7.12 classic port removes only itself and becomes terminal after destroy', () => {
  const host = { keep: true };
  const mount = mountClassicPreviewEnhancementCoordinatorPort(host, createCoordinator());
  const port = host.markdownEditorPreviewEnhancementCoordinatorPort;
  mount.destroy();
  mount.destroy();
  assert.equal(host.keep, true);
  assert.equal(host.markdownEditorPreviewEnhancementCoordinatorPort, undefined);
  assert.throws(() => port.cancel(), /destroyed/);
});
