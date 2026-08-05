import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkDependencyBoundaries } from '../../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord } from './helpers.mjs';

test('allows cross-feature imports through the target feature public entry', async () => {
  const root = await createArchitectureFixture({
    'src/features/alpha/index.js': "export { alpha } from './alpha.js';\n",
    'src/features/alpha/alpha.js': "import { beta } from '../beta/index.js';\nexport const alpha = beta;\n",
    'src/features/beta/index.js': "export { beta } from './internal.js';\n",
    'src/features/beta/internal.js': 'export const beta = 1;\n'
  }, [
    moduleRecord('src/features/alpha/index.js'),
    moduleRecord('src/features/alpha/alpha.js'),
    moduleRecord('src/features/beta/index.js'),
    moduleRecord('src/features/beta/internal.js')
  ]);

  assert.deepEqual(await checkDependencyBoundaries({ root }), []);
});

test('reports the exact importer for cross-feature internals and cycles', async () => {
  const root = await createArchitectureFixture({
    'src/features/alpha/index.js': "export { alpha } from './alpha.js';\n",
    'src/features/alpha/alpha.js': "import { beta } from '../beta/internal.js';\nexport const alpha = beta;\n",
    'src/features/beta/index.js': "export { beta } from './internal.js';\n",
    'src/features/beta/internal.js': "import { alpha } from '../alpha/alpha.js';\nexport const beta = alpha;\n"
  }, [
    moduleRecord('src/features/alpha/index.js'),
    moduleRecord('src/features/alpha/alpha.js'),
    moduleRecord('src/features/beta/index.js'),
    moduleRecord('src/features/beta/internal.js')
  ]);

  const issues = await checkDependencyBoundaries({ root });
  assert.ok(issues.some(issue => (
    issue.rule === 'cross-feature-internal-import'
      && issue.path === 'src/features/alpha/alpha.js'
      && issue.line === 1
  )));
  assert.ok(issues.some(issue => issue.rule === 'circular-dependency'));

  await writeFile(
    join(root, 'src/features/alpha/alpha.js'),
    "import { beta } from '../beta/index.js';\nexport const alpha = beta;\n",
    'utf8'
  );
  const remaining = await checkDependencyBoundaries({ root });
  assert.equal(remaining.filter(issue => issue.rule === 'cross-feature-internal-import').length, 1);
});
