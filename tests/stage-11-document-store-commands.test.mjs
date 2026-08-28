import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/document-store-commands.json'));
const modules = [...new Set(fixture.commands.map(command => command.module))];
const sources = new Map(modules.map(name => [name, read(`src-tauri/src/document_store/commands/${name}.rs`)]));
const definitions = [...sources].flatMap(([module, source]) =>
  [...source.matchAll(/#\[tauri::command\]\s*pub async fn (\w+)\(([\s\S]*?)\)\s*->\s*([^\{]+)\{/g)]
    .map(match => ({
      name: match[1], module,
      parameters: match[2].trim().split('\n').map(line => line.trim().replace(/^mut /, '').replace(/,$/, '').replace(/\s+/g, '')),
      returns: match[3].replace(/\s+/g, '')
    }))
);

test('R11-14 preserves all ten command names, argument names/types, default camelCase and return types', () => {
  assert.equal(fixture.baseline, '10c0387d3b286400ceda8d3161193c7aa46cbd80');
  assert.equal(definitions.length, 10);
  assert.equal(new Set(definitions.map(command => command.name)).size, 10);
  for (const expected of fixture.commands) {
    const { joinError, ...signature } = expected;
    assert.deepEqual(definitions.find(command => command.name === expected.name), signature);
  }
  for (const source of sources.values()) {
    assert.doesNotMatch(source, /#\[tauri::command\(/, 'do not override IPC rename policy');
    assert.equal((source.match(/pub async fn /g) || []).length,
      (source.match(/#\[tauri::command\]/g) || []).length);
  }
});

test('R11-14 registers each command once by its owning module and leaves no monolithic command implementation', () => {
  const main = read('src-tauri/src/main.rs');
  const registered = [...main.matchAll(/document_store::commands::(\w+)::(\w+)/g)]
    .map(match => `${match[1]}::${match[2]}`).sort();
  assert.deepEqual(registered, fixture.commands.map(command => `${command.module}::${command.name}`).sort());
  const entry = read('src-tauri/src/document_store.rs');
  assert.match(entry, /pub\(crate\) mod commands;/);
  assert.doesNotMatch(entry, /#\[tauri::command/);
  const commandsEntry = read('src-tauri/src/document_store/commands/mod.rs');
  for (const module of modules) assert.match(commandsEntry, new RegExp(`pub\\(crate\\) mod ${module};`));
});

test('R11-14 command adapters cannot own cache, file IO, recovery, query or snapshot policy', () => {
  for (const [name, text] of sources) {
    const source = text.replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source,
      /\b(?:cache|HashMap|Mutex|StoredDocument|load_document_from_disk|save_document_inner|safe_document_id)\b|\.lock\s*\(|\.inner\s*\./,
      `${name} must call the store instead of accessing its internals`);
    assert.doesNotMatch(source, /\b(?:fs|std|chunks|index|journal|snapshot|paths|repository|validation)\s*::/);
    assert.doesNotMatch(source, /\b(?:recovered|recovery_message|full_content)\b|request\.query/);
    assert.match(source, /spawn_blocking/);
  }
});

test('R11-14 preserves each background task error mapping verbatim', () => {
  for (const module of modules) {
    const expected = fixture.commands.filter(command => command.module === module).map(command => command.joinError).sort();
    const actual = [...sources.get(module).matchAll(/format!\("(后台[^"\n]+)"\)/g)].map(match => match[1]).sort();
    assert.deepEqual(actual, expected);
  }
});

test('R11-14 leaves the frozen Serde DTOs and frontend wire adapter byte-identical to R11-13', () => {
  const hash = source => createHash('sha256').update(source).digest('hex');
  assert.equal(hash(read('src-tauri/src/document_store/types.rs')), fixture.dtoSha256);
  assert.equal(hash(read('src/platform/desktop/document-store-client.js')), fixture.frontendSha256);
});

test('R11-14 Actions validates the pushed SHA with read-only hard gates and retained failure evidence', () => {
  const workflow = read('.github/workflows/r11-14.yml');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[agent\/r11-stage\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /contents: read/);
  for (const gate of [
    'cargo test', 'cargo clippy', 'cargo check', '--all-targets', '-- -D warnings',
    'npm test', 'npm run build', 'npm run verify:architecture',
    'npm run test:browser:contract', 'npm run test:browser',
    'document_store::command_contract_tests', '--test document_store_compatibility',
    'tests/unit/platform/document-store-client.test.mjs',
    'actions/upload-artifact@v4', 'if: always()', 'git diff --exit-code'
  ]) assert.ok(workflow.includes(gate), `missing hard gate: ${gate}`);
  assert.doesNotMatch(workflow, /continue-on-error: true|git push|git commit|contents: write/);
});
