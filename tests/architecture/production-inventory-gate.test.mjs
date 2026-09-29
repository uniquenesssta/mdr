import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkProductionInventory } from '../../scripts/architecture/checks.mjs';

test('architecture gate independently rejects missing duplicate and obsolete ownership records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdr-inventory-gate-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'tests/architecture/fixtures'), { recursive: true });
    await writeFile(join(root, 'src/current.js'), 'export const current = true;\n');
    const check = async paths => {
      await writeFile(join(root, 'tests/architecture/fixtures/production-modules.json'), JSON.stringify({
        schemaVersion: 1, fields: ['path'], modules: paths.map(path => [path])
      }));
      return checkProductionInventory({ root });
    };
    assert.deepEqual(await check(['src/current.js']), []);
    assert.match((await check([]))[0].message, /no ownership record/);
    assert.match((await check(['src/current.js', 'src/current.js']))[0].message, /Duplicate/);
    assert.match((await check(['src/current.js', 'src/deleted.js']))[0].message, /no production file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
