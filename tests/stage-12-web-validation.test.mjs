import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const baseline = '3f1233585dd5359fe2a7168be8206074b30627ec';
const entryPath = 'src-tauri/src/web_fetch.rs';
const policyPath = 'src-tauri/src/web_fetch/validation.rs';
const clientPath = 'src-tauri/src/web_fetch/client.rs';
const responsePath = 'src-tauri/src/web_fetch/response.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });

function expectedSecurityFixtureAfterLaterExtractions(text) {
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
const hook = '\n#[cfg(test)]\n#[path = "../tests/web_fetch/validation.rs"]\nmod validation_tests;\n\n#[cfg(test)]\n#[path = "../tests/web_fetch/http_compatibility.rs"]\nmod http_compatibility_tests;\n';
function normalizer(text) {
  const match = text.match(/^(?:pub\(super\) )?fn normalize_url\b[\s\S]*?^}/m);
  assert.ok(match, 'one explicit normalizer is required');
  return match[0];
}

test('R12-11 has one private pure input policy with the exact legacy function body', async () => {
  const policy = await read(policyPath);
  assert.equal(normalizer(policy), normalizer(frozen(entryPath)).replace('fn normalize_url', 'pub(super) fn normalize_url'));
  assert.equal((policy.match(/fn normalize_url/g) || []).length, 1);
  assert.match(policy, /^use url::Url;/m);
  assert.doesNotMatch(policy, /tauri::|reqwest::|std::fs|std::process|static |Mutex|pub fn/);
  assert.deepEqual(await readdir('src-tauri/src/web_fetch'), ['client.rs', 'response.rs', 'validation.rs']);
});

test('R12-11 URL behavior and command telemetry remain unchanged after later client and response extractions', async () => {
  const before = frozen(entryPath);
  const after = await read(entryPath);
  for (const name of ['stage_12_preserves_url_normalization_and_scheme_policy', 'stage_12_preserves_browser_request_headers']) {
    const fn = text => {
      const match = text.match(new RegExp(`fn ${name}\\(\\) \\{[\\s\\S]*?^    \\}`, 'm'));
      assert.ok(match, `missing legacy test: ${name}`);
      return match[0];
    };
    assert.equal(fn(after), fn(before));
  }
  assert.match(after, /let response = client[\s\S]*?\.map_err\(\|err\| format!\("Request failed: \{err\}"\)\)\?;/);
  assert.match(after, /read_response\(parsed, response\)\.await/);
  assert.match(after, /crate::performance_log::measure_async/);
  assert.match(after, /#\[tauri::command\]/);
  assert.doesNotMatch(after, /CONTENT_TYPE|response\.status\(\)|response\.url\(\)|\.text\(\)|Response body is empty/);
});

test('R12-11 preserves frontend registry dependency and frozen security fixture bytes', async () => {
  for (const path of ['src/platform/desktop/web-fetch-client.js', 'src/platform/desktop/desktop-platform.js',
    'public/app/web-clipper.js', 'src-tauri/src/main.rs',
    'src-tauri/src/external_link.rs', 'src-tauri/src/external_link/validation.rs', 'src-tauri/src/external_link/opener.rs',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json', 'package-lock.json',
    'src-tauri/tests/fixtures/stage_12_security/manifest.json']) {
    assert.equal(await read(path), frozen(path), `protected boundary changed: ${path}`);
  }
  const performanceBefore = frozen('src-tauri/src/performance_log.rs');
  const expectedPerformance = performanceBefore
    .replace('use serde_json::{json, Value};\n',
      'mod redaction;\n\nuse redaction::redact_value;\nuse serde_json::{json, Value};\n')
    .replace(
      '    for value in values {\n        let line = serde_json::to_string(value).map_err(|err| format!("性能日志序列化失败：{err}"))?;\n',
      '    for value in values {\n        let redacted = redact_value(value);\n        let line = serde_json::to_string(&redacted).map_err(|err| format!("性能日志序列化失败：{err}"))?;\n'
    );
  assert.equal(await read('src-tauri/src/performance_log.rs'), expectedPerformance,
    'performance log changed beyond the later R12-14 redaction handoff');
  assert.equal(
    await read('src-tauri/tests/stage_12_security_compatibility.rs'),
    expectedSecurityFixtureAfterLaterExtractions(frozen('src-tauri/tests/stage_12_security_compatibility.rs')),
    'R12-11 fixture changed beyond the later R12-12 client ownership migration'
  );
});

test('R12-11 explicitly preserves unbounded reported-only response policy without claiming hardening', async () => {
  const manifest = JSON.parse(await read('src-tauri/tests/fixtures/stage_12_security/manifest.json'));
  assert.equal(manifest.webFetch.responseBody.maximumBytes, null);
  assert.equal(manifest.webFetch.contentType.policy, 'reported-only-no-allowlist');
  const entry = await read(entryPath);
  const client = await read(clientPath);
  const response = await read(responsePath);
  const combined = `${entry}\n${client}\n${response}`;
  for (const code of ['Policy::limited(10)', 'Duration::from_secs(30)', '.get(CONTENT_TYPE)', '.text()',
    'if !status.is_success()', 'if html.trim().is_empty()']) assert.ok(combined.includes(code), `missing preserved policy: ${code}`);
  assert.doesNotMatch(combined, /MAX_RESPONSE_BYTES|content_length\(|\.chunk\(|Policy::custom/);
});

test('R12-11 adds eight URL and eight actual loopback HTTP tests with owned cleanup', async () => {
  const unit = await read('src-tauri/tests/web_fetch/validation.rs');
  const http = await read('src-tauri/tests/web_fetch/http_compatibility.rs');
  assert.equal((unit.match(/#\[test\]/g) || []).length, 8);
  assert.ok((http.match(/#\[test\]/g) || []).length >= 8);
  assert.match(unit, /use super::normalize_url;/);
  for (const code of ['TcpListener::bind("127.0.0.1:0")', 'tauri::async_runtime::block_on(fetch_url(value))',
    'impl Drop for Server', '.join()', 'set_read_timeout', 'set_write_timeout',
    'real_request_retains_the_thirty_second_timeout', 'missing_and_non_html_types_still_report_without_filtering',
    'redirects_keep_initial_and_final_url_and_final_reported_type', 'backend_rejects_invalid_inputs_before_any_http_request']) {
    assert.ok(http.includes(code), `missing real chain coverage: ${code}`);
  }
  assert.doesNotMatch(unit + http, /#\[ignore\]|mock!|set_var\(|set_current_dir\(/);
});

test('R12-11 keeps exactly one pure policy owner after later client and response extractions', async () => {
  const path = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(path));
  const after = JSON.parse(await read(path));
  assert.equal(after.modules.length, 442);
  assert.deepEqual(after.fields, before.fields);
  const r12_11 = after.modules
    .filter(row => ![clientPath, responsePath, 'src-tauri/src/performance_log/redaction.rs'].includes(row[0]))
    .map(row => row[0] === entryPath
      ? row.map((field, index) => index === 3
        ? 'HTTP fetch orchestration, existing client/response handling and command telemetry; delegates input policy.' : field)
      : row);
  assert.equal(r12_11.length, before.modules.length + 1);
  for (const row of before.modules) {
    const expected = row[0] === entryPath ? row.map((field, index) => index === 3
      ? 'HTTP fetch orchestration, existing client/response handling and command telemetry; delegates input policy.' : field) : row;
    assert.deepEqual(r12_11.find(next => next[0] === row[0]), expected);
  }
  assert.deepEqual(r12_11.at(-1), [policyPath, 'rust-module', 'desktop-platform',
    'Web-fetch input normalization and parsed HTTP/HTTPS scheme validation with unchanged legacy behavior.',
    'none', 'pure-call', 'retain', false]);
});

test('R12-11 remains manually runnable while R12-12 carries its cumulative hard gates', async () => {
  const previous = await read('.github/workflows/r12-11.yml');
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*(?:push|pull_request):/m);
  const current = await read('.github/workflows/r12-14.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s+NO_PROXY: 127\.0\.0\.1,localhost$/m);
  assert.doesNotMatch(current, /^\s+no_proxy:/m, 'GitHub rejects case-insensitive duplicate mapping keys');
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git reset|git clean/);
  for (const code of [
    'web_fetch::validation_tests', 'web_fetch::http_compatibility_tests',
    'tests/unit/platform/web-fetch-client.test.mjs',
    'external_link::opener_tests', 'local_file::command_tests', 'stage_12_security_compatibility',
    'cargo clippy', '--all-targets -- -D warnings', 'cargo check', 'npm test',
    'npm audit --audit-level=high', 'npm run verify:architecture', 'npm run test:browser', 'npm run build',
    'git diff --exit-code', 'git ls-files --others --exclude-standard', 'os: [windows-latest, macos-latest]'
  ]) assert.ok(current.includes(code), `missing cumulative gate: ${code}`);
});

test('R12-11 documents user-approved equivalent extraction separately from pending R12-S01', async () => {
  const dir = 'docs/markdown-main-full-rewrite-taskbook-18-docs/';
  const paths = await readdir(dir);
  const stage = await read(dir + paths.find(path => path.startsWith('13-')));
  const main = await read(dir + paths.find(path => path.startsWith('01-')));
  assert.match(stage, /用户确认/);
  assert.match(stage, /12\.11 Web Validation（等价拆分）/);
  assert.match(stage, /R12-S01 Web Fetch Hardening/);
  assert.match(stage, /- \[ \] R12-S01/);
  for (const value of ['响应体大小上限', '内容类型', '重定向', '策略确认']) assert.ok(stage.includes(value));
  assert.ok(main.includes('R12-S01'));
  assert.match(await read('docs/R12-11-DETAILS.md'), /R12-S01/);
});
