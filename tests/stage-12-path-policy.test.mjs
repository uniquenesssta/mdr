import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('R12-02 creates one narrow Path Policy authority with no command or content ownership', async () => {
  const [entry, policy] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/path_policy.rs')
  ]);
  const productionPolicy = policy.split('#[cfg(test)]')[0];

  assert.match(entry, /mod path_policy;/);
  assert.match(policy, /Responsibility: construct input paths, resolve document-relative images/);
  for (const symbol of [
    'input_path', 'required_path', 'parent_directory', 'resolve_local_image_path',
    'is_within_directory', 'inspect_tree_entry', 'TreeEntryPolicy'
  ]) assert.match(policy, new RegExp(`\\b${symbol}\\b`), `missing Path Policy symbol: ${symbol}`);

  assert.doesNotMatch(productionPolicy, /#\[tauri::command\]|serde|base64|LocalImageData|TextFileTreeNode/);
  assert.doesNotMatch(productionPolicy, /fs::(?:read|write|read_dir)\s*\(/);
  assert.equal((`${entry}\n${policy}`.match(/fn resolve_local_image_path\s*\(/g) || []).length, 1);
});

test('R12-02 routes all local-file read and write path construction through Path Policy', async () => {
  const entry = await source('src-tauri/src/local_file.rs');
  const production = entry.split('#[cfg(test)]')[0];

  assert.match(production, /required_path\(&path, "保存路径不能为空"\)\?/g);
  assert.equal((production.match(/required_path\(&path, "保存路径不能为空"\)\?/g) || []).length, 2);
  assert.match(production, /required_path\(document_path\.trim\(\), "当前文档尚未关联本地文件"\)\?/);
  assert.match(production, /let path_buf = input_path\(&path\);/);
  assert.match(production, /resolve_local_image_path\(&source, document_path\.as_deref\(\)\)\?/);
  assert.match(production, /parent_directory\(&document, "无法确定当前文档所在文件夹"\)\?/);
  assert.doesNotMatch(production, /PathBuf::from\(&path\)|PathBuf::from\(document_path/);
});

test('R12-02 centralizes tree containment symlink and unreadable-entry classification', async () => {
  const [entry, policy] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/path_policy.rs')
  ]);

  assert.match(entry, /inspect_tree_entry\(root, &path\)/);
  assert.match(entry, /TreeEntryPolicy::Skip => continue/);
  assert.match(entry, /TreeEntryPolicy::Unreadable => \{\s*state\.skipped_count \+= 1/);
  assert.doesNotMatch(entry, /fs::symlink_metadata/);
  assert.match(policy, /candidate\.strip_prefix\(root\)/);
  assert.match(policy, /Component::ParentDir \| Component::RootDir \| Component::Prefix\(_\)/);
  assert.match(policy, /fs::symlink_metadata\(candidate\)/);
  assert.match(policy, /metadata\.file_type\(\)\.is_symlink\(\).*TreeEntryPolicy::Skip/);
});

test('R12-02 preserves command signatures dependencies and the frozen parent-relative image contract', async () => {
  const [entry, policy, cargo, packageJson, fileClient] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/path_policy.rs'),
    source('src-tauri/Cargo.toml'),
    source('package.json'),
    source('src/platform/desktop/file-system-client.js')
  ]);

  for (const signature of [
    'pub async fn list_text_file_tree(document_path: String) -> Result<TextFileTree, String>',
    'pub fn read_dropped_file(path: String) -> Result<DroppedFile, String>',
    'pub async fn read_local_image(',
    'pub async fn write_local_text_file(path: String, content: String) -> Result<LocalWriteResult, String>',
    'pub async fn write_local_binary_file(path: String, content_base64: String) -> Result<LocalWriteResult, String>'
  ]) assert.ok(entry.includes(signature), `changed command signature: ${signature}`);

  assert.match(policy, /preserves_parent_relative_markdown_image_semantics/);
  assert.match(policy, /"\.\.\/images\/picture\.png"/);
  assert.match(cargo, /url\s*=\s*"2"/);
  assert.doesNotMatch(packageJson, /path-policy/);
  for (const command of [
    'read_dropped_file', 'read_local_image', 'write_local_text_file',
    'write_local_binary_file', 'list_text_file_tree'
  ]) assert.match(fileClient, new RegExp(command));
});

test('R12-02 records Path Policy ownership and owns automatic Stage validation', async () => {
  const [inventory, current, previous] = await Promise.all([
    source('tests/architecture/fixtures/production-modules.json').then(JSON.parse),
    source('.github/workflows/r12-02.yml'),
    source('.github/workflows/r12-01.yml')
  ]);
  const pathIndex = inventory.fields.indexOf('path');
  const record = inventory.modules.find(item => item[pathIndex] === 'src-tauri/src/local_file/path_policy.rs');
  assert.ok(record, 'Path Policy ownership record is required');
  assert.equal(record[inventory.fields.indexOf('stateOwner')], 'none');
  assert.equal(record[inventory.fields.indexOf('lifecycle')], 'filesystem-inspection');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(current, /^\s*pull_request:\s*$/m);
  assert.match(current, /grep -El 'fn resolve_local_image_path'/);
  assert.doesNotMatch(current, /\brg\b/, 'pre-install guards must use tools present on the runner image');
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
});
