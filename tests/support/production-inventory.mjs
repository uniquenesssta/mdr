import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { discoverProductionFiles, normalizeOwnershipManifest } from '../../scripts/stage-01/module-inventory-core.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Current architecture is defined by actual files, never by a historic stage count.
export async function assertProductionInventory(input) {
  const raw = input ?? JSON.parse(await readFile(new URL('../architecture/fixtures/production-modules.json', import.meta.url), 'utf8'));
  const paths = normalizeOwnershipManifest(raw).modules.map(record => record.path);
  assert.equal(new Set(paths).size, paths.length, 'production inventory contains duplicate paths');
  assert.deepEqual([...paths].sort(), await discoverProductionFiles(root), 'production inventory must cover exactly the actual source surface');
  return raw;
}
