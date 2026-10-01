import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertProductionInventory } from './support/production-inventory.mjs';
import { assertCurrentValidation } from './support/current-rust-contracts.mjs';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('approved R13-S01 policy is separate from the immutable R12 behavior manifest', async () => {
  const policy = JSON.parse(await read('src-tauri/tests/fixtures/stage_13_web_fetch/policy.json'));
  const history = JSON.parse(await read(policy.originalManifest));
  assert.equal(history.webFetch.responseBody.maximumBytes, null);
  assert.equal(policy.encodedBodyMaximumBytes, 10 * 1024 * 1024);
  assert.equal(policy.decodedBodyMaximumBytes, 20 * 1024 * 1024);
  assert.equal(policy.network, 'public-only');
  assert.deepEqual(policy.mimeAllowlist, ['text/html', 'application/xhtml+xml']);
  const stage = await read('docs/markdown-main-full-rewrite-taskbook-18-docs/14-阶段13-导入与网页剪藏重写.md');
  assert.match(stage, /用户已确认/);
  // S01 is accepted; guard its evidence instead of freezing later tasks as unfinished.
  const acceptance = await read('docs/R13-S01-DETAILS.md');
  assert.match(acceptance, /74abbd291c32bc125b4f151bd98d337f55e4e54e/);
  assert.match(acceptance, /actions\/runs\/36890098604/);
  assert.match(stage, /74abbd291c32bc125b4f151bd98d337f55e4e54e/);
  assert.match(stage, /actions\/runs\/36890098604/);
});

test('production entry owns the public resolver, whole-request deadline and cancellation registry', async () => {
  const client = await read('src-tauri/src/web_fetch/client.rs');
  const command = await read('src-tauri/src/web_fetch/command.rs');
  const main = await read('src-tauri/src/main.rs');
  assert.match(client, /fetch_with_resolver\(initial, resolve_public, client_builder\)/);
  for (const token of ['validate_addresses(&addresses)?', '.resolve_to_addrs(', '.remote_addr()', '.no_proxy()', 'Policy::none()', 'validate_redirect']) assert.ok(client.includes(token), token);
  assert.match(command, /tokio::time::timeout\(FETCH_TIMEOUT/);
  assert.match(main, /manage\(web_fetch::requests::WebFetchRequests::default\(\)\)/);
  assert.match(main, /web_fetch::command::cancel_fetch_url/);
  assert.doesNotMatch(client.split('#[cfg(test)]\nmod tests')[0], /127\.0\.0\.1|web-fetch\.test|danger_accept_invalid/);
  await assertProductionInventory();
});

test('real Windows HTTP boundaries and cumulative security gates remain mandatory', async () => {
  const cases = await read('src-tauri/tests/web_fetch/http_compatibility.rs');
  for (const name of ['encoded_limit_counts_actual_bytes_with_length_missing_and_chunked',
    'compressed_limits_and_all_supported_codecs_use_real_http_bodies',
    'misleading_lengths_mime_and_compression_do_not_bypass_limits',
    'production_blocks_loopback_and_redirects_to_private_or_foreign_targets_before_connecting',
    'each_hop_resolves_again_and_changed_dns_answers_are_rejected',
    'ten_redirects_succeed_and_an_eleventh_is_rejected',
    'native_cancel_drops_pending_headers_and_body_connections',
    'actual_https_keeps_certificate_validation_and_blocks_downgrade',
    'real_request_retains_the_thirty_second_timeout']) assert.ok(cases.includes(name), name);
  assert.doesNotMatch(cases, /#\[ignore\]/);
  await assertCurrentValidation();
});


test('Windows gates count the current URL and HTTP tests and locate the shared TLS fixture', async () => {
  const http = await read('src-tauri/tests/web_fetch/http_compatibility.rs');
  const urls = await read('src-tauri/tests/web_fetch/validation.rs');
  const workflow = await read('.github/workflows/r12-14.yml');
  const count = source => (source.match(/^#\[test\]/gm) || []).length;
  for (const [source, log] of [[http, 'web-response'], [http, 'web-http'], [urls, 'web-url']]) {
    assert.ok(workflow.includes(`test result: ok. ${count(source)} passed; 0 failed' "$RUNNER_TEMP/r12-14/${log}.log"`), log);
  }
  assert.match(http, /env!\("CARGO_MANIFEST_DIR"\),\s*"\/\.\.\/tests\/fixtures\/dependency-tls\/root-ca\.pem"/);
  assert.match(await read('tests/fixtures/dependency-tls/root-ca.pem'), /BEGIN CERTIFICATE/);
  const guard = await read('scripts/ci/verify-windows-test-imports.mjs');
  assert.match(guard, /4a60a0d3315456b2dd3b63e375fe09d32aa1275e/);
  assert.match(guard, /webBaseline\.replace\(oldCertificate, correctedCertificate\)/);
});
