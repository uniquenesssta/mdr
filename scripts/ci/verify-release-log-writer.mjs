// Compile the exact production sink with debug assertions off using the already
// built locked dependencies. This proves release sink behavior, not a Tauri GUI launch.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
assert.equal(process.platform, 'win32', 'release log writer verification requires Windows');
const deps = path.resolve(process.env.CARGO_TARGET_DIR, 'debug/deps');
const libraries = readdirSync(deps).filter(name => /^libserde_json-.*\.rlib$/.test(name))
  .map(name => path.join(deps, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
assert.ok(libraries.length, 'run the locked debug build before the release-mode harness');
const output = path.join(process.env.RUNNER_TEMP, 'r12-15-release-log-writer.exe');
const directory = path.join(process.env.RUNNER_TEMP, `r12-15-release-no-logs-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
assert.equal(existsSync(directory), false);
function run(command, args, env) {
  const result = spawnSync(command, args, { env: { ...process.env, ...env }, encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed`);
}
run('rustc', ['--edition=2021', '--test', '-C', 'debug-assertions=no',
  'src-tauri/tests/performance_log/release_writer.rs', '-L', `dependency=${deps}`,
  '--extern', `serde_json=${libraries[0]}`, '-o', output],
  { CARGO_MANIFEST_DIR: path.resolve('src-tauri') });
run(output, ['--exact', 'release_writer_never_resolves_paths_or_writes_even_for_oversized_input', '--nocapture'],
  { MARKDOWN_EDITOR_LOG_DIR: directory });
assert.equal(existsSync(directory), false);
console.log('Release-mode production writer: no directory or file created.');
