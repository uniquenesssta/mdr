import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const accepted = 'fecd05b27da67ac73abd2f4c63c5c27675ae46be';
const baseline = accepted;
const entryPath = 'src-tauri/src/web_fetch.rs';
const clientPath = 'src-tauri/src/web_fetch/client.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });

function headersFunction(text) {
  const match = text.match(/^(?:pub\(super\) )?fn browser_headers\b[\s\S]*?^}/m);
  assert.ok(match, 'browser_headers must exist exactly once');
  return match[0];
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

test('R12-12 leaves response command telemetry and validation behavior byte-stable around the extracted client', async () => {
  const before = frozen(entryPath);
  let expected = before
    .replace('use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, USER_AGENT};\n', 'use reqwest::header::CONTENT_TYPE;\n')
    .replace('use std::time::Duration;\nmod validation;\n', 'mod client;\nmod validation;\n')
    .replace('use validation::normalize_url;\n', 'use client::build_client;\nuse validation::normalize_url;\n')
    .replace(`${headersFunction(before)}\n\n`, '')
    .replace(`${clientBuilderBlock(before)}\n`, '    let client = build_client()?;\n')
    .replace(
      '    crate::performance_log::measure_async(\n        "native.command",\n        "fetch_url",\n        details,\n        fetch_url_inner(url),\n    )\n    .await\n',
      '    crate::performance_log::measure_async("native.command", "fetch_url", details, fetch_url_inner(url)).await\n'
    )
    .replace('use super::{browser_headers, normalize_url};', 'use super::{client::browser_headers, normalize_url};');
  assert.equal(await read(entryPath), expected);
  const entry = await read(entryPath);
  assert.doesNotMatch(entry, /Client::builder|Policy::limited\(10\)|Duration::from_secs\(30\)|fn browser_headers/);
  for (const code of ['response.status()', 'response.url().to_string()', '.get(CONTENT_TYPE)', '.text()',
    'HTTP request failed with status', 'Failed to read response body:', 'Response body is empty',
    'crate::performance_log::measure_async', '#[tauri::command]']) assert.ok(entry.includes(code), `response/command drift: ${code}`);
});

test('R12-12 freezes reqwest rustls and automatic compression feature selection without dependency changes', async () => {
  assert.equal(await read('src-tauri/Cargo.toml'), frozen('src-tauri/Cargo.toml'));
  assert.equal(await read('src-tauri/Cargo.lock'), frozen('src-tauri/Cargo.lock'));
  const cargo = await read('src-tauri/Cargo.toml');
  assert.match(cargo, /reqwest = \{ version = "0\.12", default-features = false, features = \["rustls-tls", "gzip", "brotli", "deflate", "json"\] \}/);
  const client = await read(clientPath);
  assert.doesNotMatch(client, /native_tls|default_tls|no_gzip|no_brotli|no_deflate|\.gzip\(false\)|\.brotli\(false\)|\.deflate\(false\)/);
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

test('R12-12 adds exactly one stateless client owner and preserves every other inventory record', async () => {
  const path = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(path));
  const after = JSON.parse(await read(path));
  assert.equal(after.modules.length, 440);
  assert.equal(after.modules.length, before.modules.length + 1);
  assert.deepEqual(after.fields, before.fields);
  for (const row of before.modules) {
    const expected = row[0] === entryPath ? row.map((field, index) => index === 3
      ? 'HTTP fetch orchestration, existing response handling and command telemetry; delegates input and client policy.' : field) : row;
    assert.deepEqual(after.modules.find(next => next[0] === row[0]), expected, `inventory drift: ${row[0]}`);
  }
  assert.deepEqual(after.modules.at(-1), [clientPath, 'rust-module', 'desktop-platform',
    'Stateless reqwest client construction with frozen browser headers, redirect limit and timeout over Cargo-selected rustls/compression features.',
    'none', 'per-call-client-builder', 'retain', false]);
});

test('R12-12 makes R12-11 manual and owns the only automatic cumulative Stage workflow', async () => {
  const previous = await read('.github/workflows/r12-11.yml');
  const original = frozen('.github/workflows/r12-11.yml');
  assert.equal(previous, original.replace(/  push:\n[\s\S]*?(?=  workflow_dispatch:)/, ''));
  const current = await read('.github/workflows/r12-12.yml');
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

test('R12-12 documentation closes 12.11 while leaving 12.12 and R12-S01 pending until acceptance', async () => {
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md');
  assert.match(stage, /- \[x\] 12\.11 Web Validation/);
  assert.match(stage, /- \[ \] 12\.12 Web Client/);
  assert.match(stage, /- \[ \] R12-S01/);
  assert.match(stage, /R12-12/);
  const detail = await read('docs/R12-12-DETAILS.md');
  for (const text of ['rustls-tls', 'gzip', 'brotli', 'deflate', '30 秒', '10 次', 'R12-S01']) assert.ok(detail.includes(text));
});
