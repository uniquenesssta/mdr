// Enumerate tracked tests rather than shell globs, so Windows and nested suites agree.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const files = execFileSync('git', ['ls-files', '-z', 'tests'], { encoding: 'utf8' })
  .split('\0').filter(path => path.endsWith('.test.mjs')).sort();
if (!files.length) throw new Error('No tracked Node tests found.');
const evidence = join(process.env.RUNNER_TEMP || tmpdir(), 'repository-audit');
mkdirSync(evidence, { recursive: true });
writeFileSync(join(evidence, 'test-inventory.json'), JSON.stringify(files, null, 2) + '\n');
// One small process per directory avoids Windows command-line length limits.
// Sequential groups also prevent browser suites competing for desktop resources.
const groups = Map.groupBy(files, path => path.slice(0, path.lastIndexOf('/')));
const results = [];
for (const [directory, tests] of groups) {
  console.log(`\nRunning ${directory}: ${tests.length} files`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
    stdio: 'inherit', env: process.env
  });
  results.push({ directory, files: tests.length, status: result.status, error: result.error?.message || null });
}
writeFileSync(join(evidence, 'suite-results.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(result => result.status !== 0 || result.error)) process.exitCode = 1;
