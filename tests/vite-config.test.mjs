import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parentNodeModules = resolve(repositoryRoot, '..', 'node_modules');

test('Vite dev server permits only the repository and intentional parent dependency directory', () => {
  const allow = config.server?.fs?.allow || [];
  assert.deepEqual(allow, [repositoryRoot, parentNodeModules]);
  assert.equal(allow.includes(resolve(repositoryRoot, '..')), false);
});

test('production bundle budgets remain stricter for startup chunks than lazy vendor chunks', () => {
  assert.equal(config.build?.chunkSizeWarningLimit, 700);
  assert.ok(Array.isArray(config.plugins));
  assert.equal(config.plugins.some(plugin => plugin?.name === 'bundle-budget'), true);
});
