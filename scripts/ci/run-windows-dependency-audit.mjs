// Windows RustSec verification: official scanner, fixed database snapshot, target
// graph and explicit dispositions. No production dependency or ignored advisory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function assessDependencyAudit({ audit, metadata, lockText, policy }) {
  assert.deepEqual(audit.settings?.ignore, [], 'Ignored advisories cannot prove acceptance.');
  assert.deepEqual(audit.settings?.target_os, [], 'Scan the complete lockfile before Windows classification.');
  assert.deepEqual(audit.settings?.target_arch, []);
  assert.ok(Array.isArray(audit.vulnerabilities?.list), 'Missing RustSec vulnerability report.');
  assert.equal(audit.vulnerabilities.count, audit.vulnerabilities.list.length);
  assert.equal(audit.vulnerabilities.found, audit.vulnerabilities.list.length > 0);
  assert.equal(audit.vulnerabilities.count, 0, 'Unresolved RustSec vulnerabilities block acceptance.');
  assert.ok(audit.warnings && typeof audit.warnings === 'object');
  const locked = lockText.split(/^\[\[package\]\]\r?$/m).slice(1).map(block => ({
    name: /^name = "([^"]+)"\r?$/m.exec(block)?.[1],
    version: /^version = "([^"]+)"\r?$/m.exec(block)?.[1]
  }));
  assert.ok(locked.length && locked.every(item => item.name && item.version), 'Invalid Cargo lockfile.');
  for (const [name, version] of Object.entries(policy.expectedLockVersions)) {
    assert.deepEqual(locked.filter(item => item.name === name).map(item => item.version), [version], `${name}: repaired lock version changed.`);
  }

  const packages = new Map(metadata.packages.map(item => [item.id, item]));
  const nodes = new Map(metadata.resolve.nodes.map(item => [item.id, item]));
  const root = metadata.resolve.root;
  assert.equal(packages.get(root)?.name, 'markdown-editor', 'Expected production dependency root.');
  const paths = new Map([[root, [root]]]);
  const pending = [root];
  for (const id of pending) {
    const node = nodes.get(id);
    assert.ok(node, 'Missing resolved dependency node.');
    for (const dep of node.deps) {
      assert.ok(dep.dep_kinds.length && dep.dep_kinds.every(item => [null, 'build', 'dev'].includes(item.kind)));
      if (dep.dep_kinds.every(item => item.kind === 'dev') || paths.has(dep.pkg)) continue;
      assert.ok(packages.has(dep.pkg), 'Missing resolved dependency package.');
      paths.set(dep.pkg, [...paths.get(id), dep.pkg]);
      pending.push(dep.pkg);
    }
  }
  const versionParts = value => String(value).split('.').map(Number);
  const compiler = versionParts(policy.rustVersion);
  const withinCompiler = value => {
    const parts = versionParts(value);
    for (let i = 0; i < 3; i++) {
      if ((parts[i] || 0) !== (compiler[i] || 0)) return (parts[i] || 0) < (compiler[i] || 0);
    }
    return true;
  };
  for (const id of paths.keys()) {
    const item = packages.get(id);
    assert.ok(!item.rust_version || withinCompiler(item.rust_version), `${item.name} exceeds Rust ${policy.rustVersion}.`);
  }
  const pathFor = item => [...paths.keys()].filter(id => {
    const pkg = packages.get(id);
    return pkg.name === item.name && pkg.version === item.version;
  }).map(id => paths.get(id).map(key => `${packages.get(key).name}@${packages.get(key).version}`));
  const warnings = [];
  for (const [kind, entries] of Object.entries(audit.warnings)) {
    assert.ok(Array.isArray(entries));
    for (const finding of entries) {
      const id = finding.advisory?.id;
      const item = finding.package;
      const windowsPaths = pathFor(item);
      if (kind === 'unmaintained') {
        const reviewed = policy.reviewedUnmaintained.find(entry => entry.id === id && entry.package === item.name && entry.version === item.version);
        assert.ok(reviewed?.reason && reviewed?.recheck, `Unreviewed maintenance notice: ${id || item.name}.`);
        warnings.push({ id, package: item.name, version: item.version, kind, windowsPaths, disposition: 'maintenance notice; recorded for recheck' });
      } else {
        assert.equal(kind, 'unsound', `Unreviewed warning kind: ${kind}.`);
        assert.equal(id, 'RUSTSEC-2024-0429');
        assert.equal(item.name, 'glib');
        assert.equal(item.version, '0.18.5');
        assert.deepEqual(windowsPaths, [], 'glib unsound API entered the Windows graph.');
        warnings.push({ id, package: item.name, version: item.version, kind, windowsPaths, disposition: 'not in Windows normal/build graph' });
      }
    }
  }
  const affectedPackages = Object.keys(policy.expectedLockVersions).map(name => ({
    name, version: policy.expectedLockVersions[name],
    windowsPaths: pathFor({ name, version: policy.expectedLockVersions[name] }),
    features: metadata.resolve.nodes.filter(node => packages.get(node.id)?.name === name).map(node => node.features)
  }));
  assert.ok(affectedPackages.find(item => item.name === 'rustls')?.windowsPaths.length, 'Rustls must remain in the actual Windows request graph.');
  return { vulnerabilities: 0, warnings, affectedPackages, resolvedNormalAndBuildPackages: paths.size };
}

async function runWindowsAudit() {
  assert.equal(process.platform, 'win32', 'Dependency acceptance must run on Windows.');
  assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_SHA);
  const policy = JSON.parse(await readFile(join(repository, 'docs/audit/r12-23-dependency-advisories.json'), 'utf8'));
  assert.equal(policy.target, 'x86_64-pc-windows-msvc');
  assert.equal(policy.rustVersion, '1.88.0');
  const evidenceRoot = join(process.env.RUNNER_TEMP, 'r12-23');
  await mkdir(evidenceRoot, { recursive: true });
  const evidence = { commit: process.env.GITHUB_SHA, target: policy.target, status: 'running', accepted: false };
  const command = (file, args, options = {}) => execFileSync(file, args, {
    cwd: repository, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options
  });
  try {
    assert.equal(command('git', ['rev-parse', 'HEAD']).trim(), process.env.GITHUB_SHA);
    const archive = join(evidenceRoot, 'cargo-audit.zip');
    const response = await fetch(policy.scanner.windowsUrl, { signal: AbortSignal.timeout(120_000) });
    assert.ok(response.ok, `Scanner download failed: ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), policy.scanner.windowsSha256, 'Scanner release digest mismatch.');
    await writeFile(archive, bytes);
    const extract = join(evidenceRoot, 'extract.ps1');
    await writeFile(extract, 'param([string]$Archive,[string]$Destination)\n$ErrorActionPreference="Stop"\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n');
    command('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', extract, '-Archive', archive, '-Destination', join(evidenceRoot, 'tools')]);
    const scanner = join(evidenceRoot, 'tools', 'cargo-audit-x86_64-pc-windows-msvc-v0.22.2', 'cargo-audit.exe');
    evidence.scanner = command(scanner, ['--version']).trim();
    assert.match(evidence.scanner, /0\.22\.2/);
    const db = join(evidenceRoot, 'advisory-db');
    command('git', ['init', db]);
    command('git', ['-C', db, 'fetch', '--depth=1', 'https://github.com/RustSec/advisory-db.git', policy.databaseCommit]);
    command('git', ['-C', db, 'checkout', '--detach', 'FETCH_HEAD']);
    evidence.databaseCommit = command('git', ['-C', db, 'rev-parse', 'HEAD']).trim();
    assert.equal(evidence.databaseCommit, policy.databaseCommit);
    const lockText = await readFile(join(repository, 'src-tauri/Cargo.lock'), 'utf8');
    evidence.lockSha256 = createHash('sha256').update(lockText).digest('hex');
    const rawMetadata = command('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--format-version', '1', '--filter-platform', policy.target]);
    await writeFile(join(evidenceRoot, 'windows-metadata.json'), rawMetadata);
    await writeFile(join(evidenceRoot, 'windows-feature-tree.txt'), command('cargo', ['tree', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--target', policy.target, '--edges', 'normal,build,features']));
    const result = spawnSync(scanner, ['audit', '--file', 'src-tauri/Cargo.lock', '--db', db, '--no-fetch', '--json'], {
      cwd: repository, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
    });
    await writeFile(join(evidenceRoot, 'cargo-audit.json'), result.stdout || '');
    await writeFile(join(evidenceRoot, 'cargo-audit.stderr.log'), result.stderr || '');
    assert.ifError(result.error);
    assert.equal(result.status, 0, 'cargo-audit failed; retain its raw report and stop acceptance.');
    evidence.assessment = assessDependencyAudit({ audit: JSON.parse(result.stdout), metadata: JSON.parse(rawMetadata), lockText, policy });
    assert.equal(await readFile(join(repository, 'src-tauri/Cargo.lock'), 'utf8'), lockText, 'Audit changed the production lockfile.');
    evidence.status = 'Windows dependency advisory verification passed; cumulative gates still required';
    evidence.accepted = true;
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = error.message;
    process.exitCode = 1;
    console.error(error.stack || error);
  } finally {
    await writeFile(join(evidenceRoot, 'dependency-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(`R12-23 dependency verification: ${evidence.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runWindowsAudit();
