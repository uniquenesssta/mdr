import { assertCurrentValidation } from './support/current-rust-contracts.mjs';
import { assertProductionInventory } from './support/production-inventory.mjs';
import { readCurrentRustSources as readFile } from './support/current-rust-contracts.mjs';
import assert from 'node:assert/strict';

import test from 'node:test';

const entryPath = 'src-tauri/src/external_link/mod.rs';
const policyPath = 'src-tauri/src/external_link/validation.rs';
const commandTestPath = 'src-tauri/tests/external_link/command_validation.rs';
const source = path => readFile(path, 'utf8');
function validator(text) {
  const match = text.match(/^(?:pub\(super\) )?fn validate_external_url\b[\s\S]*?^}/m);
  assert.ok(match, 'a single explicit URL validator must exist');
  return match[0];
}

test('R12-09 creates one private pure URL-validation authority', async () => {
  const [entry, policy] = await Promise.all([source(entryPath), source(policyPath)]);
  const production = policy.split('#[cfg(test)]')[0];
  assert.match(entry, /^mod validation;/m);
  assert.match(entry, /use super::validation::validate_external_url;/);
  assert.doesNotMatch(entry, /fn validate_external_url|Url::parse|use url::Url|parsed\.scheme/);
  assert.equal((production.match(/fn validate_external_url/g) || []).length, 1);
  assert.match(production, /pub\(super\) fn validate_external_url/);
  assert.doesNotMatch(production, /tauri::|std::process|Command::|fs::|reqwest|static |Mutex|pub fn/);
});

test('R12-09 preserves allowlist and returned spelling with real rejection coverage', async () => {
  const after = await source(policyPath);
  assert.match(after, /"http" \| "https" \| "mailto" \| "tel" => Ok\(trimmed\.to_string\(\)\)/);
  assert.doesNotMatch(after, /parsed\.(?:as_str|to_string)\(/);
  await assertCurrentValidation();
});

test('R12-09 command validates before reaching the native opener', async () => {
  const command = await source('src-tauri/src/external_link/command.rs');
  assert.match(command, /let validated = validate_external_url\(&url\)\?;\s*open_platform_url\(&validated\)/);
  assert.match(command, /pub fn open_external_url\(url: String\) -> Result<\(\), String>/);
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

test('R12-09 registers one backend validator command and keeps the independent fixture', async () => {
  const main = await source('src-tauri/src/main.rs');
  assert.equal((main.match(/external_link::command::open_external_url/g) || []).length, 1);
  const fixture = await source('src-tauri/tests/stage_12_security_compatibility.rs');
  assert.match(fixture, /SOURCE_EXTERNAL_LINK_VALIDATION\.contains/);
  await assertCurrentValidation();
});

test('R12-09 records one additional policy module with no state owner', async () => {
  const inventory = JSON.parse(await source('tests/architecture/fixtures/production-modules.json'));
  const records = inventory.modules.filter(row => row[0] === policyPath);
  assert.equal(records.length, 1);
  assert.equal(records[0][inventory.fields.indexOf('stateOwner')], 'none');
  assert.equal(records[0][inventory.fields.indexOf('lifecycle')], 'pure-call');
  await assertProductionInventory();
});

test('R12-09 coverage remains in the cumulative hard gates and R12-08 stays manual', async () => {
  const current = await source('.github/workflows/r12-14.yml');
  const previous = await source('.github/workflows/r12-08.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r14-stage\]/);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*(?:push|pull_request):/m);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify/);
  for (const text of ['external_link::validation::tests', 'test result: ok. 8 passed; 0 failed',
    'external_link::validation_command_tests', 'test result: ok. 2 passed; 0 failed',
    'local_file::command_tests', 'local_file::tree_limits::tests', 'stage_12_security_compatibility',
    'cargo clippy', '--locked --all-targets -- -D warnings', 'cargo check', 'npm test',
    'npm audit --audit-level=high', 'npm run verify:architecture', 'npm run test:browser:contract',
    'npm run test:browser', 'npm run build', 'git diff --exit-code',
    'git ls-files --others --exclude-standard',
    'tests/unit/platform/link-client.test.mjs']) {
    assert.ok(current.includes(text), `missing validation: ${text}`);
  }
  assert.match(current, /runs-on: windows-latest/);
});
