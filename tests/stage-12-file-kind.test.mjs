import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content);
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

test('R12-03 creates one pure File Kind authority with no file or command ownership', async () => {
  const [entry, fileKind] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/file_kind.rs')
  ]);
  const productionEntry = entry.split('#[cfg(test)]')[0];
  const productionFileKind = fileKind.split('#[cfg(test)]')[0];

  assert.match(entry, /mod file_kind;/);
  assert.match(fileKind, /Responsibility: normalize the final path extension and classify it/);
  assert.match(fileKind, /enum FileKind\s*\{\s*Text,\s*Image \{ mime: &'static str \},\s*Unsupported/);
  assert.doesNotMatch(productionEntry, /fn extension\s*\(|fn classify\s*\(|enum FileKind/);
  assert.doesNotMatch(productionFileKind, /#\[tauri::command\]|serde|base64|LocalImageData|DroppedFile/);
  assert.doesNotMatch(productionFileKind, /(?:std::)?fs::|File::|metadata\s*\(|read_to_string|read_dir/);
  assert.equal((`${entry}\n${fileKind}`.match(/fn classify\s*\(/g) || []).length, 1);
});

test('R12-03 preserves the frozen text image and unsupported classification', async () => {
  const fileKind = await source('src-tauri/src/local_file/file_kind.rs');

  assert.match(fileKind, /"md" \| "markdown" \| "txt" => FileKind::Text/);
  for (const [extension, mime] of [
    ['png', 'image/png'], ['jpg" | "jpeg', 'image/jpeg'], ['gif', 'image/gif'],
    ['webp', 'image/webp'], ['svg', 'image/svg+xml']
  ]) {
    assert.ok(fileKind.includes(`"${extension}" => FileKind::Image`), `missing image extension: ${extension}`);
    assert.ok(fileKind.includes(`mime: "${mime}"`), `missing image MIME: ${mime}`);
  }
  assert.match(fileKind, /_ => FileKind::Unsupported/);
  assert.match(fileKind, /to_ascii_lowercase\(\)/);
});

test('R12-03 routes every local-file kind decision through File Kind', async () => {
  const [entry, directoryTree] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/directory_tree.rs')
  ]);
  const production = entry.split('#[cfg(test)]')[0];
  const treeProduction = directoryTree.split('#[cfg(test)]')[0];
  const combined = `${production}\n${treeProduction}`;

  assert.match(production, /let mime = match classify\(&path\)/);
  assert.match(production, /match classify\(&path_buf\)/);
  assert.match(production, /FileKind::Text =>/);
  assert.match(production, /FileKind::Image \{ mime \} =>/);
  assert.match(production, /FileKind::Unsupported => Err\("不支持该文件类型/);
  assert.equal((combined.match(/is_supported_text_path\(/g) || []).length, 3);
  assert.equal((production.match(/extension\(Path::new\(/g) || []).length, 3);
  assert.doesNotMatch(production, /"md" \| "markdown" \| "txt"|"png" =>|"jpg" \| "jpeg"/);
});

test('R12-03 preserves commands dependencies and the R12-01 source contracts', async () => {
  const [entry, cargo, packageJson, manifest] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/Cargo.toml'),
    source('package.json'),
    source('src-tauri/tests/fixtures/stage_12_security/manifest.json').then(JSON.parse)
  ]);

  for (const signature of [
    'pub async fn list_text_file_tree(document_path: String) -> Result<TextFileTree, String>',
    'pub fn read_dropped_file(path: String) -> Result<DroppedFile, String>',
    'pub async fn read_local_image(',
    'pub async fn write_local_text_file(path: String, content: String) -> Result<LocalWriteResult, String>',
    'pub async fn write_local_binary_file(path: String, content_base64: String) -> Result<LocalWriteResult, String>',
    'pub fn initial_file_path() -> Option<String>'
  ]) assert.ok(entry.includes(signature), `changed command signature: ${signature}`);

  assert.equal(gitBlobSha(cargo), manifest.source.dependencyFiles['src-tauri/Cargo.toml']);
  assert.equal(gitBlobSha(packageJson), manifest.source.dependencyFiles['package.json']);
});

test('R12-03 records File Kind ownership and stays manual after R12-06 starts', async () => {
  const [inventory, current, previous] = await Promise.all([
    source('tests/architecture/fixtures/production-modules.json').then(JSON.parse),
    source('.github/workflows/r12-06.yml'),
    source('.github/workflows/r12-03.yml')
  ]);
  const pathIndex = inventory.fields.indexOf('path');
  const record = inventory.modules.find(item => item[pathIndex] === 'src-tauri/src/local_file/file_kind.rs');

  assert.ok(record, 'File Kind ownership record is required');
  assert.equal(record[inventory.fields.indexOf('stateOwner')], 'none');
  assert.equal(record[inventory.fields.indexOf('lifecycle')], 'pure-call');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(current, /^\s*pull_request:\s*$/m);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
});
