import { assertCurrentValidation } from './support/current-rust-contracts.mjs';
import { assertOwner } from './support/current-rust-contracts.mjs';
import { assertProductionInventory } from './support/production-inventory.mjs';
import { readCurrentRustSources as readFile } from './support/current-rust-contracts.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import test from 'node:test';

const accepted = 'fecd05b27da67ac73abd2f4c63c5c27675ae46be';
const baseline = accepted;
const entryPath = 'src-tauri/src/web_fetch/mod.rs';
const clientPath = 'src-tauri/src/web_fetch/client.rs';
const responsePath = 'src-tauri/src/web_fetch/response.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path.replace(/\/(external_link|web_fetch|performance_log)\/mod\.rs$/, "/$1.rs")}`], { encoding: 'utf8' });






test('R12-12 preserves the request headers and client-builder settings to one private client owner', async () => {
  const client = await read(clientPath);
  assert.match(client, /fn browser_headers\(\) -> HeaderMap/);
  for (const code of [
    '.default_headers(browser_headers())',
    '.redirect(reqwest::redirect::Policy::none())',
    '.timeout(FETCH_TIMEOUT)',
    '.map_err(|err| format!("Failed to create HTTP client: {err}"))',
  ]) assert.ok(client.includes(code), `missing frozen client setting: ${code}`);
  assert.equal((client.match(/fn build_client/g) || []).length, 1);
  assert.match(client, /pub\(super\) fn build_client\(\) -> Result<reqwest::Client, String>/);
  assert.doesNotMatch(client.split('#[cfg(test)]')[0], /CONTENT_TYPE|\.text\(\)|FetchResponse|tauri::|serde|Url::parse/);
});

test('R12-12 command delegates transport and response handling to separate owners', async () => {
  const command = await read('src-tauri/src/web_fetch/command.rs');
  assert.match(command, /fetch_response\(&parsed\)\.await\?/);
  assert.match(command, /read_response\(parsed, response\)\.await/);
  assert.match(command, /crate::performance_log::measure_async/);
  assert.doesNotMatch(command, /Client::builder|Policy::limited|Duration::from_secs|fn browser_headers/);
});

test('R12-12 retains rustls and compression support with R13-S01 explicit bounded decoding', async () => {
  const cargo = await read('src-tauri/Cargo.toml');
  assert.match(cargo, /reqwest = \{ version = "0\.12", default-features = false, features = \["rustls-tls", "gzip", "brotli", "deflate", "json"\] \}/);
  const client = await read(clientPath);
  assert.doesNotMatch(client, /native_tls|default_tls/);
  for (const flag of ['no_gzip()', 'no_brotli()', 'no_deflate()', 'no_proxy()']) assert.ok(client.includes(flag));
  const fixture = await read('src-tauri/tests/stage_12_security_compatibility.rs');
  assert.match(fixture, /SOURCE_WEB_FETCH_CLIENT: &str = include_str!\("\.\.\/src\/web_fetch\/client\.rs"\)/);
  assert.match(fixture, /SOURCE_WEB_FETCH_CLIENT\.contains\("Policy::none\(\)"\)/);
  assert.match(fixture, /SOURCE_WEB_FETCH_CLIENT\.contains\("Duration::from_secs\(30\)"\)/);
  assert.match(fixture, /SOURCE_WEB_FETCH_RESPONSE\.contains\("\.get\(CONTENT_TYPE\)"\)/);
});

test('R12-12 verifies headers redirects timeout and gzip through the real locked reqwest path', async () => {
  const http = await read('src-tauri/tests/web_fetch/http_compatibility.rs');
  assert.ok((http.match(/#\[test\]/g) || []).length >= 16);
  for (const code of [
    'bounded_gzip_decompression_preserves_existing_text',
    'Content-Encoding: gzip', 'compressed hello 中文🙂', 'accept-encoding: ',
    'redirect_loops_still_fail_with_the_existing_request_error',
    'real_request_retains_the_thirty_second_timeout',
    'real_http_preserves_payload_unicode_and_browser_headers',
    'TcpListener::bind("127.0.0.1:0")', 'tauri::async_runtime::block_on(fetch_owned(value))',
  ]) assert.ok(http.includes(code), `missing real-client regression: ${code}`);
  assert.doesNotMatch(http, /#\[ignore\]|mock!|set_var\(|set_current_dir\(/);
});

test('R12-12 inventories the actual stateless client owner', async () => {
  await assertProductionInventory();
  await assertOwner('src-tauri/src/web_fetch/client.rs', 'none');
});

test('R12-12 remains cumulatively protected after R12-13 becomes the automatic Stage workflow', async () => {
  const previous = await read('.github/workflows/r12-11.yml');
  const original = frozen('.github/workflows/r12-11.yml');
  assert.equal(previous.replace(/^    if: \$\{\{ false \}\} # Retired: Windows-only validation policy, 2026-09-29\.\n/gm, ''), original.replace(/  push:\n[\s\S]*?(?=  workflow_dispatch:)/, ''));
  const current = await read('.github/workflows/r12-14.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r14-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git reset|git clean/);
  await assertCurrentValidation();
});

test('R12-12 acceptance and the historical R12-S01 handoff snapshot remain recorded', async () => {
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md');
  assert.match(stage, /- \[x\] 12\.11 Web Validation/);
  assert.match(stage, /- \[x\] 12\.12 Web Client/);
  assert.match(stage, /- \[x\] 12\.13 Web Response/);
  assert.match(stage, /- \[x\] 12\.14 Log Redaction/);
  assert.match(stage, /- \[ \] R12-S01/);
  assert.match(stage, /R12-12/);
  const detail = await read('docs/R12-12-DETAILS.md');
  for (const text of ['rustls-tls', 'gzip', 'brotli', 'deflate', '30 秒', '10 次', 'R12-S01']) assert.ok(detail.includes(text));
});
