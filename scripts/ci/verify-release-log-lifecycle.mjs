// Compile unchanged production logging function bodies with debug assertions off.
// Only the Tauri command attribute and test-module inclusions are omitted: this
// checks the lifecycle/sink boundary, not a packaged Tauri application launch.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

assert.equal(process.platform, 'win32', 'lifecycle release verification requires Windows');
const deps = path.resolve(process.env.CARGO_TARGET_DIR, 'debug/deps');
const library = readdirSync(deps).filter(name => /^libserde_json-.*\.rlib$/.test(name))
  .map(name => path.join(deps, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
assert.ok(library, 'build the locked production dependencies first');
const source = readFileSync('src-tauri/src/performance_log/mod.rs', 'utf8');
const projected = source.replace('pub(crate) mod command;\n', '').replace('#[cfg(test)]\nuse command::write_performance_logs;\n', '')
  .replace(/#\[cfg\([^\n]+\)\]\n#\[path = "[^"\n]+"\]\nmod \w+;\n/g, '')
  .replace(/^mod (\w+);$/gm, (_, name) =>
    `#[path = ${JSON.stringify(path.resolve('src-tauri/src/performance_log', `${name}.rs`))}]\nmod ${name};`);
assert.ok(!projected.includes('tauri::') && !projected.includes('mod lifecycle_contract_tests;'));
const harness = path.join(process.env.RUNNER_TEMP, 'r12-16-release-lifecycle.rs');
const executable = path.join(process.env.RUNNER_TEMP, 'r12-16-release-lifecycle.exe');
const directory = path.join(process.env.RUNNER_TEMP, `r12-16-no-logs-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
assert.equal(existsSync(directory), false);
writeFileSync(harness, projected + `
#[test]
fn release_lifecycle_does_not_create_logs() {
    assert!(!cfg!(debug_assertions));
    let directory = std::path::PathBuf::from(std::env::var_os("MARKDOWN_EDITOR_LOG_DIR").unwrap());
    assert!(!directory.exists());
    record_lifecycle("app.start");
    record_lifecycle("app.exit");
    assert!(!directory.exists());
}
`);
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: {
    ...process.env, CARGO_MANIFEST_DIR: path.resolve('src-tauri'), MARKDOWN_EDITOR_LOG_DIR: directory
  } });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed`);
}
run('rustc', ['--crate-name', 'release_lifecycle', '--edition=2021', '--test', '-C', 'debug-assertions=no',
  harness, '-L', `dependency=${deps}`, '--extern', `serde_json=${library}`, '-o', executable]);
run(executable, ['--exact', 'release_lifecycle_does_not_create_logs', '--nocapture']);
assert.equal(existsSync(directory), false);
