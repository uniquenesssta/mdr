import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import { rustFunction } from './support/performance-log/storage-contract.mjs';

const baseline = 'd5c45f4774615be04177c89409e4b432869a4db3';
const read = path => readFile(path, 'utf8');
const frozen = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
const commands = [['external_link', 'open_external_url'], ['web_fetch', 'fetch_url'], ['performance_log', 'write_performance_logs']];
const registry = text => text.match(/tauri::generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(s => s.trim()).filter(Boolean);
const tokens = text => text.replace(/\s+/g, '');
async function owner(module) {
  try { await access(`src-tauri/src/${module}.rs`); return `src-tauri/src/${module}.rs`; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return `src-tauri/src/${module}/command.rs`; }
}

test('R12-17 preserves all nineteen registered names and their order without duplicates', async () => {
  const before = registry(frozen('src-tauri/src/main.rs'));
  const after = registry(await read('src-tauri/src/main.rs'));
  assert.equal(before.length, 19);
  assert.deepEqual(after.map(p => p.split('::').at(-1)), before.map(p => p.split('::').at(-1)));
  assert.equal(new Set(after).size, 19);
  assert.deepEqual(after.map(p => p.replace('::command::', '::')), before);
});

test('R12-17 preserves command signatures bodies payloads and asynchronous error propagation', async () => {
  for (const [module, name] of commands) {
    const before = frozen(`src-tauri/src/${module}.rs`);
    const after = await read(await owner(module));
    for (const fn of module === 'web_fetch' ? [name, 'fetch_url_inner'] : [name]) {
      assert.equal(tokens(rustFunction(after, fn)), tokens(rustFunction(before, fn)), fn);
    }
    assert.equal((after.match(/#\[tauri::command\]/g) || []).length, 1);
    assert.match(after, new RegExp(`#\\[tauri::command\\]\\s*pub (?:async )?fn ${name}\\(`));
  }
});

test('R12-17 changes only command paths in application composition and preserves frontend payloads', async () => {
  const main = await read('src-tauri/src/main.rs');
  assert.equal(main.replaceAll('::command::', '::'), frozen('src-tauri/src/main.rs'));
  for (const path of ['src/platform/desktop/link-client.js', 'src/platform/desktop/web-fetch-client.js',
    'src/platform/desktop/performance-log-client.js', 'src/platform/desktop/file-system-client.js',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) assert.equal(await read(path), frozen(path), path);
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

test('R12-17 inventories all new real owners and preserves every unrelated state record', async () => {
  const file = 'tests/architecture/fixtures/production-modules.json';
  const before = JSON.parse(frozen(file));
  const after = JSON.parse(await read(file));
  assert.deepEqual(after.fields, before.fields);
  assert.equal(after.modules.length, before.modules.length + 3);
  for (const row of before.modules) {
    const module = commands.find(([m]) => row[0] === `src-tauri/src/${m}.rs`)?.[0];
    const actual = after.modules.find(r => r[0] === (module ? `src-tauri/src/${module}/mod.rs` : row[0]));
    assert.ok(actual, row[0]);
    assert.deepEqual(actual.slice(4), row.slice(4));
    if (!module) assert.deepEqual(actual, row);
  }
  for (const [module] of commands) {
    const rows = after.modules.filter(r => r[0] === `src-tauri/src/${module}/command.rs`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][4], 'none');
    assert.equal(rows[0][5], 'tauri-command');
  }
});
