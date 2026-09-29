import assert from 'node:assert/strict';
import { readFileBeforeRegistry as readFile, inventoryBeforeRegistryExtraction } from '../command-registry-contract.mjs';

const root = 'src-tauri/src/performance_log';
const read = path => readFile(path, 'utf8');
const tokens = text => text.replace(/\s+/g, '');
export function rustFunction(text, name) {
  const match = text.match(new RegExp(`^(?:pub(?:\\(super\\))? )?(?:async )?fn ${name}\\b[\\s\\S]*?^}`, 'm'));
  assert.ok(match, `missing log function ${name}`);
  const declaration = match[0].indexOf('{');
  return (match[0].slice(0, declaration).replace(/,\s*\)/g, ')') + match[0].slice(declaration))
    .replace(/^pub(?:\(super\))? /, '');
}

// A prior task's whole-file freeze becomes a per-owner function contract after R12-15.
// This preserves each moved body and all unmoved command/measurement/lifecycle behavior.
export async function assertLogStorageExtraction(before) {
  if (!before.includes('let redacted = redact_value(value);')) {
    before = before.replace('let line = serde_json::to_string(value)',
      'let redacted = redact_value(value);\n        let line = serde_json::to_string(&redacted)');
  }
  const [entry, paths, writer] = await Promise.all([read(`${root}.rs`), read(`${root}/paths.rs`), read(`${root}/writer.rs`)]);
  for (const [source, names] of [
    [entry, ['record_backend', 'measure_async', 'measure_sync', 'write_performance_logs']],
    [await read(`${root}/lifecycle.rs`), ['record_lifecycle']],
    [paths, ['unix_time_ms', 'utc_timestamp_from_unix_ms', 'log_directory', 'log_file_path']],
    [writer, ['write_lock', 'append_values']]
  ]) for (const name of names) assert.equal(tokens(rustFunction(source, name)), tokens(rustFunction(before, name)), name);
  assert.doesNotMatch(entry, /static |OpenOptions|fs::|fn append_values|fn log_file_path/);
  assert.match(entry, /use writer::append_values;/);
  assert.match(writer, /paths::log_file_path, redaction::redact_value/);
  assert.match(writer, /static WRITE_LOCK: OnceLock<Mutex<\(\)>>/);
  assert.match(paths, /static LOG_FILE_PATH: OnceLock<PathBuf>/);
}

export function logFixtureAfterStorageExtraction(text) {
  return text.replace('const SOURCE_PERFORMANCE_LOG: &str = include_str!("../src/performance_log.rs");',
    'const SOURCE_PERFORMANCE_LOG: &str = concat!(\n    include_str!("../src/performance_log.rs"),\n    include_str!("../src/performance_log/paths.rs"),\n    include_str!("../src/performance_log/writer.rs"),\n    include_str!("../src/performance_log/lifecycle.rs"),\n);');
}

// Historical inventory assertions keep checking their own task. R12-15 separately
// checks the actual new rows and their unique state owners, never the projected view.
export function inventoryBeforeLifecycleExtraction(inventory) {
  inventory = inventoryBeforeRegistryExtraction(inventory);
  return { ...inventory, modules: inventory.modules.filter(row => row[0] !== `${root}/lifecycle.rs`) };
}

export function inventoryBeforeLogStorageExtraction(inventory) {
  return { ...inventory, modules: inventoryBeforeLifecycleExtraction(inventory).modules
    .filter(row => ![`${root}/paths.rs`, `${root}/writer.rs`].includes(row[0]))
    .map(row => row[0] === `${root}.rs` ? [row[0], 'rust-module', 'telemetry',
      'Development performance log session creation and JSONL persistence.',
      'performance-log-session', 'process-lifecycle', 'rewrite', false] : row) };
}
