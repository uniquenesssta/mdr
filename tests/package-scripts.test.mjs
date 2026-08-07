import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
const scripts = packageJson.scripts ?? {};

const preservedScripts = Object.freeze({
  dev: 'vite',
  build: 'vite build',
  preview: 'vite preview --host 127.0.0.1 --port 4173',
  'tauri:dev': 'tauri dev',
  'tauri:build': 'tauri build',
  test: 'node --test tests/*.test.mjs',
  'test:browser:contract': 'node tests/e2e/run-browser-tests.mjs --contract',
  'test:browser': 'node tests/e2e/run-browser-tests.mjs --app',
  check: 'npm run test && npm run test:browser:contract && npm run build && npm run test:browser'
});

const architectureScripts = Object.freeze({
  'verify:architecture': 'node scripts/verify-architecture.mjs',
  'verify:no-legacy-runtime': 'node scripts/verify-no-legacy-runtime.mjs',
  'verify:generated-files': 'node scripts/verify-generated-files.mjs',
  'verify:readme-record': 'node scripts/verify-readme-record.mjs'
});

test('existing package script commands retain their exact semantics', () => {
  for (const [name, command] of Object.entries(preservedScripts)) {
    assert.equal(scripts[name], command, `${name} command changed`);
  }
});

test('architecture package scripts map directly to committed local entrypoints', async () => {
  for (const [name, command] of Object.entries(architectureScripts)) {
    assert.equal(scripts[name], command, `${name} command does not match its stable entrypoint`);
    const [, relativePath] = command.split(' ');
    await access(resolve(repositoryRoot, relativePath));
  }
});

test('architecture package scripts do not depend on builds, artifacts, package installation, or networking', () => {
  const forbidden = /(?:^|[\s;&|])(?:npm|npx|pnpm|yarn|vite|curl|wget|git)\b|\b(?:build|dist|target|https?|fetch)\b/i;
  for (const [name, command] of Object.entries(architectureScripts)) {
    assert.doesNotMatch(command, forbidden, `${name} introduces a forbidden dependency`);
    assert.doesNotMatch(command, /&&|\|\||[;|]/, `${name} must remain a single local Node entrypoint`);
  }
});

test('all architecture package scripts execute successfully before any build step', () => {
  for (const name of Object.keys(architectureScripts)) {
    const npmArgs = ['run', '--silent', name, '--', `--root=${repositoryRoot}`];
    const npmCliPath = process.env.npm_execpath;
    const executable = npmCliPath ? process.execPath : 'npm';
    const args = npmCliPath ? [npmCliPath, ...npmArgs] : npmArgs;

    assert.ok(
      npmCliPath || process.platform !== 'win32',
      'Windows architecture script verification must run through npm so npm_execpath is available'
    );

    const result = spawnSync(executable, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' }
    });
    assert.equal(
      result.status,
      0,
      `${name} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.match(result.stdout, /\[verify-[^\]]+\] passed\./, `${name} did not report a passing result`);
  }
});
