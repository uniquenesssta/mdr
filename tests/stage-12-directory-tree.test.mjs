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

test('R12-06 creates one Directory Tree authority and removes the old scan implementation', async () => {
  const [entry, directoryTree] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/directory_tree.rs')
  ]);
  const productionEntry = entry.split('#[cfg(test)]')[0];
  const productionTree = directoryTree.split('#[cfg(test)]')[0];

  assert.match(entry, /mod directory_tree;/);
  assert.match(entry, /pub use directory_tree::\{TextFileTree, TextFileTreeNode\};/);
  assert.match(directoryTree, /Responsibility: recursively scan one validated document directory/);
  assert.match(productionEntry, /build_text_file_tree\(&document_path, MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES\)/);
  assert.doesNotMatch(productionEntry, /fs::read_dir|File::open|fn compare_tree_nodes|fn scan_text_file_tree_directory/);
  assert.doesNotMatch(productionEntry, /pub struct TextFileTree(?:Node)?|struct DirectoryTreeScanState/);
  assert.equal((`${entry}\n${directoryTree}`.match(/fn build_text_file_tree\s*\(/g) || []).length, 1);
  assert.equal((`${entry}\n${directoryTree}`.match(/fn scan_text_file_tree_directory\s*\(/g) || []).length, 1);
  assert.match(productionTree, /pub struct TextFileTreeNode/);
  assert.match(productionTree, /pub struct TextFileTree/);
});

test('R12-06 owns recursion stable directory-first sorting counts and empty-directory omission', async () => {
  const directoryTree = await source('src-tauri/src/local_file/directory_tree.rs');
  const production = directoryTree.split('#[cfg(test)]')[0];

  assert.match(production, /scan_text_file_tree_directory\(\s*root,\s*&path,\s*depth \+ 1,/);
  assert.match(production, /right_directory\s*\.cmp\(&left_directory\)/);
  assert.match(production, /left\.name\.to_ascii_lowercase\(\)\.cmp\(&right\.name\.to_ascii_lowercase\(\)\)/);
  assert.match(production, /\.then_with\(\|\| left\.name\.cmp\(&right\.name\)\)/);
  assert.match(production, /if !children\.is_empty\(\) \{\s*state\.directory_count \+= 1/);
  assert.match(production, /state\.file_count \+= 1/);
  assert.match(production, /nodes\.sort_by\(compare_tree_nodes\)/);
  assert.match(directoryTree, /builds_a_nested_supported_tree_and_omits_empty_directories/);
  assert.match(directoryTree, /sorts_directories_first_then_names_case_insensitively_and_stably/);
});

test('R12-06 never follows symbolic links and preserves skip accounting', async () => {
  const [directoryTree, pathPolicy, manifest] = await Promise.all([
    source('src-tauri/src/local_file/directory_tree.rs'),
    source('src-tauri/src/local_file/path_policy.rs'),
    source('src-tauri/tests/fixtures/stage_12_security/manifest.json').then(JSON.parse)
  ]);
  const production = directoryTree.split('#[cfg(test)]')[0];

  assert.equal(manifest.localFile.treePolicy.symlinks, 'skip-without-counting-as-skipped');
  assert.match(pathPolicy, /metadata\.file_type\(\)\.is_symlink\(\).*TreeEntryPolicy::Skip/);
  assert.match(production, /inspect_tree_entry\(root, &path\)/);
  assert.match(production, /TreeEntryPolicy::Skip => continue/);
  assert.match(production, /TreeEntryPolicy::Unreadable => \{\s*state\.skipped_count \+= 1/);
  assert.doesNotMatch(production, /symlink_metadata|canonicalize/);
  assert.match(directoryTree, /never_follows_file_or_directory_symbolic_links/);
  assert.match(directoryTree, /linked-directory/);
});

test('R12-06 consumes caller limits without advancing the R12-07 Tree Limits authority', async () => {
  const [entry, directoryTree] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/directory_tree.rs')
  ]);
  const production = directoryTree.split('#[cfg(test)]')[0];

  assert.match(entry, /const MAX_FILE_TREE_DEPTH: usize = 24;/);
  assert.match(entry, /const MAX_FILE_TREE_ENTRIES: usize = 12_000;/);
  assert.match(production, /depth > max_depth/);
  assert.match(production, /state\.scanned_entries >= max_entries/);
  assert.doesNotMatch(production, /const MAX_FILE_TREE|12_000|\b24\b/);
  await assert.rejects(source('src-tauri/src/local_file/tree_limits.rs'));
  assert.match(directoryTree, /reports_depth_and_entry_truncation_at_the_supplied_boundaries/);
});

test('R12-06 preserves DTO errors readable-file policy commands and dependencies', async () => {
  const [entry, directoryTree, cargo, packageJson, manifest] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/directory_tree.rs'),
    source('src-tauri/Cargo.toml'),
    source('package.json'),
    source('src-tauri/tests/fixtures/stage_12_security/manifest.json').then(JSON.parse)
  ]);

  assert.ok(entry.includes('pub async fn list_text_file_tree(document_path: String) -> Result<TextFileTree, String>'));
  for (const field of [
    'root_path: String', 'root_name: String', 'nodes: Vec<TextFileTreeNode>',
    'file_count: usize', 'directory_count: usize', 'skipped_count: usize', 'truncated: bool'
  ]) assert.ok(directoryTree.includes(field), `missing tree DTO field: ${field}`);
  for (const error of [
    '当前文档尚未关联本地文件', '无法读取当前文档信息：',
    '当前文档不是可读取的 Markdown 或 TXT 文件', '无法确定当前文档所在文件夹',
    '无法读取当前文件夹：'
  ]) assert.ok(directoryTree.includes(error), `missing directory-tree error: ${error}`);
  assert.match(directoryTree, /!is_supported_text_size\(metadata\.len\(\)\) \|\| File::open\(&path\)\.is_err\(\)/);
  assert.equal(gitBlobSha(cargo), manifest.source.dependencyFiles['src-tauri/Cargo.toml']);
  assert.equal(gitBlobSha(packageJson), manifest.source.dependencyFiles['package.json']);
});

test('R12-06 records Directory Tree ownership and becomes the sole automatic Stage workflow', async () => {
  const [inventory, current, previous] = await Promise.all([
    source('tests/architecture/fixtures/production-modules.json').then(JSON.parse),
    source('.github/workflows/r12-06.yml'),
    source('.github/workflows/r12-05.yml')
  ]);
  const pathIndex = inventory.fields.indexOf('path');
  const record = inventory.modules.find(item => item[pathIndex] === 'src-tauri/src/local_file/directory_tree.rs');

  assert.ok(record, 'Directory Tree ownership record is required');
  assert.equal(record[inventory.fields.indexOf('stateOwner')], 'directory-tree-scan-call');
  assert.equal(record[inventory.fields.indexOf('lifecycle')], 'filesystem-scan');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(current, /^\s*pull_request:\s*$/m);
  assert.match(current, /local_file::directory_tree::tests/);
  assert.match(current, /test result: ok\. 6 passed; 0 failed/);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
});
