import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function read(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), 'utf8');
}

test('Node dependencies are prepared in the repository parent directory', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(
    packageJson.scripts?.['deps:prepare'],
    'node scripts/dependencies/prepare-parent-node-modules.mjs'
  );
  await access(resolve(repositoryRoot, 'scripts/dependencies/prepare-parent-node-modules.mjs'));

  const installer = await read('scripts/dependencies/prepare-parent-node-modules.mjs');
  assert.match(installer, /const dependencyRoot = resolve\(repositoryRoot, '\.\.'\)/);
  assert.match(installer, /const externalNodeModules = join\(dependencyRoot, 'node_modules'\)/);
  assert.match(installer, /Refusing to use project-local dependencies/);
  assert.match(installer, /const npmCliPath = process\.env\.npm_execpath/);
  assert.match(installer, /const executable = npmCliPath \? process\.execPath : 'npm'/);
  assert.doesNotMatch(installer, /spawnSync\(['"]npm\.cmd['"]/);
});

test('Vite and Cargo heavy caches are outside the repository root', async () => {
  const [viteConfig, cargoConfig] = await Promise.all([
    read('vite.config.js'),
    read('.cargo/config.toml')
  ]);
  assert.match(viteConfig, /cacheDir: '\.\.\/node_modules\/\.vite\/markdown-editor'/);
  assert.match(cargoConfig, /target-dir = "\.\.\/\.cargo-target\/markdown-editor"/);
});

test('all CI dependency installation paths use the parent dependency preparer', async () => {
  const workflowPaths = [
    '.github/workflows/stage-00-baseline.yml',
    '.github/workflows/stage-01-atomic.yml',
    '.github/workflows/stage-02-atomic.yml',
    '.github/workflows/stage-03-atomic.yml',
    '.github/workflows/stage-03-windows-window.yml'
  ];

  for (const workflowPath of workflowPaths) {
    const workflow = await read(workflowPath);
    assert.match(workflow, /npm run deps:prepare/, `${workflowPath} does not prepare parent dependencies`);
    assert.doesNotMatch(workflow, /^\s*run:\s*npm ci\s*$/m, `${workflowPath} still installs root node_modules`);
  }

  const windowsWorkflow = await read('.github/workflows/stage-03-windows-window.yml');
  assert.match(windowsWorkflow, /npm run deps:prepare -- --add selenium-webdriver@4\.34\.0/);
  assert.doesNotMatch(windowsWorkflow, /npm install --no-save --no-package-lock selenium-webdriver/);
});

test('Windows automation host and binaries use dedicated repository-parent paths', async () => {
  const [workflow, hostBuilder] = await Promise.all([
    read('.github/workflows/stage-03-windows-window.yml'),
    read('scripts/stage-03/windows/prepare-embedded-driver-host.ps1')
  ]);
  assert.match(workflow, /\.\.\/\.markdown-editor-windows-driver-host\/src-tauri\/Cargo\.toml/);
  assert.match(
    workflow,
    /\.\.\/\.cargo-target\/markdown-editor-windows-driver-host\/debug\/markdown-editor\.exe/
  );
  assert.match(
    workflow,
    /--target-dir \.\.\/\.cargo-target\/markdown-editor-windows-driver-host/
  );
  assert.match(workflow, /\.\.\/\.cargo-target\/markdown-editor\/release\/markdown-editor\.exe/);
  assert.match(hostBuilder, /\[string\]\$HostRoot = '\.\.\\\.markdown-editor-windows-driver-host'/);
  assert.match(hostBuilder, /\.cargo-target\\markdown-editor-windows-driver-host/);
  assert.doesNotMatch(
    hostBuilder,
    /\$cargoTargetPath = Join-Path \$repositoryParent '\.cargo-target\\markdown-editor'/
  );
});
