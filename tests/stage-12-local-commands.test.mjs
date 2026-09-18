import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, access } from 'node:fs/promises';
import test from 'node:test';

const baseline = '9405ab44d6bb5f05eb755a2341e3ba76b4831ed8';
const directory = 'src-tauri/src/local_file/';
const names = ['list_text_file_tree', 'read_dropped_file', 'read_local_image',
  'write_local_text_file', 'write_local_binary_file', 'initial_file_path'];
const specialists = ['binary_writer', 'directory_tree', 'file_kind', 'image_reader',
  'path_policy', 'text_reader', 'text_writer', 'tree_limits'];
const source = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
// rustfmt may collapse a multiline parameter list and remove its optional trailing comma.
const tokens = text => text.replace(/,\s*\)(\s*->)/g, ')$1').replace(/\s+/g, '');

function functionSource(text, name) {
  const match = text.match(new RegExp(`^(?:pub(?:\\(super\\))? )?(?:async )?fn ${name}\\b[\\s\\S]*?^}`, 'm'));
  assert.ok(match, `missing function: ${name}`);
  return match[0];
}

function structSource(text, name) {
  const match = text.match(new RegExp(`#\\[derive\\(Debug, Serialize\\)\\]\\s*#\\[serde\\(rename_all = "camelCase"\\)\\]\\s*pub struct ${name} \\{[\\s\\S]*?^}`, 'm'));
  assert.ok(match, `missing DTO: ${name}`);
  return match[0];
}

test('R12-08 deletes the monolith and keeps the directory entry free of implementation', async () => {
  await assert.rejects(access('src-tauri/src/local_file.rs'), { code: 'ENOENT' });
  const entry = await source(`${directory}mod.rs`);
  assert.match(entry, /pub\(crate\) mod commands;/);
  for (const name of [...specialists, 'operations', 'types']) assert.match(entry, new RegExp(`mod ${name};`));
  assert.doesNotMatch(entry, /\bfn\s|#\[tauri::command\]|fs::|spawn_blocking|measure_sync/);
  assert.match(entry, /pub use types::\{DroppedFile, LocalImageData, LocalWriteResult\};/);
  assert.match(entry, /pub use directory_tree::\{TextFileTree, TextFileTreeNode\};/);
});

test('R12-08 preserves each command signature telemetry payload dispatch and task error exactly', async () => {
  const before = frozen('src-tauri/src/local_file.rs');
  const after = await source(`${directory}commands.rs`);
  const registered = [...after.matchAll(/#\[tauri::command\]\s*pub (?:async )?fn (\w+)/g)].map(match => match[1]);
  assert.deepEqual(registered, names);
  for (const name of names.filter(value => value !== 'initial_file_path')) {
    const expected = functionSource(before, name).replace(/\b(\w+)_inner\(/g, 'operations::$1(');
    assert.equal(tokens(functionSource(after, name)), tokens(expected), `${name} transport contract changed`);
  }
  assert.equal(tokens(functionSource(after, 'initial_file_path')),
    tokens('pub fn initial_file_path() -> Option<String> { operations::select_initial_file_path(env::args_os().skip(1)) }'));
  assert.doesNotMatch(after, /fs::|File::|\.is_file\(|\bclassify\(|fn \w+_inner|pub struct|const MAX_|12_000/);
  assert.equal((after.match(/spawn_blocking\(/g) || []).length, 4);
});

test('R12-08 preserves operation bodies while separating them from Tauri instrumentation', async () => {
  const before = frozen('src-tauri/src/local_file.rs');
  const operations = await source(`${directory}operations.rs`);
  for (const name of ['read_local_image', 'read_dropped_file', 'write_local_text_file', 'write_local_binary_file']) {
    const expected = functionSource(before, `${name}_inner`).replace(`fn ${name}_inner`, `pub(super) fn ${name}`);
    assert.equal(tokens(functionSource(operations, name)), tokens(expected), `${name} operation changed`);
  }
  const startup = functionSource(operations, 'select_initial_file_path');
  assert.match(startup, /\.find\(\|path\| path\.is_file\(\) && is_supported_text_path\(path\)\)/);
  assert.doesNotMatch(operations, /#\[tauri::command\]|tauri::|performance_log|measure_sync|const MAX_|fs::(?:read|write|read_dir)\(/);
});

test('R12-08 preserves exact DTO definitions and all eight specialist source blobs', async () => {
  const before = frozen('src-tauri/src/local_file.rs');
  const types = await source(`${directory}types.rs`);
  for (const name of ['DroppedFile', 'LocalImageData', 'LocalWriteResult']) {
    assert.equal(tokens(structSource(types, name)), tokens(structSource(before, name)));
  }
  assert.doesNotMatch(types, /\bfn\s|fs::|tauri::|performance_log/);
  for (const name of specialists) {
    const path = `${directory}${name}.rs`;
    assert.equal(await source(path), frozen(path), `specialist changed outside command migration: ${path}`);
  }
});

test('R12-08 changes only the six Rust registry paths and no frontend or dependency contracts', async () => {
  let expected = frozen('src-tauri/src/main.rs');
  for (const name of names) expected = expected.replace(`local_file::${name}`, `local_file::commands::${name}`);
  assert.equal(await source('src-tauri/src/main.rs'), expected);
  // R12-09/10 freeze external links; R12-11 compares the moved web policy and unchanged HTTP chain.
  for (const path of [
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json', 'package-lock.json',
    'src/platform/desktop/file-system-client.js',
    'src-tauri/src/performance_log.rs'
  ]) assert.equal(await source(path), frozen(path), `protected contract changed: ${path}`);
});

test('R12-08 retains all eight legacy direct tests and adds twelve real command tests', async () => {
  const before = frozen('src-tauri/src/local_file.rs');
  const legacy = await source('src-tauri/tests/local_file/legacy.rs');
  const security = await source('src-tauri/tests/local_file/stage_12.rs');
  const commands = await source('src-tauri/tests/local_file/commands.rs');
  const oldTests = [...before.matchAll(/#\[test\]\s*fn (\w+)/g)].map(match => match[1]);
  assert.equal(oldTests.length, 8);
  for (const name of oldTests) {
    const expected = functionSource(before.replace(/^    /gm, ''), name).replace(/\b(\w+)_inner\(/g, '$1(');
    const after = functionSource(`${legacy}\n${security}`, name);
    assert.equal(tokens(after), tokens(expected), `legacy test changed: ${name}`);
  }
  assert.equal((commands.match(/#\[test\]/g) || []).length, 12);
  assert.doesNotMatch(`${legacy}\n${security}\n${commands}`, /#\[ignore\]|mock|set_var|set_current_dir/);
  for (const name of names) assert.match(commands, new RegExp(`commands::${name}\\(`));
  assert.match(commands, /fs::read\(&path\)/);
  assert.match(commands, /tree_command_preserves_default_limits_and_call_isolation/);
});

test('R12-08 records unique module ownership and never exposes lower-level modules publicly', async () => {
  const inventory = JSON.parse(await source('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 440);
  const records = inventory.modules.filter(record => record[0].startsWith(directory));
  assert.equal(records.length, 12);
  assert.equal(new Set(records.map(record => record[0])).size, 12);
  assert.ok(!inventory.modules.some(record => record[0] === 'src-tauri/src/local_file.rs'));
  const entry = await source(`${directory}mod.rs`);
  for (const name of [...specialists, 'operations', 'types']) {
    assert.doesNotMatch(entry, new RegExp(`pub(?:\\([^)]*\\))? mod ${name};`));
  }
  const actual = (await readdir(directory)).filter(name => name.endsWith('.rs')).sort();
  assert.deepEqual(actual, records.map(record => record[0].slice(directory.length)).sort());
});

test('R12-08 combines R12-07 regression with command tests and every existing hard gate', async () => {
  const workflow = await source('.github/workflows/r12-12.yml');
  const previous = await source('.github/workflows/r12-07.yml');
  assert.match(workflow, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true|--no-verify|#\[ignore\]/);
  // runner context is unavailable in job-level env; resolve this path inside the runner step.
  const jobEnvironments = [...workflow.matchAll(/^    env:\n((?:      [^\n]*\n)*)/gm)];
  for (const [, environment] of jobEnvironments) assert.doesNotMatch(environment, /\$\{\{\s*runner\./);
  assert.ok(workflow.includes(`printf 'MARKDOWN_EDITOR_LOG_DIR=%s/r12-12/performance-logs\\n' "$RUNNER_TEMP" >> "$GITHUB_ENV"`));
  for (const text of [
    'local_file::command_tests', 'test result: ok. 12 passed; 0 failed',
    'local_file::tree_limits::tests', 'test result: ok. 6 passed; 0 failed',
    'local_file::tests', 'stage_12_', 'stage_12_security_compatibility',
    'cargo clippy', '--all-targets -- -D warnings', 'cargo check',
    'npm test', 'npm audit --audit-level=high', 'npm run test:browser:contract',
    'npm run test:browser', 'npm run build', 'git diff --exit-code'
  ]) assert.ok(workflow.includes(text), `missing hard gate: ${text}`);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
  await assert.rejects(access('.github/workflows/r12-source-snapshot.yml'), { code: 'ENOENT' });
});
