import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkLegacyRuntime } from '../../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord } from './helpers.mjs';

test('locks legacy business globals to an exact migration baseline', async () => {
  const root = await createArchitectureFixture({
    'src/runtime/legacy.js': 'window.legacyBridge = {};\n'
  }, [
    moduleRecord('src/runtime/legacy.js', {
      lifecycle: 'module-load',
      surface: 'esm-entrypoint',
      migration: 'rewrite'
    })
  ]);

  assert.deepEqual(await checkLegacyRuntime({ root }), []);
  await writeFile(
    join(root, 'src/runtime/legacy.js'),
    'window.legacyBridge = {};\nwindow.newBusinessApi = {};\n',
    'utf8'
  );
  const issues = await checkLegacyRuntime({ root });
  assert.ok(issues.some(issue => (
    issue.rule === 'business-global-regression'
      && issue.path === 'src/runtime/legacy.js'
      && issue.message.includes('window.newBusinessApi')
  )));
});

test('never allows business globals inside strict architecture zones', async () => {
  const root = await createArchitectureFixture({
    'src/app/create-application.js': 'window.application = {};\nexport const createApplication = () => ({});\n'
  }, [moduleRecord('src/app/create-application.js')]);

  const issues = await checkLegacyRuntime({ root });
  assert.ok(issues.some(issue => (
    issue.rule === 'strict-zone-business-global'
      && issue.path === 'src/app/create-application.js'
  )));
});
