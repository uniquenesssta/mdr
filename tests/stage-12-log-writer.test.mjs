import { assertCurrentValidation, assertOwner } from './support/current-rust-contracts.mjs';
import { assertProductionInventory } from './support/production-inventory.mjs';
import { readCurrentRustSources as readFile } from './support/current-rust-contracts.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import test from 'node:test';

const baseline = '17b8f430066219817e5405d8047234fb556a745e';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path.replace(/\/(external_link|web_fetch|performance_log)\/mod\.rs$/, "/$1.rs")}`], { encoding: 'utf8' });

test('R12-15 preserves current command measurement and storage interfaces', async () => {
  const command = await read('src-tauri/src/performance_log/command.rs');
  assert.match(command, /pub fn write_performance_logs\(entries: Vec<Value>\) -> Result<String, String>/);
  const entry = await read('src-tauri/src/performance_log/mod.rs');
  for (const name of ['record_backend', 'measure_async', 'measure_sync']) assert.ok(entry.includes(name), name);
  await assertCurrentValidation();
});

test('R12-15 has one path cache and one write lock and redacts before serializing and writing', async () => {
  const entry = await read('src-tauri/src/performance_log/mod.rs');
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

test('R12-15 inventories the actual log state owners', async () => {
  await assertProductionInventory();
  await assertOwner('src-tauri/src/performance_log/paths.rs', 'performance-log-session-path');
  await assertOwner('src-tauri/src/performance_log/writer.rs', 'performance-log-write-lock');
});

test('R12-15 Windows workflow exercises before and after real file behavior plus release no-write mode', async () => {
  const workflow = await read('.github/workflows/r12-14.yml');
  await assertCurrentValidation();
  const scenarios = await read('src-tauri/tests/performance_log/writer_contract.rs');
  for (const name of ['empty', 'append', 'batch', 'size', 'partial', 'directory', 'open', 'concurrent']) {
    assert.ok(scenarios.includes(`run_case("${name}")`), name);
  }
});
