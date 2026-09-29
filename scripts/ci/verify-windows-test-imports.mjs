// Preserve the byte freeze except for exact test-only Windows portability corrections.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const baseline = '3692eb913473a8be3a45f326f5d93656d6cf1fb2';
const corrections = [
  ['src-tauri/tests/web_fetch/http_compatibility.rs', '                stream\n                    .set_read_timeout',
    '                // Windows accepted sockets can inherit the listener nonblocking mode.\n                stream.set_nonblocking(false).map_err(|e| e.to_string())?;\n                stream\n                    .set_read_timeout'],
  ['src-tauri/src/local_file/path_policy.rs', '    use std::{\n        fs,\n',
    '    #[cfg(unix)]\n    use std::fs;\n    use std::{\n'],
  ['src-tauri/tests/local_file/stage_12.rs',
    'use super::directory_tree::{build_text_file_tree, scan_text_file_tree_directory};',
    '#[cfg(unix)]\nuse super::directory_tree::build_text_file_tree;\nuse super::directory_tree::scan_text_file_tree_directory;']
];
for (const [path, before, after] of corrections) {
  const original = execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
  assert.equal(original.split(before).length, 2, `${path}: correction must match once`);
  assert.equal(readFileSync(path, 'utf8'), original.replace(before, after), `${path}: changed beyond test imports`);
}
console.log('Windows test import scope passed; production behavior unchanged.');
