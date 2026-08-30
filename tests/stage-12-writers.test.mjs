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

test('R12-05 gives text and binary persistence separate Writer authorities', async () => {
  const [entry, textWriter, binaryWriter] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/text_writer.rs'),
    source('src-tauri/src/local_file/binary_writer.rs')
  ]);
  const productionText = textWriter.split('#[cfg(test)]')[0];
  const productionBinary = binaryWriter.split('#[cfg(test)]')[0];

  assert.match(entry, /mod text_writer;/);
  assert.match(entry, /mod binary_writer;/);
  assert.match(textWriter, /Responsibility: write the supplied text bytes to one already-resolved path/);
  assert.match(binaryWriter, /Responsibility: decode the command's Base64 payload, write the supplied bytes/);
  assert.match(productionText, /fs::write\(path, content\.as_bytes\(\)\)/);
  assert.doesNotMatch(
    productionText,
    /base64|decode|#\[tauri::command\]|LocalWriteResult|tauri_plugin_dialog|dialog::|FileDialog|open_dialog|save_dialog|create_dir/,
  );
  assert.match(productionBinary, /general_purpose::STANDARD\s*\.decode\(content_base64\)/);
  assert.match(productionBinary, /fs::write\(path, content\)/);
  assert.doesNotMatch(
    productionBinary,
    /read_to_string|#\[tauri::command\]|LocalWriteResult|tauri_plugin_dialog|dialog::|FileDialog|open_dialog|save_dialog|create_dir/,
  );
});

test('R12-05 routes writes through Writers without duplicate file IO or Base64 decoding', async () => {
  const entry = await source('src-tauri/src/local_file.rs');
  const production = entry.split('#[cfg(test)]')[0];

  assert.match(production, /write_text\(&path_buf, &content\)\?/);
  assert.match(production, /write_binary\(&path_buf, &content\)\?/);
  assert.match(production, /decode_binary\(&content_base64\)\?/);
  assert.doesNotMatch(production, /fs::write|general_purpose|\.decode\(content_base64\)/);
  assert.equal((production.match(/required_path\(&path, "保存路径不能为空"\)\?/g) || []).length, 2);
});

test('R12-05 preserves parent decode byte-count and error ordering without dialog ownership', async () => {
  const [entry, textWriter, binaryWriter] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/text_writer.rs'),
    source('src-tauri/src/local_file/binary_writer.rs')
  ]);
  const binaryCommandStart = entry.indexOf('pub async fn write_local_binary_file');
  const binaryCommandEnd = entry.indexOf('#[tauri::command]', binaryCommandStart + 1);
  const binaryCommand = entry.slice(binaryCommandStart, binaryCommandEnd);

  assert.ok(binaryCommand.indexOf('decode_binary(&content_base64)?') < binaryCommand.indexOf('let bytes = content.len()'));
  assert.ok(binaryCommand.indexOf('let bytes = content.len()') < binaryCommand.indexOf('measure_sync'));
  for (const error of ['无法写入文本文件：', '文件数据解码失败：', '无法写入文件：']) {
    assert.ok(`${textWriter}\n${binaryWriter}`.includes(error), `missing Writer error: ${error}`);
  }
  assert.doesNotMatch(
    `${textWriter}\n${binaryWriter}`,
    /tauri_plugin_dialog|dialog::|FileDialog|open_dialog|save_dialog|create_dir_all|create_dir\(/,
  );
  assert.match(textWriter, /missing_parent_error_without_creating_directories/);
  assert.match(binaryWriter, /missing_parent_error_without_creating_directories/);
});

test('R12-05 preserves commands DTOs and frozen dependency blobs', async () => {
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

test('R12-05 records both Writers and becomes the sole automatic Stage workflow', async () => {
  const [inventory, current, previous] = await Promise.all([
    source('tests/architecture/fixtures/production-modules.json').then(JSON.parse),
    source('.github/workflows/r12-05.yml'),
    source('.github/workflows/r12-04.yml')
  ]);
  const pathIndex = inventory.fields.indexOf('path');
  const lifecycleIndex = inventory.fields.indexOf('lifecycle');
  for (const path of [
    'src-tauri/src/local_file/text_writer.rs',
    'src-tauri/src/local_file/binary_writer.rs'
  ]) {
    const record = inventory.modules.find(item => item[pathIndex] === path);
    assert.ok(record, `missing Writer ownership record: ${path}`);
    assert.equal(record[lifecycleIndex], 'filesystem-write');
  }
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(current, /^\s*pull_request:\s*$/m);
  assert.match(current, /local_file::text_writer::tests/);
  assert.match(current, /test result: ok\. 4 passed; 0 failed/);
  assert.match(current, /local_file::binary_writer::tests/);
  assert.match(current, /test result: ok\. 6 passed; 0 failed/);
  assert.doesNotMatch(current, /--bin markdown-editor writer::tests/);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
});
