import { assertProductionInventory } from './support/production-inventory.mjs';
import { assertCurrentValidation, assertOwner } from './support/current-rust-contracts.mjs';
import { readCurrentRustSources as readFile } from './support/current-rust-contracts.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import test from 'node:test';
import { rustFunction } from './support/performance-log/storage-contract.mjs';

const baseline = 'd9f0bae9244f26da004dfd5013a05d5d92c4c6c3';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path.replace(/\/(external_link|web_fetch|performance_log)\/mod\.rs$/, "/$1.rs")}`], { encoding: 'utf8' });
const entryPath = 'src-tauri/src/performance_log/mod.rs';
const lifecyclePath = 'src-tauri/src/performance_log/lifecycle.rs';
const tokens = source => source.replace(/\s+/g, '');

test('R12-16 delegates stateless lifecycle events through the best-effort log sink', async () => {
  const entry = await read('src-tauri/src/performance_log/mod.rs');
  const lifecycle = await read(lifecyclePath);
  assert.match(entry, /pub use lifecycle::record_lifecycle/);
  assert.match(lifecycle, /use super::record_backend/);
  assert.doesNotMatch(lifecycle, /static |Mutex|OnceLock|async |spawn|OpenOptions|fs::|tauri::/);
  await assertCurrentValidation();
});

test('R12-16 preserves startup before the builder and exit before propagation of application failure', async () => {
  const main = await read('src-tauri/src/main.rs');
  await assertCurrentValidation();
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

test('R12-16 preserves real lifecycle failure handling and release no-write contracts', async () => {
  await assertCurrentValidation();
});

test('R12-16 inventories the stateless lifecycle owner', async () => {
  await assertProductionInventory();
  await assertOwner('src-tauri/src/performance_log/lifecycle.rs', 'none');
});

test('R12-16 Windows validation covers real lifecycle I/O failures and release no-write mode', async () => {
  const workflow = await read('.github/workflows/r12-14.yml');
  await assertCurrentValidation();
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
