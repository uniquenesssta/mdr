import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildModuleInventory } from './module-inventory-core.mjs';

const root = process.cwd();
const outputArgument = process.argv.find(value => value.startsWith('--output='));
const output = resolve(root, outputArgument?.slice('--output='.length) || 'artifacts/stage-01/01-01-module-inventory.json');
const manifestPath = resolve(root, 'tests/architecture/fixtures/production-modules.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const inventory = await buildModuleInventory({ root, manifest });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
console.log(`Collected ${inventory.moduleCount} production modules into ${output}.`);
