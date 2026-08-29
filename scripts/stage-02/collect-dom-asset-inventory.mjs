import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildHtmlInventory } from './dom-inventory/html-inventory.mjs';
import { collectRepositoryReferences } from './dom-inventory/repository-references.mjs';
import { buildMigrationMap } from './dom-inventory/migration-map.mjs';

const root = process.cwd();
const argumentsByName = new Map(
  process.argv.slice(2).filter(value => value.startsWith('--') && value.includes('='))
    .map(value => {
      const separator = value.indexOf('=');
      return [value.slice(2, separator), value.slice(separator + 1)];
    })
);
const writeFixtures = process.argv.includes('--write-fixtures');
const inventoryOutput = resolve(
  root,
  argumentsByName.get('inventory-output') || 'artifacts/stage-02/02-01-dom-asset-inventory.json'
);
const mapOutput = resolve(
  root,
  argumentsByName.get('map-output') || 'artifacts/stage-02/02-01-dom-migration-map.json'
);
const fixtureInventory = resolve(root, 'tests/ui/fixtures/dom-asset-inventory.json');
const fixtureMap = resolve(root, 'tests/ui/fixtures/dom-migration-map.json');
const manifestPath = resolve(root, 'tests/ui/fixtures/dom-region-manifest.json');

const [htmlSource, manifestSource] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(manifestPath, 'utf8')
]);
const manifest = JSON.parse(manifestSource);
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

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

await Promise.all([
  writeJson(inventoryOutput, inventory),
  writeJson(mapOutput, migrationMap)
]);
if (writeFixtures) {
  await Promise.all([
    writeJson(fixtureInventory, inventory),
    writeJson(fixtureMap, migrationMap)
  ]);
}
console.log(
  `Collected ${inventory.summary.elementCount} DOM nodes across ${inventory.summary.semanticRegionCount} semantic regions.`
);
