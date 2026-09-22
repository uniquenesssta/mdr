import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const accepted = 'fecd05b27da67ac73abd2f4c63c5c27675ae46be';
const baseline = accepted;
const entryPath = 'src-tauri/src/web_fetch.rs';
const clientPath = 'src-tauri/src/web_fetch/client.rs';
const responsePath = 'src-tauri/src/web_fetch/response.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });

function headersFunction(text) {
  const match = text.match(/^(?:pub\(super\) )?fn browser_headers\b[\s\S]*?^}/m);
  assert.ok(match, 'browser_headers must exist exactly once');
  return match[0];
}

function dtoBlock(text) {
  const match = text.match(/#\[derive\(Debug, Serialize\)\]\npub struct FetchResponse \{[\s\S]*?\n\}/);
  assert.ok(match, 'FetchResponse DTO must exist exactly once');
  return match[0];
}

function responseBlock(text) {
  const start = text.indexOf('    let status = response.status();');
  assert.notEqual(start, -1, 'response handling must exist');
  const end = text.indexOf('\n}', start);
  assert.notEqual(end, -1, 'response handling must end at function boundary');
  return text.slice(start, end);
}

function expectedSecurityFixtureAfterResponseExtraction(text) {
  return text
    .replace(
      'const SOURCE_WEB_FETCH: &str = include_str!("../src/web_fetch.rs");',
      'const SOURCE_WEB_FETCH: &str = include_str!("../src/web_fetch.rs");\nconst SOURCE_WEB_FETCH_CLIENT: &str = include_str!("../src/web_fetch/client.rs");\nconst SOURCE_WEB_FETCH_RESPONSE: &str = include_str!("../src/web_fetch/response.rs");'
    )
    .replace('assert!(SOURCE_WEB_FETCH.contains("Policy::limited(10)"));',
      'assert!(SOURCE_WEB_FETCH_CLIENT.contains("Policy::limited(10)"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains("Duration::from_secs(30)"));',
      'assert!(SOURCE_WEB_FETCH_CLIENT.contains("Duration::from_secs(30)"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains(".get(CONTENT_TYPE)"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains(".get(CONTENT_TYPE)"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains(".text()"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains(".text()"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains("if !status.is_success()"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains("if !status.is_success()"));')
    .replace('assert!(SOURCE_WEB_FETCH.contains("if html.trim().is_empty()"));',
      'assert!(SOURCE_WEB_FETCH_RESPONSE.contains("if html.trim().is_empty()"));')
    .replace('assert!(!SOURCE_WEB_FETCH.contains("MAX_RESPONSE_BYTES"));',
      'assert!(!SOURCE_WEB_FETCH.contains("MAX_RESPONSE_BYTES"));\n    assert!(!SOURCE_WEB_FETCH_CLIENT.contains("MAX_RESPONSE_BYTES"));\n    assert!(!SOURCE_WEB_FETCH_RESPONSE.contains("MAX_RESPONSE_BYTES"));');
}

function clientBuilderBlock(text) {
  const match = text.match(/    let client = reqwest::Client::builder\(\)[\s\S]*?format!\("Failed to create HTTP client: \{err\}"\)\)\?;/);
  assert.ok(match, 'legacy client builder block must exist');
  return match[0];
}

test('R12-12 moves the exact frozen headers and client-builder settings to one private client owner', async () => {
  const before = frozen(entryPath);
  const client = await read(clientPath);
  assert.equal(headersFunction(client), headersFunction(before).replace('fn browser_headers', 'pub(super) fn browser_headers'));
  for (const code of [
    '.default_headers(browser_headers())',
    '.redirect(reqwest::redirect::Policy::limited(10))',
    '.timeout(Duration::from_secs(30))',
    '.map_err(|err| format!("Failed to create HTTP client: {err}"))',
  ]) assert.ok(client.includes(code), `missing frozen client setting: ${code}`);
  assert.equal((client.match(/fn build_client/g) || []).length, 1);
  assert.match(client, /pub\(super\) fn build_client\(\) -> Result<reqwest::Client, String>/);
  assert.doesNotMatch(client.split('#[cfg(test)]')[0], /CONTENT_TYPE|\.text\(\)|FetchResponse|tauri::|serde|Url::parse/);
});

test('R12-12 client extraction remains byte-stable after the later R12-13 response ownership move', async () => {
  const before = frozen(entryPath);
  let expected = before
    .replace('use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, USER_AGENT};\n', '')
    .replace('use serde::Serialize;\n', '')
    .replace('use std::time::Duration;\nmod validation;\n', 'mod client;\nmod response;\nmod validation;\n')
    .replace('use validation::normalize_url;\n',
      'use client::build_client;\nuse response::read_response;\npub use response::FetchResponse;\nuse validation::normalize_url;\n')
    .replace(`${headersFunction(before)}\n\n`, '')
    .replace(`${clientBuilderBlock(before)}\n`, '    let client = build_client()?;\n')
    .replace(`${dtoBlock(before)}\n\n`, '')
    .replace(responseBlock(before), '    read_response(parsed, response).await')
    .replace(
      '    crate::performance_log::measure_async(\n        "native.command",\n        "fetch_url",\n        details,\n        fetch_url_inner(url),\n    )\n    .await\n',
      '    crate::performance_log::measure_async("native.command", "fetch_url", details, fetch_url_inner(url)).await\n'
    )
    .replace('use super::{browser_headers, normalize_url};',
      'use super::{client::browser_headers, normalize_url};');
  assert.equal(await read(entryPath), expected);
  const entry = await read(entryPath);
  const response = await read(responsePath);
  assert.doesNotMatch(entry, /Client::builder|Policy::limited\(10\)|Duration::from_secs\(30\)|fn browser_headers/);
  for (const code of ['response.status()', 'response.url().to_string()', '.get(CONTENT_TYPE)', '.text()',
    'HTTP request failed with status', 'Failed to read response body:', 'Response body is empty']) {
    assert.ok(response.includes(code), `response drift after R12-13: ${code}`);
  }
  assert.match(entry, /read_response\(parsed, response\)\.await/);
  assert.match(entry, /crate::performance_log::measure_async/);
  assert.match(entry, /#\[tauri::command\]/);
});

test('R12-12 freezes reqwest rustls and automatic compression feature selection without dependency changes', async () => {
  assert.equal(await read('src-tauri/Cargo.toml'), frozen('src-tauri/Cargo.toml'));
  assert.equal(await read('src-tauri/Cargo.lock'), frozen('src-tauri/Cargo.lock'));
  const cargo = await read('src-tauri/Cargo.toml');
  assert.match(cargo, /reqwest = \{ version = "0\.12", default-features = false, features = \["rustls-tls", "gzip", "brotli", "deflate", "json"\] \}/);
  const client = await read(clientPath);
  assert.doesNotMatch(client, /native_tls|default_tls|no_gzip|no_brotli|no_deflate|\.gzip\(false\)|\.brotli\(false\)|\.deflate\(false\)/);
  const fixture = await read('src-tauri/tests/stage_12_security_compatibility.rs');
  assert.match(fixture, /SOURCE_WEB_FETCH_CLIENT: &str = include_str!\("\.\.\/src\/web_fetch\/client\.rs"\)/);
  assert.match(fixture, /SOURCE_WEB_FETCH_CLIENT\.contains\("Policy::limited\(10\)"\)/);
  assert.match(fixture, /SOURCE_WEB_FETCH_CLIENT\.contains\("Duration::from_secs\(30\)"\)/);
  assert.match(fixture, /SOURCE_WEB_FETCH_RESPONSE\.contains\("\.get\(CONTENT_TYPE\)"\)/);
});

test('R12-12 verifies headers redirects timeout and gzip through the real locked reqwest path', async () => {
  const http = await read('src-tauri/tests/web_fetch/http_compatibility.rs');
  assert.equal((http.match(/#\[test\]/g) || []).length, 9);
  for (const code of [
    'automatic_gzip_decompression_remains_enabled_by_the_locked_reqwest_feature',
    'Content-Encoding: gzip', 'compressed hello 中文🙂', 'accept-encoding: ',
    'redirect_loops_still_fail_with_the_existing_request_error',
    'real_request_retains_the_thirty_second_timeout',
    'real_http_preserves_payload_unicode_and_browser_headers',
    'TcpListener::bind("127.0.0.1:0")', 'tauri::async_runtime::block_on(fetch_url(value))',
  ]) assert.ok(http.includes(code), `missing real-client regression: ${code}`);
  assert.doesNotMatch(http, /#\[ignore\]|mock!|set_var\(|set_current_dir\(/);
});

test('R12-12 keeps exactly one stateless client owner after the later response extraction', async () => {
  const path = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(path));
  const after = JSON.parse(await read(path));
  assert.equal(after.modules.length, 441);
  assert.deepEqual(after.fields, before.fields);
  const r12_12 = after.modules.filter(row => row[0] !== responsePath).map(row => row[0] === entryPath
    ? row.map((field, index) => index === 3
      ? 'HTTP fetch orchestration, existing response handling and command telemetry; delegates input and client policy.' : field)
    : row);
  assert.equal(r12_12.length, 440);
  for (const row of before.modules) {
    const expected = row[0] === entryPath ? row.map((field, index) => index === 3
      ? 'HTTP fetch orchestration, existing response handling and command telemetry; delegates input and client policy.' : field) : row;
    assert.deepEqual(r12_12.find(next => next[0] === row[0]), expected, `inventory drift: ${row[0]}`);
  }
  assert.deepEqual(r12_12.at(-1), [clientPath, 'rust-module', 'desktop-platform',
    'Stateless reqwest client construction with frozen browser headers, redirect limit and timeout over Cargo-selected rustls/compression features.',
    'none', 'per-call-client-builder', 'retain', false]);
});

test('R12-12 remains cumulatively protected after R12-13 becomes the automatic Stage workflow', async () => {
  const previous = await read('.github/workflows/r12-11.yml');
  const original = frozen('.github/workflows/r12-11.yml');
  assert.equal(previous, original.replace(/  push:\n[\s\S]*?(?=  workflow_dispatch:)/, ''));
  const current = await read('.github/workflows/r12-13.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git reset|git clean/);
  for (const code of [
    'tests/stage-12-web-client.test.mjs', 'src-tauri/src/web_fetch/client.rs',
    'web_fetch::client::tests', 'test result: ok. 2 passed; 0 failed',
    'R12-12 pre-split real HTTP client behavior 9 of 9', 'R12-12 extracted real HTTP client behavior 9 of 9',
    'test result: ok. 9 passed; 0 failed', `git archive ${accepted} | tar`,
    'web_fetch::validation_tests', 'external_link::opener_tests', 'local_file::command_tests',
    'cargo clippy', '--all-targets -- -D warnings', 'cargo check', 'npm test', 'npm audit --audit-level=high',
    'npm run verify:architecture', 'npm run test:browser:contract', 'npm run test:browser', 'npm run build',
    'git diff --exit-code', 'git ls-files --others --exclude-standard', 'os: [windows-latest, macos-latest]',
  ]) assert.ok(current.includes(code), `missing R12-12 gate: ${code}`);
});

test('R12-12 remains accepted after R12-13 while later work and R12-S01 stay pending', async () => {
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md');
  assert.match(stage, /- \[x\] 12\.11 Web Validation/);
  assert.match(stage, /- \[x\] 12\.12 Web Client/);
  assert.match(stage, /- \[x\] 12\.13 Web Response/);
  assert.match(stage, /- \[ \] 12\.14 Log Redaction/);
  assert.match(stage, /- \[ \] R12-S01/);
  assert.match(stage, /R12-12/);
  const detail = await read('docs/R12-12-DETAILS.md');
  for (const text of ['rustls-tls', 'gzip', 'brotli', 'deflate', '30 秒', '10 次', 'R12-S01']) assert.ok(detail.includes(text));
});
