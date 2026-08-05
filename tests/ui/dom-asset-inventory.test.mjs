import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { buildHtmlInventory } from '../../scripts/stage-02/dom-inventory/html-inventory.mjs';
import { collectRepositoryReferences } from '../../scripts/stage-02/dom-inventory/repository-references.mjs';
import { buildMigrationMap } from '../../scripts/stage-02/dom-inventory/migration-map.mjs';

const root = process.cwd();

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

async function buildCurrentFacts() {
  const [htmlSource, manifest] = await Promise.all([
    readFile(resolve(root, 'index.html'), 'utf8'),
    readJson('tests/ui/fixtures/dom-region-manifest.json')
  ]);
  const htmlInventory = buildHtmlInventory(htmlSource);
  const references = await collectRepositoryReferences(root);
  const migrationMap = buildMigrationMap({ htmlInventory, references, manifest });
  const inventory = {
    schemaVersion: 1,
    baseline: manifest.baseline,
    source: htmlInventory.source,
    summary: {
      ...htmlInventory.summary,
      ...references.summary,
      semanticRegionCount: manifest.regions.length
    },
    nodes: htmlInventory.nodes,
    ids: htmlInventory.ids,
    classes: htmlInventory.classes,
    inlineEvents: htmlInventory.inlineEvents,
    scripts: htmlInventory.scripts
  };
  return { inventory, migrationMap, manifest };
}

test('committed DOM asset inventory exactly matches the current legacy HTML and selector evidence', async () => {
  const [{ inventory, migrationMap }, committedInventory, committedMap] = await Promise.all([
    buildCurrentFacts(),
    readJson('tests/ui/fixtures/dom-asset-inventory.json'),
    readJson('tests/ui/fixtures/dom-migration-map.json')
  ]);
  assert.deepEqual(inventory, committedInventory);
  assert.deepEqual(migrationMap, committedMap);
});

test('every legacy HTML node has one semantic owner and one migration disposition', async () => {
  const { inventory, migrationMap, manifest } = await buildCurrentFacts();
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

test('Stage 2.1 freezes all required DOM asset categories without claiming UI migration', async () => {
  const { inventory, migrationMap } = await buildCurrentFacts();
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
  assert.equal(migrationMap.coverage.unassignedNodeCount, 0);
  assert.equal(migrationMap.coverage.ambiguousNodeCount, 0);
  assert.ok(inventory.summary.runtimeSelectorCallCount > 0);
  assert.ok(inventory.summary.testSelectorCallCount > 0);
  assert.ok(inventory.summary.classMutationCallCount > 0);
  assert.ok(migrationMap.references.dynamicClassNames.length > 0);
  assert.ok(migrationMap.regions.some(region => region.targetTask === '2.2'));
  assert.ok(migrationMap.regions.some(region => region.targetTask === '2.3'));
  assert.ok(migrationMap.regions.some(region => region.targetTask === '2.4'));
  assert.ok(migrationMap.regions.some(region => region.targetTask === '2.5'));
  assert.ok(migrationMap.regions.some(region => region.targetTask === '2.6'));
  assert.ok(!migrationMap.regions.some(region => region.disposition === 'completed-migration'));
});
