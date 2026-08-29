import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';

const root = process.cwd();
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));

test('Atomic Task 2.1 legacy DOM inventory remains an immutable historical baseline', async () => {
  const [inventory, migrationMap, manifest] = await Promise.all([
    readJson('tests/ui/fixtures/dom-asset-inventory.json'),
    readJson('tests/ui/fixtures/dom-migration-map.json'),
    readJson('tests/ui/fixtures/dom-region-manifest.json')
  ]);

  assert.deepEqual(inventory.source, {
    path: 'index.html',
    sha256: 'a52065b680f26f3169193f6c937753f83eed25f882712e8955ccbe3b075fd29f',
    lineCount: 944
  });
  assert.equal(inventory.summary.elementCount, 1054);
  assert.equal(inventory.summary.idCount, 173);
  assert.equal(inventory.summary.classCount, 140);
  assert.equal(inventory.summary.inlineEventCount, 184);
  assert.equal(inventory.summary.inlineStyleCount, 32);
  assert.equal(inventory.summary.ariaNodeCount, 72);
  assert.equal(inventory.summary.dataAttributeNodeCount, 163);
  assert.equal(inventory.summary.scriptCount, 2);
  assert.equal(inventory.summary.semanticRegionCount, 31);
  assert.deepEqual(inventory.scripts.map(script => ({ src: script.src, type: script.type })), [
    { src: '/i18n.js', type: null },
    { src: '/src/main.js', type: 'module' }
  ]);
  assert.equal(migrationMap.baseline.sourceCommit, manifest.baseline.sourceCommit);
});

test('Atomic Task 2.1 migration map keeps every legacy node uniquely assigned', async () => {
  const [inventory, migrationMap, manifest] = await Promise.all([
    readJson('tests/ui/fixtures/dom-asset-inventory.json'),
    readJson('tests/ui/fixtures/dom-migration-map.json'),
    readJson('tests/ui/fixtures/dom-region-manifest.json')
  ]);
  assert.equal(migrationMap.coverage.nodeCount, inventory.summary.elementCount);
  assert.equal(migrationMap.coverage.assignedNodeCount, inventory.summary.elementCount);
  assert.equal(migrationMap.coverage.unassignedNodeCount, 0);
  assert.equal(migrationMap.coverage.ambiguousNodeCount, 0);
  assert.equal(migrationMap.nodeAssignments.length, inventory.summary.elementCount);
  assert.equal(migrationMap.regions.length, manifest.regions.length);
  for (const region of migrationMap.regions) {
    assert.ok(region.semantic);
    assert.ok(region.currentOwner);
    assert.ok(region.targetOwner);
    assert.ok(region.targetTask);
    assert.ok(region.disposition);
    assert.equal(region.nodeCount, region.expectedNodeCount);
  }
});

test('Atomic Task 2.1 preserves the complete downstream migration ownership plan', async () => {
  const [inventory, migrationMap] = await Promise.all([
    readJson('tests/ui/fixtures/dom-asset-inventory.json'),
    readJson('tests/ui/fixtures/dom-migration-map.json')
  ]);
  for (const targetTask of ['2.2', '2.3', '2.4', '2.5', '2.6']) {
    assert.ok(migrationMap.regions.some(region => region.targetTask === targetTask));
  }
  assert.ok(inventory.summary.runtimeSelectorCallCount > 0);
  assert.ok(inventory.summary.testSelectorCallCount > 0);
  assert.ok(inventory.summary.classMutationCallCount > 0);
  assert.ok(migrationMap.references.dynamicClassNames.length > 0);
  assert.ok(!migrationMap.regions.some(region => region.disposition === 'completed-migration'));
});
