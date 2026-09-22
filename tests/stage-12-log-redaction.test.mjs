import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const baseline = '3692eb913473a8be3a45f326f5d93656d6cf1fb2';
const entryPath = 'src-tauri/src/performance_log.rs';
const redactionPath = 'src-tauri/src/performance_log/redaction.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });

function expectedPerformanceLogAfterRedaction(text) {
  return text
    .replace('use serde_json::{json, Value};\n',
      'mod redaction;\n\nuse redaction::redact_value;\nuse serde_json::{json, Value};\n')
    .replace(
      '    for value in values {\n        let line = serde_json::to_string(value).map_err(|err| format!("性能日志序列化失败：{err}"))?;\n',
      '    for value in values {\n        let redacted = redact_value(value);\n        let line = serde_json::to_string(&redacted).map_err(|err| format!("性能日志序列化失败：{err}"))?;\n'
    );
}

test('R12-14 adds one recursive redaction owner at the existing JSONL persistence boundary', async () => {
  assert.equal(await read(entryPath), expectedPerformanceLogAfterRedaction(frozen(entryPath)));
  const entry = await read(entryPath);
  const redaction = await read(redactionPath);
  assert.match(entry, /^mod redaction;/m);
  assert.match(entry, /let redacted = redact_value\(value\);/);
  assert.match(entry, /serde_json::to_string\(&redacted\)/);
  assert.equal((redaction.match(/#\[test\]/g) || []).length, 6);
  assert.doesNotMatch(redaction.split('#[cfg(test)]')[0], /std::fs|OpenOptions|env::|tauri::|Mutex|OnceLock|write_performance_logs/);
});

test('R12-14 recursively removes bodies and secrets while minimizing path fields without erasing metrics', async () => {
  const source = await read(redactionPath);
  for (const marker of [
    'is_body_field', 'is_sensitive_field', 'is_path_field', 'redact_path_value', 'redact_value',
    '"body"', '"content"', '"html"', '"markdown"', '"text"',
    '"password"', '"passphrase"', '"secret"', '"token"', '"authorization"', '"cookie"', '"apikey"',
    '"credential"', '"privatekey"', 'terminal_path_component'
  ]) assert.ok(source.includes(marker), `missing redaction marker: ${marker}`);
  for (const metric of ['contentType', 'contentLength', 'textLength', 'bodyBytes', 'sourceLength', 'hasDocumentPath']) {
    assert.ok(source.includes(metric), `missing metric preservation fixture: ${metric}`);
  }
});

test('R12-14 preserves the historical no-redaction manifest and frontend payload/adapter bytes', async () => {
  const manifest = JSON.parse(await read('src-tauri/tests/fixtures/stage_12_security/manifest.json'));
  assert.equal(manifest.performanceLog.commandRedaction, 'none');
  assert.equal(await read('src-tauri/tests/fixtures/stage_12_security/manifest.json'),
    frozen('src-tauri/tests/fixtures/stage_12_security/manifest.json'));
  assert.equal(await read('src/runtime/performance.js'), frozen('src/runtime/performance.js'));
  assert.equal(await read('src/platform/desktop/performance-log-client.js'),
    frozen('src/platform/desktop/performance-log-client.js'));
  assert.equal(await read('src-tauri/Cargo.toml'), frozen('src-tauri/Cargo.toml'));
  assert.equal(await read('src-tauri/Cargo.lock'), frozen('src-tauri/Cargo.lock'));
});

test('R12-14 adds exactly one pure redaction module and changes no unrelated inventory authority', async () => {
  const path = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(path));
  const after = JSON.parse(await read(path));
  assert.equal(before.modules.length, 441);
  assert.equal(after.modules.length, 442);
  assert.deepEqual(after.fields, before.fields);
  for (const row of before.modules) {
    assert.deepEqual(after.modules.find(next => next[0] === row[0]), row, `inventory drift: ${row[0]}`);
  }
  assert.deepEqual(after.modules.at(-1), [redactionPath, 'rust-module', 'telemetry',
    'Pure recursive performance-log redaction for body payloads, sensitive fields and full paths before persistence.',
    'none', 'pure-call', 'retain', false]);
});

test('R12-14 makes R12-13 historical and owns the cumulative validation without weakening gates', async () => {
  const previous = await read('.github/workflows/r12-13.yml');
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
  const current = await read('.github/workflows/r12-14.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git reset|git clean/);
  for (const marker of [
    'tests/stage-12-log-redaction.test.mjs', 'src-tauri/src/performance_log/redaction.rs',
    'R12-14 direct recursive redaction 6 of 6', 'performance_log::redaction::tests',
    'test result: ok. 6 passed; 0 failed', 'R12-13 pre-split real HTTP response behavior 9 of 9',
    'cargo clippy', '--all-targets -- -D warnings', 'cargo check', 'npm test',
    'npm audit --audit-level=high', 'npm run verify:architecture',
    'npm run test:browser:contract', 'npm run test:browser', 'npm run build',
    'git diff --exit-code', 'git ls-files --others --exclude-standard',
    'os: [windows-latest, macos-latest]'
  ]) assert.ok(current.includes(marker), `missing R12-14 gate: ${marker}`);
});

test('R12-14 documentation records implementation while keeping later atomic tasks and R12-S01 pending', async () => {
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md');
  assert.match(stage, /- \[x\] 12\.13 Web Response/);
  assert.match(stage, /- \[ \] 12\.14 Log Redaction/);
  assert.match(stage, /- \[ \] 12\.15 Log Paths\/Writer/);
  assert.match(stage, /- \[ \] R12-S01/);
  const detail = await read('docs/R12-14-DETAILS.md');
  for (const marker of ['递归', '正文', '敏感字段', '完整路径', 'commandRedaction', '3692eb913473a8be3a45f326f5d93656d6cf1fb2']) {
    assert.ok(detail.includes(marker), `missing R12-14 detail: ${marker}`);
  }
});
