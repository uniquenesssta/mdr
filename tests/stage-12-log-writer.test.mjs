import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertLogStorageExtraction, inventoryBeforeLifecycleExtraction } from './support/performance-log/storage-contract.mjs';

const baseline = '17b8f430066219817e5405d8047234fb556a745e';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });

test('R12-15 preserves moved log function bodies and all public measurement command and lifecycle behavior', async () => {
  await assertLogStorageExtraction(frozen('src-tauri/src/performance_log.rs'));
  for (const path of ['src-tauri/src/performance_log/redaction.rs', 'src/runtime/performance.js',
    'src/platform/desktop/performance-log-client.js', 'src-tauri/src/main.rs',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json', 'package-lock.json']) {
    assert.equal(await read(path), frozen(path), `unrelated boundary changed: ${path}`);
  }
});

test('R12-15 has one path cache and one write lock and redacts before serializing and writing', async () => {
  const entry = await read('src-tauri/src/performance_log.rs');
  const paths = await read('src-tauri/src/performance_log/paths.rs');
  const writer = await read('src-tauri/src/performance_log/writer.rs');
  assert.equal(([entry, paths, writer].join('\n').match(/static LOG_FILE_PATH:/g) || []).length, 1);
  assert.equal(([entry, paths, writer].join('\n').match(/static WRITE_LOCK:/g) || []).length, 1);
  assert.doesNotMatch(paths, /OpenOptions|redact_value|Mutex/);
  assert.doesNotMatch(writer, /env::|SystemTime|static LOG_FILE_PATH/);
  const append = writer.slice(writer.indexOf('pub(super) fn append_values'));
  const order = ['if !cfg!(debug_assertions)', 'if values.is_empty()', 'values.len() > MAX_BATCH_ENTRIES',
    'let file_path = log_file_path()?', 'write_lock()', 'OpenOptions::new()', 'let redacted = redact_value(value)',
    'serde_json::to_string(&redacted)', 'line.len() > MAX_ENTRY_BYTES', 'file.write_all', 'file.flush()'];
  let previous = -1;
  for (const marker of order) {
    const next = append.indexOf(marker);
    assert.ok(next > previous, `missing or reordered boundary: ${marker}`);
    previous = next;
  }
  assert.match(writer, /const MAX_BATCH_ENTRIES: usize = 500;/);
  assert.match(writer, /const MAX_ENTRY_BYTES: usize = 64 \* 1024;/);
});

test('R12-15 inventory assigns session and serialization states to their actual owners', async () => {
  const inventory = inventoryBeforeLifecycleExtraction(JSON.parse(await read('tests/architecture/fixtures/production-modules.json')));
  const expected = new Map([
    ['src-tauri/src/performance_log.rs', 'none'],
    ['src-tauri/src/performance_log/paths.rs', 'performance-log-session-path'],
    ['src-tauri/src/performance_log/writer.rs', 'performance-log-write-lock']
  ]);
  for (const [path, owner] of expected) {
    const rows = inventory.modules.filter(row => row[0] === path);
    assert.equal(rows.length, 1, path);
    assert.equal(rows[0][inventory.fields.indexOf('stateOwner')], owner);
    await read(path);
  }
  const before = JSON.parse(frozen('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, before.modules.length + 2);
  for (const row of before.modules.filter(row => !expected.has(row[0]))) {
    assert.deepEqual(inventory.modules.find(next => next[0] === row[0]), row);
  }
});

test('R12-15 Windows workflow exercises before and after real file behavior plus release no-write mode', async () => {
  const workflow = await read('.github/workflows/r12-14.yml');
  for (const marker of ['R12-16 Log Lifecycle', 'tests/stage-12-log-writer.test.mjs',
    'R12-15 pre-split real log writer 9 of 9', 'R12-15 extracted real log writer 9 of 9',
    'R12-15 release writer creates no log files', 'performance_log::writer_contract_tests',
    'test result: ok. 9 passed; 0 failed', 'scripts/ci/verify-release-log-writer.mjs',
    'src-tauri/src/performance_log/paths.rs', 'src-tauri/src/performance_log/writer.rs',
    'src-tauri/tests/performance_log/writer_contract.rs']) assert.ok(workflow.includes(marker), marker);
  assert.doesNotMatch(workflow, /ubuntu-|macos-|continue-on-error|\|\| true/);
  const release = await read('scripts/ci/verify-release-log-writer.mjs');
  assert.match(release, /debug-assertions=no/);
  assert.match(release, /release_writer_never_resolves_paths_or_writes_even_for_oversized_input/);
  const scenarios = await read('src-tauri/tests/performance_log/writer_contract.rs');
  for (const name of ['empty', 'append', 'batch', 'size', 'partial', 'directory', 'open', 'concurrent']) {
    assert.ok(scenarios.includes(`run_case("${name}")`), name);
  }
});
