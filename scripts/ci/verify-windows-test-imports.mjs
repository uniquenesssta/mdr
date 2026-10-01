// Preserve the byte freeze except for exact test-only Windows portability corrections.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const baseline = '3692eb913473a8be3a45f326f5d93656d6cf1fb2';
const corrections = [
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
// R13-S01 intentionally supersedes the old HTTP characterization after user policy approval.
// Keep its complete submitted boundary suite frozen except for the exact fixture-path repair.
const webPath = 'src-tauri/tests/web_fetch/http_compatibility.rs';
const webBaseline = execFileSync('git', ['show', `4a60a0d3315456b2dd3b63e375fe09d32aa1275e:${webPath}`], { encoding: 'utf8' });
const oldCertificate = '    let root = reqwest::Certificate::from_pem(include_bytes!("../fixtures/dependency-tls/root-ca.pem")).unwrap();';
const correctedCertificate = `    let root = reqwest::Certificate::from_pem(include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/dependency-tls/root-ca.pem"
    )))
    .unwrap();`;
assert.equal(webBaseline.split(oldCertificate).length, 2, 'certificate repair must match once');
assert.equal(readFileSync(webPath, 'utf8'), webBaseline.replace(oldCertificate, correctedCertificate),
  'R13-S01 HTTP boundary suite changed beyond its certificate-path repair');
console.log('Windows portability and approved R13-S01 fixture scope passed.');
