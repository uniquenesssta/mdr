import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertProductionInventory } from './production-inventory.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function historicalDependency(manifest, file) {
  return execFileSync('git', ['show', `${manifest.source.commit}:${file}`], { cwd: root });
}

// Inspect the current entry and command owners together, without rebuilding
// deleted monoliths or substituting historical bytes for current source.
export async function readCurrentRustSources(input, encoding) {
  const absolute = input instanceof URL ? fileURLToPath(input) : path.resolve(input);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (/^src-tauri\/src\/(external_link|web_fetch|performance_log)\/mod\.rs$/.test(relative)) {
    const command = await readFile(absolute.replace(/mod\.rs$/, 'command.rs'), encoding);
    return command + '\n' + await readFile(absolute, encoding);
  }
  return readFile(input, encoding);
}

export function rustSignature(source) {
  return source.slice(0, source.indexOf('{')).replace(/,\s*\)/g, ')').replace(/\s+/g, '');
}

export async function assertOwner(modulePath, stateOwner) {
  const manifest = await assertProductionInventory();
  const records = manifest.modules.filter(row => row[0] === modulePath);
  assert.equal(records.length, 1, modulePath);
  assert.equal(records[0][manifest.fields.indexOf('stateOwner')], stateOwner, modulePath);
}

export async function assertCurrentValidation() {
  const workflow = await readFile(path.join(root, '.github/workflows/r12-14.yml'), 'utf8');
  for (const command of [
    'cargo test --manifest-path src-tauri/Cargo.toml --locked 2>&1',
    'cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings',
    'verify-release-log-writer.mjs', 'verify-release-log-lifecycle.mjs',
    'src-tauri/tests/external_link_opener_platform.rs',
    'node scripts/ci/run-repository-tests.mjs',
    'npm run test:browser', 'npm run build',
    'tests/architecture/model-kernel-contract.test.mjs'
  ]) assert.ok(workflow.includes(command), `missing active contract: ${command}`);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true|ubuntu-|macos-|git diff --quiet/);
  const runner = await readFile(path.join(root, 'scripts/ci/run-repository-tests.mjs'), 'utf8');
  assert.match(runner, /ls-files/);
  assert.match(runner, /test\.mjs/);
  assert.match(runner, /process\.exitCode/);
}
