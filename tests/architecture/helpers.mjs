import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeArchitectureBaseline } from '../../scripts/architecture/checks.mjs';

export async function createArchitectureFixture(files, moduleRecords) {
  const root = await mkdtemp(join(tmpdir(), 'mdr-architecture-'));
  const fields = ['path', 'layer', 'responsibility', 'stateOwner', 'lifecycle', 'surface', 'migration', 'frozen', 'notes'];
  const modules = moduleRecords.map(record => fields.map(field => record[field] ?? (
    field === 'frozen' ? false : ''
  )));
  const allFiles = {
    'tests/architecture/fixtures/production-modules.json': `${JSON.stringify({ schemaVersion: 1, fields, modules }, null, 2)}\n`,
    'README.md': '# Fixture\n\n## Change Log\n',
    ...files
  };
  for (const [path, content] of Object.entries(allFiles)) {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '.'], { cwd: root });
  await writeArchitectureBaseline({ root });
  spawnSync('git', ['add', '.'], { cwd: root });
  return root;
}

export function moduleRecord(path, overrides = {}) {
  return {
    path,
    layer: 'test',
    responsibility: 'fixture',
    stateOwner: 'none',
    lifecycle: 'pure',
    surface: 'esm-module',
    migration: 'keep',
    frozen: false,
    notes: 'fixture',
    ...overrides
  };
}
