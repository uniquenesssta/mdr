import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixturePath = new URL('../src-tauri/tests/fixtures/stage_12_security/manifest.json', import.meta.url);

async function fixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

test('R12-01 manifest pins the closed Stage 11 source and unchanged dependency contracts', async () => {
  const contract = await fixture();
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.atomicTask, 'R12-01');
  assert.equal(contract.source.commit, 'b8ee68b93cf51f45835ac837cad8110aeea24ad0');

  for (const [path, expectedSha] of Object.entries(contract.source.dependencyFiles)) {
    assert.equal(gitBlobSha(await readFile(new URL(`../${path}`, import.meta.url))), expectedSha, path);
  }
});

test('R12-01 freezes local text image size depth count symlink and unreadable-file behavior', async () => {
  const contract = await fixture();
  const rust = [
    await source('src-tauri/src/local_file.rs'),
    await source('src-tauri/src/local_file/binary_writer.rs'),
    await source('src-tauri/src/local_file/directory_tree.rs'),
    await source('src-tauri/src/local_file/file_kind.rs'),
    await source('src-tauri/src/local_file/image_reader.rs'),
    await source('src-tauri/src/local_file/text_reader.rs'),
    await source('src-tauri/src/local_file/text_writer.rs'),
    await source('src-tauri/src/local_file/tree_limits.rs'),
    await source('src-tauri/src/local_file/path_policy.rs')
  ].join('\n');
  assert.deepEqual(contract.localFile.textExtensions, ['md', 'markdown', 'txt']);
  assert.deepEqual(contract.localFile.imageMimeByExtension, {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'
  });
  assert.deepEqual(contract.localFile.limits, {
    droppedTextBytes: 20 * 1024 * 1024,
    droppedImageBytes: 5 * 1024 * 1024,
    embeddedImageBytes: 20 * 1024 * 1024,
    treeDepth: 24,
    treeEntries: 12_000,
    byteBoundary: 'allow-equal-reject-greater'
  });
  assert.equal(contract.localFile.treePolicy.symlinks, 'skip-without-counting-as-skipped');
  assert.equal(contract.localFile.treePolicy.unreadableSupportedFiles, 'skip-and-increment-skipped-count');
  assert.match(rust, /metadata\.file_type\(\)\.is_symlink\(\).*TreeEntryPolicy::Skip/);
  assert.match(rust, /!limits\.accepts_file_size\(metadata\.len\(\)\) \|\| File::open\(&path\)\.is_err\(\)/);
});

test('R12-01 freezes external-link trimming validation order and four-scheme allowlist', async () => {
  const contract = await fixture();
  const rust = await source('src-tauri/src/external_link.rs');
  assert.deepEqual(contract.externalLink.allowedSchemes, ['http', 'https', 'mailto', 'tel']);
  assert.equal(contract.externalLink.trimInput, true);
  assert.match(rust, /"http" \| "https" \| "mailto" \| "tel"/);
  assert.ok(rust.indexOf('validate_external_url(&url)?') < rust.indexOf('open_platform_url(&validated)'));
});

test('R12-01 records web timeout redirects response fields and the current unfiltered response gaps', async () => {
  const contract = await fixture();
  const rust = await source('src-tauri/src/web_fetch.rs');
  assert.equal(contract.webFetch.redirectLimit, 10);
  assert.equal(contract.webFetch.timeoutSeconds, 30);
  assert.equal(contract.webFetch.contentType.policy, 'reported-only-no-allowlist');
  assert.equal(contract.webFetch.responseBody.maximumBytes, null);
  assert.deepEqual(contract.webFetch.responseFields, ['success', 'url', 'final_url', 'status', 'content_type', 'html']);
  assert.match(rust, /Policy::limited\(10\)/);
  assert.match(rust, /Duration::from_secs\(30\)/);
  assert.match(rust, /\.get\(CONTENT_TYPE\)/);
  assert.match(rust, /\.text\(\)/);
  assert.doesNotMatch(rust, /MAX_RESPONSE_BYTES/);
});

test('R12-01 records performance-log limits fields modes and the current no-redaction boundary', async () => {
  const contract = await fixture();
  const [rust, frontend] = await Promise.all([
    source('src-tauri/src/performance_log.rs'),
    source('src/runtime/performance.js')
  ]);
  assert.deepEqual(contract.performanceLog.backendEntryFields, [
    'timestampMs', 'source', 'category', 'operation', 'durationMs', 'status', 'details'
  ]);
  assert.deepEqual(contract.performanceLog.frontendEntryFields, [
    'timestampMs', 'sessionId', 'source', 'category', 'operation', 'durationMs', 'status', 'details'
  ]);
  assert.equal(contract.performanceLog.commandRedaction, 'none');
  assert.match(rust, /const MAX_BATCH_ENTRIES: usize = 500/);
  assert.match(rust, /const MAX_ENTRY_BYTES: usize = 64 \* 1024/);
  assert.match(rust, /entries: Vec<Value>/);
  assert.match(frontend, /sessionId,\s*source: 'frontend'/);
});

test('R12-01 freezes all nine registered command names without changing frontend payloads', async () => {
  const contract = await fixture();
  const [main, fileClient, linkClient, webClient, logClient] = await Promise.all([
    source('src-tauri/src/main.rs'),
    source('src/platform/desktop/file-system-client.js'),
    source('src/platform/desktop/link-client.js'),
    source('src/platform/desktop/web-fetch-client.js'),
    source('src/platform/desktop/performance-log-client.js')
  ]);
  assert.equal(contract.commands.length, 9);
  for (const command of contract.commands) assert.match(main, new RegExp(command));
  for (const [client, command] of [
    [fileClient, 'read_dropped_file'], [linkClient, 'open_external_url'],
    [webClient, 'fetch_url'], [logClient, 'write_performance_logs']
  ]) assert.match(client, new RegExp(command));
});

test('completed R12-01 through R12-06 stay manual while R12-07 owns Stage branch validation', async () => {
  const [current, previous, first] = await Promise.all([
    source('.github/workflows/r12-07.yml'),
    source('.github/workflows/r12-06.yml'),
    source('.github/workflows/r12-01.yml')
  ]);
  assert.match(current, /push:\s*\n\s*branches: \[agent\/r12-stage\]/);
  assert.match(current, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(current, /^\s*pull_request:\s*$/m);
  assert.match(previous, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(previous, /^\s*push:\s*$/m);
  assert.doesNotMatch(previous, /^\s*pull_request:\s*$/m);
  assert.match(first, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(first, /^\s*push:\s*$/m);
});
