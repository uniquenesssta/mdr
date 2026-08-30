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

test('R12-04 gives UTF-8 text and binary image reading separate authorities', async () => {
  const [entry, textReader, imageReader] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/text_reader.rs'),
    source('src-tauri/src/local_file/image_reader.rs')
  ]);
  const productionText = textReader.split('#[cfg(test)]')[0];
  const productionImage = imageReader.split('#[cfg(test)]')[0];

  assert.match(entry, /mod text_reader;/);
  assert.match(entry, /mod image_reader;/);
  assert.match(textReader, /Responsibility: enforce the frozen dropped-text size limit and decode one file as UTF-8/);
  assert.match(imageReader, /Responsibility: enforce the frozen image size limits, read image bytes and encode them/);
  assert.match(productionText, /fs::read_to_string\(path\)/);
  assert.doesNotMatch(productionText, /base64|fs::read\(|#\[tauri::command\]|DroppedFile|LocalImageData|FileKind/);
  assert.match(productionImage, /fs::read\(path\)/);
  assert.match(productionImage, /general_purpose::STANDARD\.encode\(&bytes\)/);
  assert.doesNotMatch(productionImage, /read_to_string|#\[tauri::command\]|DroppedFile|LocalImageData|FileKind/);
});

test('R12-04 routes reads through Readers and keeps binary bytes out of text', async () => {
  const [entry, textReader] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/text_reader.rs')
  ]);
  const production = entry.split('#[cfg(test)]')[0];

  assert.match(production, /read_dropped_text\(&path_buf, metadata\.len\(\)\)\?/);
  assert.match(production, /read_dropped_image\(&path_buf, mime, metadata\.len\(\)\)\?/);
  assert.match(production, /read_embedded_image\(&path, mime\)\?/);
  assert.doesNotMatch(production, /fs::read_to_string|general_purpose::STANDARD\.encode/);
  assert.match(textReader, /rejects_binary_bytes_instead_of_treating_them_as_text/);
  assert.match(textReader, /\[0xff, 0xfe\]/);
});

test('R12-04 preserves size validation order Data URL MIME and exact errors', async () => {
  const [entry, textReader, imageReader] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/text_reader.rs'),
    source('src-tauri/src/local_file/image_reader.rs')
  ]);
  const imageStart = entry.indexOf('fn read_local_image_inner');
  const imageEnd = entry.indexOf('#[derive(Debug, Serialize)]', imageStart);
  const localImage = entry.slice(imageStart, imageEnd);

  assert.ok(localImage.indexOf('validate_embedded_image_size(metadata.len())?') < localImage.indexOf('classify(&path)'));
  for (const error of [
    '文本文件过大，暂不支持直接拖入', '无法读取文本文件：',
    '图片超过 5MB，暂不支持直接插入', '图片超过 20MB，混合编辑模式暂不加载',
    '无法读取图片文件：'
  ]) assert.ok(`${textReader}\n${imageReader}`.includes(error), `missing Reader error: ${error}`);
  assert.match(imageReader, /format!\("data:\{mime\};base64,\{encoded\}"\)/);
  assert.match(imageReader, /MAX_IMAGE_BYTES: u64 = 5 \* 1024 \* 1024/);
  assert.match(imageReader, /MAX_EMBEDDED_IMAGE_BYTES: u64 = 20 \* 1024 \* 1024/);
  assert.match(textReader, /MAX_TEXT_BYTES: u64 = 20 \* 1024 \* 1024/);
});

test('R12-04 preserves commands and frozen dependency blobs', async () => {
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

test('R12-04 records both Readers and becomes the sole automatic Stage workflow', async () => {
  const [inventory, current, previous] = await Promise.all([
    source('tests/architecture/fixtures/production-modules.json').then(JSON.parse),
    source('.github/workflows/r12-04.yml'),
    source('.github/workflows/r12-03.yml')
  ]);
  const pathIndex = inventory.fields.indexOf('path');
  const lifecycleIndex = inventory.fields.indexOf('lifecycle');
  for (const path of [
    'src-tauri/src/local_file/text_reader.rs',
    'src-tauri/src/local_file/image_reader.rs'
  ]) {
    const record = inventory.modules.find(item => item[pathIndex] === path);
    assert.ok(record, `missing Reader ownership record: ${path}`);
    assert.equal(record[lifecycleIndex], 'filesystem-read');
  }
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(current, /^\s*pull_request:\s*$/m);
  assert.match(current, /local_file::text_reader::tests/);
  assert.match(current, /test result: ok\. 4 passed; 0 failed/);
  assert.match(current, /local_file::image_reader::tests/);
  assert.match(current, /test result: ok\. 6 passed; 0 failed/);
  assert.doesNotMatch(current, /--bin markdown-editor reader::tests/);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
});
