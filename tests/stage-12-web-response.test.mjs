import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const baseline = '9b6d6369fce3f2b36a33cdd12dd28c4d0460d927';
const entryPath = 'src-tauri/src/web_fetch.rs';
const responsePath = 'src-tauri/src/web_fetch/response.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });

function dtoBlock(text) {
  const match = text.match(/#\[derive\(Debug, Serialize\)\]\npub struct FetchResponse \{[\s\S]*?\n\}/);
  assert.ok(match, 'FetchResponse DTO must exist exactly once');
  return match[0];
}

function responseBlock(text) {
  const start = text.indexOf('    let status = response.status();');
  assert.notEqual(start, -1, 'response handling must start at status extraction');
  const end = text.indexOf('\n}', start);
  assert.notEqual(end, -1, 'response handling must end at function boundary');
  return text.slice(start, end);
}

function expectedSecurityFixtureAfterResponseExtraction(text) {
  return text
    .replace(
      'const SOURCE_WEB_FETCH_CLIENT: &str = include_str!("../src/web_fetch/client.rs");',
      'const SOURCE_WEB_FETCH_CLIENT: &str = include_str!("../src/web_fetch/client.rs");\nconst SOURCE_WEB_FETCH_RESPONSE: &str = include_str!("../src/web_fetch/response.rs");'
    )
    .replace('assert!(SOURCE_WEB_FETCH.contains(".get(CONTENT_TYPE)"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains(".get(CONTENT_TYPE)"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains(".text()"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains(".text()"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains("if !status.is_success()"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains("if !status.is_success()"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains("if html.trim().is_empty()"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains("if html.trim().is_empty()"));')
    .replace('assert!(!SOURCE_WEB_FETCH_CLIENT.contains("MAX_RESPONSE_BYTES"));',
      'assert!(!SOURCE_WEB_FETCH_CLIENT.contains("MAX_RESPONSE_BYTES"));\n    assert!(!SOURCE_WEB_FETCH_RESPONSE.contains("MAX_RESPONSE_BYTES"));');
}

test('R12-13 moves the exact frozen response DTO and response semantics to one private response owner', async () => {
  const before = frozen(entryPath);
  const response = await read(responsePath);
  assert.equal(dtoBlock(response), dtoBlock(before));
  assert.equal(responseBlock(response), responseBlock(before));
  assert.match(response, /pub\(super\) async fn read_response\(parsed: Url, response: reqwest::Response\) -> Result<FetchResponse, String>/);
  for (const code of [
    'response.status()', 'response.url().to_string()', '.get(CONTENT_TYPE)', '.text()',
    'HTTP request failed with status', 'Failed to read response body:', 'Response body is empty'
  ]) assert.ok(response.includes(code), `missing frozen response behavior: ${code}`);
  assert.doesNotMatch(response, /build_client|normalize_url|#\[tauri::command\]|measure_async|Policy::limited|Duration::from_secs/);
  assert.doesNotMatch(response, /MAX_RESPONSE_BYTES|content_length\(|\.chunk\(|Policy::custom/);
});

test('R12-13 leaves request transport command telemetry and legacy tests byte-stable around response delegation', async () => {
  const before = frozen(entryPath);
  let expected = before
    .replace('use reqwest::header::CONTENT_TYPE;\n', '')
    .replace('use serde::Serialize;\n', '')
    .replace('mod client;\nmod validation;\n', 'mod client;\nmod response;\nmod validation;\n')
    .replace(
      'use client::build_client;\nuse validation::normalize_url;\n',
      'use client::build_client;\nuse response::read_response;\npub use response::FetchResponse;\nuse validation::normalize_url;\n'
    )
    .replace(`${dtoBlock(before)}\n\n`, '')
    .replace(responseBlock(before), '    read_response(parsed, response).await');
  assert.equal(await read(entryPath), expected);
  const entry = await read(entryPath);
  assert.match(entry, /let response = client[\s\S]*?\.map_err\(\|err\| format!\("Request failed: \{err\}"\)\)\?;/);
  assert.match(entry, /read_response\(parsed, response\)\.await/);
  assert.match(entry, /#\[tauri::command\]/);
  assert.match(entry, /performance_log::measure_async/);
  assert.doesNotMatch(entry, /CONTENT_TYPE|response\.status\(\)|response\.url\(\)|\.text\(\)|Response body is empty/);
});

test('R12-13 preserves the real nine-case HTTP characterization and all dependency choices', async () => {
  assert.equal(await read('src-tauri/tests/web_fetch/http_compatibility.rs'),
    frozen('src-tauri/tests/web_fetch/http_compatibility.rs'));
  assert.equal(await read('src-tauri/Cargo.toml'), frozen('src-tauri/Cargo.toml'));
  assert.equal(await read('src-tauri/Cargo.lock'), frozen('src-tauri/Cargo.lock'));
  const http = await read('src-tauri/tests/web_fetch/http_compatibility.rs');
  assert.equal((http.match(/#\[test\]/g) || []).length, 9);
  for (const code of [
    'missing_and_non_html_types_still_report_without_filtering',
    'status_empty_and_truncated_body_errors_keep_their_order_and_text',
    'redirects_keep_initial_and_final_url_and_final_reported_type',
    'automatic_gzip_decompression_remains_enabled_by_the_locked_reqwest_feature',
    'real_request_retains_the_thirty_second_timeout'
  ]) assert.ok(http.includes(code), `missing real response regression: ${code}`);
});

test('R12-13 transfers the independent security fixture to the response owner without changing policy', async () => {
  const fixturePath = 'src-tauri/tests/stage_12_security_compatibility.rs';
  assert.equal(await read(fixturePath), expectedSecurityFixtureAfterResponseExtraction(frozen(fixturePath)));
  const fixture = await read(fixturePath);
  assert.match(fixture, /SOURCE_WEB_FETCH_RESPONSE: &str = include_str!\("\.\.\/src\/web_fetch\/response\.rs"\)/);
  for (const code of [
    'SOURCE_WEB_FETCH_RESPONSE.contains(".get(CONTENT_TYPE)")',
    'SOURCE_WEB_FETCH_RESPONSE.contains(".text()")',
    'SOURCE_WEB_FETCH_RESPONSE.contains("if !status.is_success()")',
    'SOURCE_WEB_FETCH_RESPONSE.contains("if html.trim().is_empty()")'
  ]) assert.ok(fixture.includes(code), `response fixture ownership missing: ${code}`);
  assert.match(fixture, /!SOURCE_WEB_FETCH_RESPONSE\.contains\("MAX_RESPONSE_BYTES"\)/);
});

test('R12-13 adds exactly one stateless response owner and changes no other inventory authority', async () => {
  const path = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(path));
  const after = JSON.parse(await read(path));
  assert.equal(before.modules.length, 440);
  assert.equal(after.modules.length, 442);
  assert.deepEqual(after.fields, before.fields);
  const beforeR14 = after.modules.filter(row => row[0] !== 'src-tauri/src/performance_log/redaction.rs');
  assert.equal(beforeR14.length, 441);
  for (const row of before.modules) {
    const expected = row[0] === entryPath ? row.map((field, index) => index === 3
      ? 'HTTP fetch orchestration and command telemetry; delegates input, client and response handling.' : field) : row;
    assert.deepEqual(beforeR14.find(next => next[0] === row[0]), expected, `inventory drift: ${row[0]}`);
  }
  assert.deepEqual(beforeR14.at(-1), [responsePath, 'rust-module', 'desktop-platform',
    'Web-fetch response projection with frozen status, final URL, Content-Type, text body and error mapping.',
    'none', 'per-response', 'retain', false]);
});

test('R12-13 remains historical while R12-14 owns the automatic cumulative Stage workflow', async () => {
  const previous = await read('.github/workflows/r12-13.yml');
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
  const current = await read('.github/workflows/r12-14.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git reset|git clean/);
  for (const code of [
    'tests/stage-12-web-response.test.mjs', 'src-tauri/src/web_fetch/response.rs',
    'R12-13 pre-split real HTTP response behavior 9 of 9',
    'R12-13 extracted real HTTP response behavior 9 of 9',
    'git archive 9b6d6369fce3f2b36a33cdd12dd28c4d0460d927 | tar',
    'R12-12 pre-split real HTTP client behavior 9 of 9',
    'web_fetch::validation_tests', 'external_link::opener_tests', 'local_file::command_tests',
    'cargo clippy', '--all-targets -- -D warnings', 'cargo check', 'npm test',
    'npm audit --audit-level=high', 'npm run verify:architecture',
    'npm run test:browser:contract', 'npm run test:browser', 'npm run build',
    'git diff --exit-code', 'git ls-files --others --exclude-standard',
    'os: [windows-latest, macos-latest]'
  ]) assert.ok(current.includes(code), `missing R12-13 gate: ${code}`);
});

test('R12-13 documentation records acceptance while 12.14 and R12-S01 remain pending', async () => {
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md');
  assert.match(stage, /- \[x\] 12\.12 Web Client/);
  assert.match(stage, /- \[x\] 12\.13 Web Response/);
  assert.match(stage, /- \[ \] 12\.14 Log Redaction/);
  assert.match(stage, /- \[ \] R12-S01/);
  assert.match(stage, /R12-13/);
  const detail = await read('docs/R12-13-DETAILS.md');
  for (const text of ['状态码', 'Content-Type', '正文', 'R12-S01', '35756238550', '33744a848e1fdd26dfc91e22d2e87b12578ff9bd']) {
    assert.ok(detail.includes(text), `missing R12-13 detail: ${text}`);
  }
});
