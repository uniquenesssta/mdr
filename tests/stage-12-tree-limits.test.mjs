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

test('R12-07 creates one Tree Limits authority and removes command-layer constants', async () => {
  const [entry, treeLimits] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/tree_limits.rs')
  ]);
  const productionEntry = entry.split('#[cfg(test)]')[0];
  const productionLimits = treeLimits.split('#[cfg(test)]')[0];

  assert.match(entry, /mod tree_limits;/);
  assert.match(treeLimits, /Responsibility: centralize the frozen tree depth, scanned-entry and readable-text size/);
  assert.match(productionLimits, /const MAX_FILE_TREE_DEPTH: usize = 24;/);
  assert.match(productionLimits, /const MAX_FILE_TREE_ENTRIES: usize = 12_000;/);
  assert.match(productionLimits, /use super::text_reader::MAX_TEXT_BYTES;/);
  assert.match(productionLimits, /Self::new\(MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES, MAX_TEXT_BYTES\)/);
  assert.doesNotMatch(productionEntry, /const MAX_FILE_TREE|12_000|\b24\b/);
});

test('R12-07 routes the command and Directory Tree through one default limit set', async () => {
  const [entry, directoryTree] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/directory_tree.rs')
  ]);
  const productionEntry = entry.split('#[cfg(test)]')[0];
  const productionTree = directoryTree.split('#[cfg(test)]')[0];

  assert.match(productionEntry, /build_text_file_tree\(&document_path, TreeLimits::default\(\)\)/);
  assert.match(productionTree, /tree_limits::\{TreeLimitState, TreeLimits\}/);
  assert.match(productionTree, /scan_text_file_tree_directory\(&root, &root, 0, limits, &mut state\)/);
  assert.match(productionTree, /state\.admit_depth\(depth, limits\)/);
  assert.match(productionTree, /state\.admit_entry\(limits\)/);
  assert.match(productionTree, /limits\.accepts_file_size\(metadata\.len\(\)\)/);
  assert.doesNotMatch(productionTree, /DirectoryTreeScanState|MAX_FILE_TREE|MAX_TEXT_BYTES|12_000|\b24\b/);
});

test('R12-07 freezes equal-boundary depth entry and readable-text size behavior', async () => {
  const treeLimits = await source('src-tauri/src/local_file/tree_limits.rs');
  const production = treeLimits.split('#[cfg(test)]')[0];

  assert.match(production, /if depth <= limits\.max_depth/);
  assert.match(production, /if self\.scanned_entries >= limits\.max_entries/);
  assert.match(production, /bytes <= self\.max_file_bytes/);
  assert.match(treeLimits, /depth_allows_equal_and_truncates_only_after_the_limit/);
  assert.match(treeLimits, /entry_budget_counts_each_admitted_entry_and_truncates_the_next/);
  assert.match(treeLimits, /text_size_allows_equal_and_rejects_only_greater_bytes/);
});

test('R12-07 owns file directory skipped and truncation state per scan call', async () => {
  const [treeLimits, directoryTree] = await Promise.all([
    source('src-tauri/src/local_file/tree_limits.rs'),
    source('src-tauri/src/local_file/directory_tree.rs')
  ]);
  const productionLimits = treeLimits.split('#[cfg(test)]')[0];
  const productionTree = directoryTree.split('#[cfg(test)]')[0];

  for (const field of ['scanned_entries', 'file_count', 'directory_count', 'skipped_count', 'truncated']) {
    assert.match(productionLimits, new RegExp(`\\b${field}: `), `missing Tree Limit state field: ${field}`);
  }
  assert.match(productionTree, /state\.record_file\(\)/);
  assert.match(productionTree, /state\.record_directory\(\)/);
  assert.match(productionTree, /state\.record_skipped\(\)/);
  assert.match(productionTree, /truncated: state\.truncated\(\)/);
  assert.match(treeLimits, /scan_states_are_call_local_and_independent/);
  assert.doesNotMatch(productionLimits, /fs::|File::|Path|#\[tauri::command\]|serde|TextFileTree/);
});

test('R12-07 preserves commands DTOs frozen dependency blobs and the shared text ceiling', async () => {
  const [entry, directoryTree, textReader, cargo, packageJson, manifest] = await Promise.all([
    source('src-tauri/src/local_file.rs'),
    source('src-tauri/src/local_file/directory_tree.rs'),
    source('src-tauri/src/local_file/text_reader.rs'),
    source('src-tauri/Cargo.toml'),
    source('package.json'),
    source('src-tauri/tests/fixtures/stage_12_security/manifest.json').then(JSON.parse)
  ]);

  assert.ok(entry.includes('pub async fn list_text_file_tree(document_path: String) -> Result<TextFileTree, String>'));
  for (const field of [
    'root_path: String', 'root_name: String', 'nodes: Vec<TextFileTreeNode>',
    'file_count: usize', 'directory_count: usize', 'skipped_count: usize', 'truncated: bool'
  ]) assert.ok(directoryTree.includes(field), `missing tree DTO field: ${field}`);
  assert.match(textReader, /const MAX_TEXT_BYTES: u64 = 20 \* 1024 \* 1024;/);
  assert.equal(gitBlobSha(cargo), manifest.source.dependencyFiles['src-tauri/Cargo.toml']);
  assert.equal(gitBlobSha(packageJson), manifest.source.dependencyFiles['package.json']);
});

test('R12-07 records Tree Limits ownership and becomes the sole automatic Stage workflow', async () => {
  const [inventory, current, previous] = await Promise.all([
    source('tests/architecture/fixtures/production-modules.json').then(JSON.parse),
    source('.github/workflows/r12-07.yml'),
    source('.github/workflows/r12-06.yml')
  ]);
  const pathIndex = inventory.fields.indexOf('path');
  const record = inventory.modules.find(item => item[pathIndex] === 'src-tauri/src/local_file/tree_limits.rs');
  const directoryRecord = inventory.modules.find(item => item[pathIndex] === 'src-tauri/src/local_file/directory_tree.rs');

  assert.ok(record, 'Tree Limits ownership record is required');
  assert.equal(record[inventory.fields.indexOf('stateOwner')], 'tree-limit-scan-call');
  assert.equal(record[inventory.fields.indexOf('lifecycle')], 'call-local-policy');
  assert.equal(directoryRecord[inventory.fields.indexOf('stateOwner')], 'none');
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(current, /^\s*pull_request:\s*$/m);
  assert.match(current, /local_file::tree_limits::tests/);
  assert.match(current, /test result: ok\. 6 passed; 0 failed/);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
});
