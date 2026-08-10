import { readFile, writeFile } from 'node:fs/promises';

const path = 'tests/architecture/fixtures/production-modules.json';
const inventory = JSON.parse(await readFile(path, 'utf8'));
const command = inventory.modules.find(entry => entry[0] === 'src/features/editor/commands/find-replace-command.js');
const service = inventory.modules.find(entry => entry[0] === 'src/features/editor/application/editor-command-service.js');
if (!command || !service) throw new Error('Atomic 5.11 inventory entries are missing');
command[3] = 'Bounded Find/Replace command owning only next-search cursor/request generation while delegating local search and replacement transactions to the neutral editor adapter and accepting an optional native-search port.';
command[4] = 'find-replace-command-request-state';
service[3] = 'Editor command service composing Atomic 5.10 formatting commands and Atomic 5.11 bounded Find/Replace over one neutral editor adapter without owning document text.';
if (inventory.modules.length !== 270) throw new Error(`Expected 270 production modules, got ${inventory.modules.length}`);
await writeFile(path, JSON.stringify(inventory));
