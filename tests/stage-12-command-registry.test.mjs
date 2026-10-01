import { assertCurrentValidation, assertOwner, rustSignature } from './support/current-rust-contracts.mjs';
import { assertProductionInventory } from './support/production-inventory.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import { rustFunction } from './support/performance-log/storage-contract.mjs';

const baseline = 'd5c45f4774615be04177c89409e4b432869a4db3';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path.replace(/\/(external_link|web_fetch|performance_log)\/mod\.rs$/, "/$1.rs")}`], { encoding: 'utf8' });
const commands = [['external_link', 'open_external_url'], ['web_fetch', 'fetch_url'], ['performance_log', 'write_performance_logs']];
const registry = text => text.match(/tauri::generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(s => s.trim()).filter(Boolean);

test('R12-17 preserves all nineteen original commands plus the R13-S01 cancellation companion', async () => {
  const before = registry(frozen('src-tauri/src/main.rs'));
  const all = registry(await read('src-tauri/src/main.rs'));
  assert.equal(all.at(-1), 'web_fetch::command::cancel_fetch_url');
  assert.equal(new Set(all).size, 20);
  const after = all.slice(0, -1);
  assert.equal(before.length, 19);
  assert.deepEqual(after.map(p => p.split('::').at(-1)), before.map(p => p.split('::').at(-1)));
  assert.equal(new Set(after).size, 19);
  assert.deepEqual(after.map(p => p.replace('::command::', '::')), before);
});

test('R12-17 preserves command signatures payloads and asynchronous error propagation', async () => {
  for (const [module, name] of commands) {
    const before = frozen(`src-tauri/src/${module}.rs`);
    const after = await read(`src-tauri/src/${module}/command.rs`);
    if (module === 'web_fetch') {
      assert.match(after, /url: String/);
      assert.match(after, /request_id: Option<String>/);
      assert.match(after, /Result<FetchResponse, String>/);
      assert.equal((after.match(/#\[tauri::command\]/g) || []).length, 2);
    } else {
      assert.equal(rustSignature(rustFunction(after, name)), rustSignature(rustFunction(before, name)), name);
      assert.equal((after.match(/#\[tauri::command\]/g) || []).length, 1);
    }
  }
  await assertCurrentValidation();
});

test('R12-17 keeps actual command paths and exercises frontend payload contracts', async () => {
  await assertCurrentValidation();
});

test('R12-17 has one actual command owner per migrated feature and removes the old monoliths', async () => {
  const main = await read('src-tauri/src/main.rs');
  for (const [module, name] of commands) {
    await assert.rejects(access(`src-tauri/src/${module}.rs`), { code: 'ENOENT' });
    const entry = await read(`src-tauri/src/${module}/mod.rs`);
    const command = await read(`src-tauri/src/${module}/command.rs`);
    assert.match(entry, /pub\(crate\) mod command;/);
    assert.doesNotMatch(entry, /#\[tauri::command\]/);
    assert.match(main, new RegExp(`${module}::command::${name}`));
    assert.doesNotMatch(command, /static |OnceLock|Mutex|spawn\(|impl Drop|mod command|pub use/);
    if (module !== 'performance_log') assert.doesNotMatch(entry.split('#[cfg(test)]\nmod tests')[0], /\bfn /);
  }
  for (const registered of registry(main)) {
    const segments = registered.split('::');
    const name = segments.pop();
    const source = await read(`src-tauri/src/${segments.join('/')}.rs`);
    assert.match(source, new RegExp(`#\\[tauri::command(?:\\([^\\n]*\\))?\\]\\s*pub (?:async )?fn ${name}\\b`), registered);
  }
});

test('R12-17 inventories actual command owners without a historical total', async () => {
  await assertProductionInventory();
  for (const [module] of commands) await assertOwner(`src-tauri/src/${module}/command.rs`, 'none');
});
