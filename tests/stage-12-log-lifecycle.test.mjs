import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { rustFunction } from './support/performance-log/storage-contract.mjs';

const baseline = 'd9f0bae9244f26da004dfd5013a05d5d92c4c6c3';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
const entryPath = 'src-tauri/src/performance_log.rs';
const lifecyclePath = 'src-tauri/src/performance_log/lifecycle.rs';
const tokens = source => source.replace(/\s+/g, '');

test('R12-16 moves the unchanged lifecycle event into one stateless owner with a public re-export', async () => {
  const entry = await read(entryPath);
  const lifecycle = await read(lifecyclePath);
  assert.equal(tokens(rustFunction(lifecycle, 'record_lifecycle')), tokens(rustFunction(frozen(entryPath), 'record_lifecycle')));
  assert.match(entry, /^mod lifecycle;\npub use lifecycle::record_lifecycle;/);
  assert.doesNotMatch(entry, /fn record_lifecycle/);
  assert.match(lifecycle, /use super::record_backend;/);
  assert.doesNotMatch(lifecycle, /static |Mutex|OnceLock|async |spawn|OpenOptions|fs::|tauri::/);
  for (const name of ['record_backend', 'measure_async', 'measure_sync', 'write_performance_logs']) {
    assert.equal(tokens(rustFunction(entry, name)), tokens(rustFunction(frozen(entryPath), name)), name);
  }
});

test('R12-16 preserves startup before the builder and exit before propagation of application failure', async () => {
  const main = await read('src-tauri/src/main.rs');
  assert.equal(main, frozen('src-tauri/src/main.rs'));
  const markers = ['record_lifecycle("app.start")', 'tauri::Builder::default()',
    '.run(tauri::generate_context!())', 'record_lifecycle("app.exit")', 'result.expect('];
  let previous = -1;
  for (const marker of markers) {
    const at = main.indexOf(marker);
    assert.ok(at > previous, marker);
    previous = at;
  }
  const backend = rustFunction(await read(entryPath), 'record_backend');
  assert.match(backend, /if let Err\(err\) = append_values/);
  assert.match(backend, /eprintln!\("performance log error: \{err\}"\)/);
  assert.doesNotMatch(backend, /\.unwrap\(|\.expect\(|panic!|-> Result/);
});

test('R12-16 leaves paths writer redaction commands dependencies and frontend behavior unchanged', async () => {
  for (const path of ['src-tauri/src/performance_log/paths.rs', 'src-tauri/src/performance_log/writer.rs',
    'src-tauri/src/performance_log/redaction.rs', 'src/runtime/performance.js',
    'src/platform/desktop/performance-log-client.js', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
    'package.json', 'package-lock.json']) assert.equal(await read(path), frozen(path), path);
});

test('R12-16 adds only its lifecycle inventory record without changing prior ownership', async () => {
  const path = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(path));
  const after = JSON.parse(await read(path));
  assert.deepEqual(after.fields, before.fields);
  assert.deepEqual(after.modules.filter(row => row[0] !== lifecyclePath), before.modules);
  assert.deepEqual(after.modules.filter(row => row[0] === lifecyclePath), [[lifecyclePath,
    'rust-module', 'telemetry', 'Stateless startup and exit event projection through the best-effort backend log sink.',
    'none', 'per-lifecycle-event', 'retain', false]]);
});

test('R12-16 Windows validation covers real lifecycle I/O failures and release no-write mode', async () => {
  const workflow = await read('.github/workflows/r12-14.yml');
  for (const marker of ['R12-16 Log Lifecycle', baseline, 'lifecycle-before.log', 'lifecycle-after.log',
    'performance_log::lifecycle_contract_tests', 'test result: ok. 6 passed; 0 failed',
    'scripts/ci/verify-release-log-lifecycle.mjs', 'tests/stage-12-log-lifecycle.test.mjs']) {
    assert.ok(workflow.includes(marker), marker);
  }
  assert.doesNotMatch(workflow, /ubuntu-|macos-|continue-on-error|\|\| true/);
  const scenarios = await read('src-tauri/tests/performance_log/lifecycle_contract.rs');
  for (const name of ['events', 'directory', 'open', 'poison', 'repeat']) assert.ok(scenarios.includes(`run_case("${name}"`));
  assert.match(scenarios, /Command::new\(std::env::current_exe\(\)/);
  assert.doesNotMatch(scenarios, /#\[ignore\]|env::set_var/);
  const release = await read('scripts/ci/verify-release-log-lifecycle.mjs');
  assert.match(release, /debug-assertions=no/);
  assert.match(release, /record_lifecycle\("app.start"\)/);
  assert.match(release, /record_lifecycle\("app.exit"\)/);
  assert.match(release, /assert!\(!directory.exists\(\)\)/);
});
