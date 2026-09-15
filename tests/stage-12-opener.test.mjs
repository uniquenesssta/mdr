import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const baseline = 'db46e1b26eac069e3534831bcfd25c311bfa3050';
const entryPath = 'src-tauri/src/external_link.rs';
const openerPath = 'src-tauri/src/external_link/opener.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
const hook = '\n#[cfg(all(test, target_os = "linux"))]\n#[path = "../tests/external_link/opener.rs"]\nmod opener_tests;\n';
function platformBlock(text) {
  const start = text.indexOf('#[cfg(target_os = "windows")]');
  const end = text.indexOf('#[tauri::command]');
  assert.ok(start >= 0 && end > start, 'all native platform functions precede the command');
  return text.slice(start, end);
}
// Preserve every string literal/token; only rustfmt whitespace and trailing commas may differ.
function tokens(text) {
  const parts = text.match(/"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[^\s]/g) || [];
  return parts.filter((part, i) => !(part === ',' && parts[i + 1] === ')'));
}

test('R12-10 extracts exactly the platform implementations and keeps the command and legacy tests', async () => {
  const before = frozen(entryPath);
  const expected = before.replace(platformBlock(before), '')
    .replace('mod validation;', 'mod opener;\nmod validation;')
    .replace('use validation::', 'use opener::open_platform_url;\nuse validation::') + hook;
  assert.equal(await read(entryPath), expected);
  const opener = await read(openerPath);
  const production = opener.slice(opener.indexOf('#[cfg(target_os = "windows")]'));
  assert.deepEqual(tokens(production), tokens(platformBlock(before).replaceAll(
    'fn open_platform_url', 'pub(super) fn open_platform_url')));
});

test('R12-10 keeps the complete Windows ABI and native spawn error semantics without another policy', async () => {
  const opener = await read(openerPath);
  assert.equal((opener.match(/pub\(super\) fn open_platform_url/g) || []).length, 3);
  assert.match(opener, /#\[link\(name = "shell32"\)\]/);
  assert.match(opener, /extern "system"/);
  assert.match(opener, /result <= 32/);
  assert.match(opener, /encode_wide\(\)\.chain\(once\(0\)\)/);
  assert.equal((opener.match(/\.arg\(url\)\s*\.spawn\(\)\s*\.map\(\|_\| \(\)\)/g) || []).length, 2);
  assert.doesNotMatch(opener, /validate_external_url|Url::parse|\.trim\(|\.scheme\(|tauri::|reqwest|std::fs|\.wait\(|\.status\(|static |Mutex|pub fn/);
  const entry = (await read(entryPath)).split('#[cfg(test)]')[0];
  assert.doesNotMatch(entry, /ShellExecuteW|Command::|std::process|unsafe|target_os/);
  assert.match(entry, /let validated = validate_external_url\(&url\)\?;\s*open_platform_url\(&validated\)/);
  assert.doesNotMatch(entry, /pub mod opener|pub use opener/);
});

test('R12-10 freezes validation, frontend, registry, dependency and independent fixture contracts', async () => {
  for (const path of ['src-tauri/src/external_link/validation.rs',
    'src-tauri/tests/external_link/command_validation.rs', 'src-tauri/src/main.rs',
    'src/platform/desktop/link-client.js', 'src/runtime/link-preview.js',
    'src-tauri/tests/stage_12_security_compatibility.rs',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json', 'package-lock.json']) {
    assert.equal(await read(path), frozen(path), `frozen contract changed: ${path}`);
  }
});

test('R12-10 covers the real system launcher, failure propagation and validation before launch', async () => {
  const tests = await read('src-tauri/tests/external_link/opener.rs');
  assert.equal((tests.match(/#\[test\]/g) || []).length, 7);
  for (const text of ['use super::{open_external_url, open_platform_url}', '/usr/bin/xdg-open',
    '.env_clear()', '.env("BROWSER", &application)', 'one literal URL argument',
    'Error::from_raw_os_error(2)', 'Error::from_raw_os_error(13)',
    'private_opener_does_not_duplicate_protocol_validation',
    'backend_rejects_before_real_launcher', 'nul_argument_preserves_spawn_error',
    'real_launcher_preserves_spawn_success_when_handler_fails',
    'child.kill()', 'child.wait()', 'remove_dir_all', 'injection-marker']) {
    assert.ok(tests.includes(text), `missing process regression: ${text}`);
  }
  assert.doesNotMatch(tests, /#\[ignore\]|mock!|env::set_var|env::set_current_dir/);
  const native = await read('src-tauri/tests/external_link_opener_platform.rs');
  assert.match(native, /#\[path = "\.\.\/src\/external_link\/opener\.rs"\]/);
  assert.match(native, /fn\(&str\) -> Result<\(\), String> = opener::open_platform_url/);
  assert.match(native, /std::hint::black_box\(launch\)/);
});

test('R12-10 adds exactly one cohesive stateless system boundary to the ownership inventory', async () => {
  const path = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(path));
  const after = JSON.parse(await read(path));
  assert.equal(after.modules.length, 438);
  assert.equal(after.modules.length, before.modules.length + 1);
  assert.deepEqual(after.fields, before.fields);
  for (const row of before.modules.filter(row => row[0] !== entryPath)) {
    assert.deepEqual(after.modules.find(next => next[0] === row[0]), row);
  }
  const records = after.modules.filter(row => row[0] === openerPath);
  assert.equal(records.length, 1);
  assert.equal(records[0][after.fields.indexOf('stateOwner')], 'none');
  assert.equal(records[0][after.fields.indexOf('lifecycle')], 'per-call-system-launch');
});

test('R12-10 keeps the complete old workflow as manual history and every cumulative hard gate', async () => {
  const oldPath = '.github/workflows/r12-09.yml';
  const before = frozen(oldPath);
  assert.equal(await read(oldPath), before.replace(/  push:\n[\s\S]*?(?=  workflow_dispatch:)/, ''));
  const current = await read('.github/workflows/r12-10.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git clean|git reset/);
  for (const text of ['external_link::validation::tests', 'external_link::validation_command_tests',
    'local_file::command_tests', 'local_file::tests', 'local_file::tree_limits::tests',
    'local_file::directory_tree::tests', 'local_file::text_writer::tests', 'local_file::binary_writer::tests',
    'local_file::text_reader::tests', 'local_file::image_reader::tests', 'file_kind::tests',
    'path_policy::tests', 'stage_12_security_compatibility', 'cargo clippy',
    '--locked --all-targets -- -D warnings', 'cargo check', 'npm test', 'npm audit --audit-level=high',
    'npm run verify:architecture', 'npm run verify:no-legacy-runtime', 'npm run verify:generated-files',
    'npm run verify:readme-record', 'npm run test:browser:contract', 'npm run test:browser', 'npm run build',
    'git diff --exit-code', 'git ls-files --others --exclude-standard', 'archiveTauriLinuxSchema',
    'tests/unit/platform/link-client.test.mjs', 'tests/stage-12-opener.test.mjs']) {
    assert.ok(current.includes(text), `missing cumulative gate: ${text}`);
  }
});

test('R12-10 validates unchanged real process tests before and after extraction plus native linkage', async () => {
  const current = await read('.github/workflows/r12-10.yml');
  for (const text of [`git archive ${baseline} | tar`,
    'cp src-tauri/tests/external_link/opener.rs "$baseline/src-tauri/tests/external_link/opener.rs"',
    'test ! -e "$baseline/src-tauri/src/external_link/opener.rs"',
    'external_link::opener_tests', 'rust-opener-baseline.log', 'rust-opener.log',
    'test result: ok. 7 passed; 0 failed', 'xdg-utils',
    'os: [windows-latest, macos-latest]', 'rustc --edition=2021 --test -D warnings',
    'src-tauri/tests/external_link_opener_platform.rs', 'test result: ok. 1 passed; 0 failed',
    'ref: ${{ github.sha }}', 'persist-credentials: false']) {
    assert.ok(current.includes(text), `missing native/baseline gate: ${text}`);
  }
  assert.ok(current.indexOf('pre-split real process behavior') < current.indexOf('extracted real process behavior'));
});
