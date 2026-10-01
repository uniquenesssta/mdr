import { assertCurrentValidation } from './support/current-rust-contracts.mjs';
import { assertProductionInventory } from './support/production-inventory.mjs';
import { readCurrentRustSources as readFile } from './support/current-rust-contracts.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import test from 'node:test';

const baseline = 'db46e1b26eac069e3534831bcfd25c311bfa3050';
const entryPath = 'src-tauri/src/external_link/mod.rs';
const openerPath = 'src-tauri/src/external_link/opener.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path.replace(/\/(external_link|web_fetch|performance_log)\/mod\.rs$/, "/$1.rs")}`], { encoding: 'utf8' });

const hook = '\n#[cfg(all(test, target_os = "linux"))]\n#[path = "../tests/external_link/opener.rs"]\nmod opener_tests;\n';
// Preserve every string literal/token; only rustfmt whitespace and trailing commas may differ.

test('R12-10 keeps native launching private behind the validated command', async () => {
  const entry = await read('src-tauri/src/external_link/mod.rs');
  assert.match(entry, /^mod opener;/m);
  assert.doesNotMatch(entry, /pub mod opener|pub use opener/);
  const command = await read('src-tauri/src/external_link/command.rs');
  assert.match(command, /validate_external_url\(&url\)\?;\s*open_platform_url\(&validated\)/);
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
  const entry = await read('src-tauri/src/external_link/command.rs');
  assert.doesNotMatch(entry, /ShellExecuteW|Command::|std::process|unsafe|target_os/);
  assert.match(entry, /let validated = validate_external_url\(&url\)\?;\s*open_platform_url\(&validated\)/);
  assert.doesNotMatch(entry, /pub mod opener|pub use opener/);
});

test('R12-10 validates current native ABI and platform port behavior in Windows', async () => {
  await assertCurrentValidation();
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
  const after = await assertProductionInventory();
  const records = after.modules.filter(row => row[0] === openerPath);
  assert.equal(records.length, 1);
  assert.equal(records[0][after.fields.indexOf('stateOwner')], 'none');
  assert.equal(records[0][after.fields.indexOf('lifecycle')], 'per-call-system-launch');
});

test('R12-10 keeps the complete old workflow as manual history and every cumulative hard gate', async () => {
  const oldPath = '.github/workflows/r12-09.yml';
  const before = frozen(oldPath);
  assert.equal((await read(oldPath)).replace(/^    if: \$\{\{ false \}\} # Retired: Windows-only validation policy, 2026-09-29\.\n/gm, ''), before.replace(/  push:\n[\s\S]*?(?=  workflow_dispatch:)/, ''));
  const current = await read('.github/workflows/r12-14.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r13-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git clean|git reset/);
  for (const text of ['external_link::validation::tests', 'external_link::validation_command_tests',
    'local_file::command_tests', 'local_file::tests', 'local_file::tree_limits::tests',
    'local_file::directory_tree::tests', 'local_file::text_writer::tests', 'local_file::binary_writer::tests',
    'local_file::text_reader::tests', 'local_file::image_reader::tests', 'file_kind::tests',
    'path_policy::tests', 'stage_12_security_compatibility', 'cargo clippy',
    '--locked --all-targets -- -D warnings', 'cargo check', 'npm test', 'npm audit --audit-level=high',
    'npm run verify:architecture', 'npm run verify:no-legacy-runtime', 'npm run verify:generated-files',
    'npm run verify:readme-record', 'npm run test:browser:contract', 'npm run test:browser', 'npm run build',
    'git diff --exit-code', 'git ls-files --others --exclude-standard',
    'tests/unit/platform/link-client.test.mjs', 'tests/stage-12-opener.test.mjs']) {
    assert.ok(current.includes(text), `missing cumulative gate: ${text}`);
  }
});

test('Windows-only validation retains native linkage without running retired Linux launcher checks', async () => {
  const current = await read('.github/workflows/r12-14.yml');
  for (const text of ['os: [windows-latest]', 'rustc --edition=2021 --test -D warnings',
    'src-tauri/tests/external_link_opener_platform.rs', 'test result: ok. 1 passed; 0 failed',
    'ref: ${{ github.sha }}', 'persist-credentials: false']) {
    assert.ok(current.includes(text), `missing Windows linkage gate: ${text}`);
  }
  assert.doesNotMatch(current, /external_link::opener_tests|xdg-utils|apt-get|archiveTauriLinuxSchema|macos-latest|ubuntu-/);
});
