import { assertCurrentValidation, assertOwner } from './support/current-rust-contracts.mjs';
import { assertProductionInventory } from './support/production-inventory.mjs';
import { readCurrentRustSources as readFile } from './support/current-rust-contracts.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import test from 'node:test';

const baseline = '3692eb913473a8be3a45f326f5d93656d6cf1fb2';
const entryPath = 'src-tauri/src/performance_log/mod.rs';
const redactionPath = 'src-tauri/src/performance_log/redaction.rs';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path.replace(/\/(external_link|web_fetch|performance_log)\/mod\.rs$/, "/$1.rs")}`], { encoding: 'utf8' });

test('R12-14 adds one recursive redaction owner at the existing JSONL persistence boundary', async () => {
  const entry = await read(entryPath);
  const redaction = await read(redactionPath);
  const writer = await read('src-tauri/src/performance_log/writer.rs');
  assert.match(entry, /^mod redaction;/m);
  assert.match(writer, /let redacted = redact_value\(value\);/);
  assert.match(writer, /serde_json::to_string\(&redacted\)/);
  assert.equal((redaction.match(/#\[test\]/g) || []).length, 14);
  assert.doesNotMatch(redaction.split('#[cfg(test)]')[0], /std::fs|OpenOptions|env::|tauri::|Mutex|OnceLock|\bwrite_performance_logs\s*\(/);
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

test('R12-14 preserves historical evidence and structured runtime details while the runtime keeps nested structures', async () => {
  const manifest = JSON.parse(await read('src-tauri/tests/fixtures/stage_12_security/manifest.json'));
  assert.equal(manifest.performanceLog.commandRedaction, 'none');
  assert.equal(await read('src-tauri/tests/fixtures/stage_12_security/manifest.json'),
    frozen('src-tauri/tests/fixtures/stage_12_security/manifest.json'));
  const runtime = await read('src/runtime/performance.js');
  assert.doesNotMatch(runtime.slice(runtime.indexOf('function safeDetails'), runtime.indexOf('function makeEntry')), /JSON\.stringify/);
  assert.match(runtime, /new WeakSet/);
  assert.match(runtime, /remaining = 512/);
  await assertCurrentValidation();
});

test('R12-14 inventories one pure redaction owner', async () => {
  await assertProductionInventory();
  await assertOwner('src-tauri/src/performance_log/redaction.rs', 'none');
});

test('R12-14 makes R12-13 historical and owns the cumulative validation without weakening gates', async () => {
  const previous = await read('.github/workflows/r12-13.yml');
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
  const current = await read('.github/workflows/r12-14.yml');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r14-stage\]/);
  assert.doesNotMatch(current, /continue-on-error|\|\| true|--no-verify|git reset|git clean/);
  await assertCurrentValidation();
});

test('R12-14 implementation and the historical R12-S01 handoff snapshot remain recorded', async () => {
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md');
  assert.match(stage, /- \[x\] 12\.13 Web Response/);
  assert.match(stage, /- \[x\] 12\.14 Log Redaction/);
  assert.match(stage, /- \[x\] 12\.16 Lifecycle/);
  assert.match(stage, /- \[ \] R12-S01/);
  const detail = await read('docs/R12-14-DETAILS.md');
  for (const marker of ['递归', '正文', '敏感字段', '完整路径', 'commandRedaction', '3692eb913473a8be3a45f326f5d93656d6cf1fb2']) {
    assert.ok(detail.includes(marker), `missing R12-14 detail: ${marker}`);
  }
});


test('R12-14 shell command starts Cargo with only the intended arguments and keeps the result gate', async () => {
  const workflow = await read('.github/workflows/r12-14.yml');
  const step = workflow.match(/^      - name: R12-14 direct recursive redaction 14 of 14\n(?:        if: [^\n]+\n)?        run: \|\n([\s\S]*?)(?=^      - name:)/m);
  assert.ok(step, 'missing direct redaction test step');
  const commands = step[1].replace(/\\\r?\n[ \t]*/g, ' ')
    .trim().split('\n').map(line => line.trim()).filter(Boolean);
  assert.deepEqual(commands, [
    'cargo test --manifest-path src-tauri/Cargo.toml --locked --bin markdown-editor performance_log::redaction::tests 2>&1 | tee "$RUNNER_TEMP/r12-14/log-redaction.log"',
    "grep -Fq 'test result: ok. 14 passed; 0 failed' \"$RUNNER_TEMP/r12-14/log-redaction.log\""
  ]);
});

test('R12-14 production log changes trigger validation and its scope gate runs the redaction contracts', async () => {
  const workflow = await read('.github/workflows/r12-14.yml');
  const triggers = workflow.split('  workflow_dispatch:')[0];
  for (const path of ['src-tauri/**', 'src-tauri/src/performance_log/**']) {
    assert.ok(triggers.includes(`      - '${path}'`), `unwatched production path: ${path}`);
  }
  await assertCurrentValidation();
});

