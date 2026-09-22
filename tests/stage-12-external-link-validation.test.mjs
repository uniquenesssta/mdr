import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const baseline = '9405ab44d6bb5f05eb755a2341e3ba76b4831ed8';
const entryPath = 'src-tauri/src/external_link.rs';
const policyPath = 'src-tauri/src/external_link/validation.rs';
const commandTestPath = 'src-tauri/tests/external_link/command_validation.rs';
const source = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
function validator(text) {
  const match = text.match(/^(?:pub\(super\) )?fn validate_external_url\b[\s\S]*?^}/m);
  assert.ok(match, 'a single explicit URL validator must exist');
  return match[0];
}

test('R12-09 creates one private pure URL-validation authority', async () => {
  const [entry, policy] = await Promise.all([source(entryPath), source(policyPath)]);
  const production = policy.split('#[cfg(test)]')[0];
  assert.match(entry, /^mod validation;/m);
  assert.match(entry, /use validation::validate_external_url;/);
  assert.doesNotMatch(entry, /fn validate_external_url|Url::parse|use url::Url|parsed\.scheme/);
  assert.equal((production.match(/fn validate_external_url/g) || []).length, 1);
  assert.match(production, /pub\(super\) fn validate_external_url/);
  assert.doesNotMatch(production, /tauri::|std::process|Command::|fs::|reqwest|static |Mutex|pub fn/);
});

test('R12-09 keeps the complete frozen parser allowlist error order and returned spelling', async () => {
  const before = validator(frozen(entryPath));
  const after = validator(await source(policyPath));
  assert.equal(after, before.replace('fn validate_external_url', 'pub(super) fn validate_external_url'));
  assert.match(after, /"http" \| "https" \| "mailto" \| "tel" => Ok\(trimmed\.to_string\(\)\)/);
  assert.doesNotMatch(after, /parsed\.(?:as_str|to_string)\(/);
});

test('R12-09 preserves command and legacy tests after R12-10 extracts only the system opener', async () => {
  const before = frozen(entryPath);
  const expected = before
    .replace('use url::Url;', 'mod opener;\nmod validation;\n\nuse opener::open_platform_url;\nuse validation::validate_external_url;')
    .replace(`${validator(before)}\n\n`, '')
    .replace(before.slice(before.indexOf('#[cfg(target_os = \"windows\")]'), before.indexOf('#[tauri::command]')), '')
    + '\n#[cfg(test)]\n#[path = "../tests/external_link/command_validation.rs"]\nmod validation_command_tests;\n'
    + '\n#[cfg(all(test, target_os = \"linux\"))]\n#[path = \"../tests/external_link/opener.rs\"]\nmod opener_tests;\n';
  assert.equal(await source(entryPath), expected);
  assert.equal((before.match(/#\[test\]/g) || []).length, 4);
});

test('R12-09 adds eight real policy tests and two direct backend rejection tests', async () => {
  const [policy, commandTests] = await Promise.all([source(policyPath), source(commandTestPath)]);
  assert.equal((policy.match(/#\[test\]/g) || []).length, 8);
  assert.equal((commandTests.match(/#\[test\]/g) || []).length, 2);
  assert.match(commandTests, /use super::open_external_url;/);
  assert.match(commandTests, /open_external_url\(value\.into\(\)\)/);
  assert.doesNotMatch(`${policy}\n${commandTests}`, /#\[ignore\]|mock!|set_var|set_current_dir/);
  for (const value of ['javascript:alert(1)', 'file:///tmp/private.txt', 'https://[::1', 'https://example.com:invalid']) {
    assert.ok(commandTests.includes(value), `missing direct backend rejection: ${value}`);
  }
});

test('R12-09 does not move validation to the frontend or change dependencies', async () => {
  for (const path of ['src/platform/desktop/link-client.js', 'src/runtime/link-preview.js',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json', 'package-lock.json']) {
    assert.equal(await source(path), frozen(path), `unrelated contract changed: ${path}`);
  }
  const main = await source('src-tauri/src/main.rs');
  assert.equal((main.match(/external_link::open_external_url/g) || []).length, 1);
  const fixture = await source('src-tauri/tests/stage_12_security_compatibility.rs');
  assert.match(fixture, /include_str!\("\.\.\/src\/external_link\/validation\.rs"\)/);
  assert.match(fixture, /SOURCE_EXTERNAL_LINK_VALIDATION\.contains/);
});

test('R12-09 records one additional policy module with no state owner', async () => {
  const inventory = JSON.parse(await source('tests/architecture/fixtures/production-modules.json'));
  const records = inventory.modules.filter(row => row[0] === policyPath);
  assert.equal(records.length, 1);
  assert.equal(records[0][inventory.fields.indexOf('stateOwner')], 'none');
  assert.equal(records[0][inventory.fields.indexOf('lifecycle')], 'pure-call');
  assert.equal(inventory.modules.length, 442);
});

test('R12-09 coverage remains in the cumulative hard gates and R12-08 stays manual', async () => {
  const current = await source('.github/workflows/r12-14.yml');
  const previous = await source('.github/workflows/r12-08.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*(?:push|pull_request):/m);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify/);
  for (const text of ['external_link::validation::tests', 'test result: ok. 8 passed; 0 failed',
    'external_link::validation_command_tests', 'test result: ok. 2 passed; 0 failed',
    'local_file::command_tests', 'local_file::tree_limits::tests', 'stage_12_security_compatibility',
    'cargo clippy', '--locked --all-targets -- -D warnings', 'cargo check', 'npm test',
    'npm audit --audit-level=high', 'npm run verify:architecture', 'npm run test:browser:contract',
    'npm run test:browser', 'npm run build', 'git diff --exit-code',
    'git ls-files --others --exclude-standard', 'archiveTauriLinuxSchema',
    'tests/unit/platform/link-client.test.mjs']) {
    assert.ok(current.includes(text), `missing validation: ${text}`);
  }
  assert.ok(current.includes("process.env.RUNNER_TEMP + '/r12-14'"));
});
