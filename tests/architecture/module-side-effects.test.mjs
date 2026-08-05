import assert from 'node:assert/strict';
import test from 'node:test';
import { createArchitectureFixture, moduleRecord } from './helpers.mjs';
import { checkModuleImportSideEffects } from '../../scripts/architecture/checks.mjs';

test('imports strict architecture modules without runtime or platform access', async () => {
  const root = await createArchitectureFixture({
    'src/app/pure.js': 'export function createValue() { return { ready: true }; }\n',
    'src/model-kernel/index.js': 'export const value = Object.freeze({ ready: true });\n'
  }, [
    moduleRecord('src/app/pure.js'),
    moduleRecord('src/model-kernel/index.js')
  ]);

  assert.deepEqual(await checkModuleImportSideEffects({ root }), []);
});

test('reports exact strict module path when import registers runtime work', async () => {
  const root = await createArchitectureFixture({
    'src/app/impure.js': 'setTimeout(() => {}, 0);\nexport const ready = true;\n'
  }, [moduleRecord('src/app/impure.js')]);

  const issues = await checkModuleImportSideEffects({ root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'module-import-side-effect');
  assert.equal(issues[0].path, 'src/app/impure.js');
  assert.match(issues[0].detail, /forbidden import-time runtime access: setTimeout/);
});
