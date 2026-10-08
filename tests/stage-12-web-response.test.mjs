import { assertCurrentValidation, assertOwner } from './support/current-rust-contracts.mjs';
import { assertProductionInventory } from './support/production-inventory.mjs';
import { readCurrentRustSources as readFile } from './support/current-rust-contracts.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import test from 'node:test';

const baseline = '9b6d6369fce3f2b36a33cdd12dd28c4d0460d927';
const entryPath = 'src-tauri/src/web_fetch/mod.rs';
const responsePath = 'src-tauri/src/web_fetch/response.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path.replace(/\/(external_link|web_fetch|performance_log)\/mod\.rs$/, "/$1.rs")}`], { encoding: 'utf8' });

function dtoBlock(text) {
  const match = text.match(/#\[derive\(Debug, Serialize\)\]\npub struct FetchResponse \{[\s\S]*?\n\}/);
  assert.ok(match, 'FetchResponse DTO must exist exactly once');
  return match[0];
}



test('R12-13 moves the exact frozen response DTO with approved R13-S01 response limits to one private response owner', async () => {
  const before = frozen(entryPath);
  const response = await read(responsePath);
  assert.equal(dtoBlock(response), dtoBlock(before));
  await assertCurrentValidation();
  assert.match(response, /pub\(super\) async fn read_response\(parsed: Url, mut response: reqwest::Response\) -> Result<FetchResponse, String>/);
  for (const code of [
    'response.status()', 'response.url().to_string()', '.get(CONTENT_TYPE)', '.chunk()',
    'HTTP request failed with status', 'Failed to read response body:', 'Response body is empty'
  ]) assert.ok(response.includes(code), `missing frozen response behavior: ${code}`);
  assert.doesNotMatch(response, /build_client|normalize_url|#\[tauri::command\]|measure_async|Policy::limited|Duration::from_secs/);
  assert.match(response, /MAX_ENCODED_BYTES: usize = 10 \* 1024 \* 1024/);
  assert.match(response, /MAX_DECODED_BYTES: usize = 20 \* 1024 \* 1024/);
});

test('R12-13 command propagates transport errors and delegates response projection', async () => {
  const command = await read('src-tauri/src/web_fetch/command.rs');
  assert.match(command, /let response = fetch_response\(&parsed\)\.await\?/);
  assert.match(command, /read_response\(parsed, response\)\.await/);
  assert.match(command, /performance_log::measure_async/);
  assert.doesNotMatch(command, /CONTENT_TYPE|response\.status\(\)|\.text\(\)/);
});

test('R12-13 retains the real HTTP response failure and gzip scenarios', async () => {
  const http = await read('src-tauri/tests/web_fetch/http_compatibility.rs');
  for (const name of ['missing_and_non_html_types_are_rejected_before_body_read', 'status_empty_and_truncated_body_errors_keep_their_order_and_text', 'redirects_keep_initial_and_final_url_and_final_reported_type', 'bounded_gzip_decompression_preserves_existing_text', 'real_request_retains_the_thirty_second_timeout']) assert.ok(http.includes(name), name);
  assert.doesNotMatch(http, /#\[ignore\]/);
  await assertCurrentValidation();
});

test('R12-13 independent fixture reads the current response owner', async () => {
  const fixture = await read('src-tauri/tests/stage_12_security_compatibility.rs');
  assert.match(fixture, /SOURCE_WEB_FETCH_RESPONSE: &str = include_str!\("\.\.\/src\/web_fetch\/response\.rs"\)/);
  await assertCurrentValidation();
});

test('R12-13 inventories the actual stateless response owner', async () => {
  await assertProductionInventory();
  await assertOwner('src-tauri/src/web_fetch/response.rs', 'none');
});

test('R12-13 remains historical while R12-14 owns the automatic cumulative Stage workflow', async () => {
  const previous = await read('.github/workflows/r12-13.yml');
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
  const current = await read('.github/workflows/r12-14.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r14-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git reset|git clean/);
  await assertCurrentValidation();
});

test('R12-13 acceptance and the historical R12-S01 handoff snapshot remain recorded', async () => {
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md');
  assert.match(stage, /- \[x\] 12\.12 Web Client/);
  assert.match(stage, /- \[x\] 12\.13 Web Response/);
  assert.match(stage, /- \[x\] 12\.14 Log Redaction/);
  assert.match(stage, /- \[ \] R12-S01/);
  assert.match(stage, /R12-13/);
  const detail = await read('docs/R12-13-DETAILS.md');
  for (const text of ['状态码', 'Content-Type', '正文', 'R12-S01', '35756238550', '33744a848e1fdd26dfc91e22d2e87b12578ff9bd']) {
    assert.ok(detail.includes(text), `missing R12-13 detail: ${text}`);
  }
});
