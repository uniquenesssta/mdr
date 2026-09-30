import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assessDependencyAudit } from '../scripts/ci/run-windows-dependency-audit.mjs';

const policy = JSON.parse(await readFile(new URL('../docs/audit/r12-23-dependency-advisories.json', import.meta.url), 'utf8'));
function fixture() {
  const packages = [
    { id: 'root', name: 'markdown-editor', version: '1.0.0', rust_version: '1.88' },
    { id: 'tls', name: 'rustls', version: '0.23.45', rust_version: '1.71' },
    { id: 'glib', name: 'glib', version: '0.18.5', rust_version: '1.70' }
  ];
  return {
    policy,
    lockText: Object.entries(policy.expectedLockVersions).map(([name, version]) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`).join('\n'),
    audit: { settings: { ignore: [], target_os: [], target_arch: [] }, vulnerabilities: { list: [], count: 0, found: false }, warnings: {} },
    metadata: { packages, resolve: { root: 'root', nodes: [
      { id: 'root', deps: [{ name: 'rustls', pkg: 'tls', dep_kinds: [{ kind: null, target: null }] }], features: [] },
      { id: 'tls', deps: [], features: ['ring', 'std', 'tls12'] },
      { id: 'glib', deps: [], features: [] }
    ] } }
  };
}
const warning = (id, name, version) => ({ advisory: { id }, package: { name, version } });

test('fixed lock with live Windows TLS graph passes and retains feature evidence', () => {
  const result = assessDependencyAudit(fixture());
  assert.equal(result.vulnerabilities, 0);
  assert.deepEqual(result.affectedPackages.find(item => item.name === 'rustls').windowsPaths, [['markdown-editor@1.0.0', 'rustls@0.23.45']]);
});

test('a reported vulnerability or ignored advisory blocks acceptance', () => {
  const input = fixture();
  input.audit.vulnerabilities = { list: [warning('RUSTSEC-2026-0285', 'rustls', '0.23.41')], count: 1, found: true };
  assert.throws(() => assessDependencyAudit(input), /Unresolved RustSec/);
  input.audit = fixture().audit;
  input.audit.settings.ignore = ['RUSTSEC-2026-0285'];
  assert.throws(() => assessDependencyAudit(input), /Ignored advisories/);
});

test('missing or contradictory scanner data cannot become a green result', () => {
  const input = fixture();
  delete input.audit.vulnerabilities.list;
  assert.throws(() => assessDependencyAudit(input), /Missing RustSec/);
  input.audit = fixture().audit;
  input.audit.vulnerabilities.found = true;
  assert.throws(() => assessDependencyAudit(input));
});

test('glib is excluded only when its exact warning is absent from Windows normal/build paths', () => {
  const input = fixture();
  input.audit.warnings.unsound = [warning('RUSTSEC-2024-0429', 'glib', '0.18.5')];
  assert.equal(assessDependencyAudit(input).warnings[0].disposition, 'not in Windows normal/build graph');
  input.metadata.resolve.nodes[0].deps.push({ pkg: 'glib', dep_kinds: [{ kind: 'build', target: null }] });
  assert.throws(() => assessDependencyAudit(input), /glib unsound API entered/);
});

test('dev-only edges do not prove a Windows production path', () => {
  const input = fixture();
  input.metadata.resolve.nodes[0].deps[0].dep_kinds[0].kind = 'dev';
  assert.throws(() => assessDependencyAudit(input), /Rustls must remain/);
});

test('known unmaintained warnings retain disposition but new notices are never silently accepted', () => {
  const input = fixture();
  const reviewed = policy.reviewedUnmaintained[0];
  input.audit.warnings.unmaintained = [warning(reviewed.id, reviewed.package, reviewed.version)];
  assert.equal(assessDependencyAudit(input).warnings.length, 1);
  input.audit.warnings.unmaintained.push(warning('RUSTSEC-2099-9999', reviewed.package, reviewed.version));
  assert.throws(() => assessDependencyAudit(input), /Unreviewed maintenance/);
  input.audit.warnings = { yanked: [warning(null, 'rustls', '0.23.45')] };
  assert.throws(() => assessDependencyAudit(input), /Unreviewed warning/);
});

test('compiler incompatibility and rollback to vulnerable lock versions block acceptance', () => {
  const input = fixture();
  input.metadata.packages[1].rust_version = '1.89.0';
  assert.throws(() => assessDependencyAudit(input), /exceeds Rust/);
  input.metadata = fixture().metadata;
  input.lockText = input.lockText.replace('0.23.45', '0.23.41');
  assert.throws(() => assessDependencyAudit(input), /rustls: repaired lock/);
});

test('Windows CI keeps official checksum, exact database, TLS behavior and all cumulative gates', async () => {
  const workflow = await readFile(new URL('../.github/workflows/r12-14.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run-windows-dependency-audit\.mjs/);
  assert.match(workflow, /node --test tests\/stage-12-dependency-advisories\.test\.mjs/);
  assert.match(workflow, /if: always\(\)/);
  for (const gate of ['Full Node regression', 'Full Rust tests', 'Full Clippy warnings-denied gate', 'Built-app browser regression', 'run-render-boundary-probe.mjs --verify']) assert.ok(workflow.includes(gate), gate);
  const runner = await readFile(new URL('../scripts/ci/run-windows-dependency-audit.mjs', import.meta.url), 'utf8');
  assert.match(runner, /process\.platform, 'win32'/);
  assert.match(runner, /windowsSha256/);
  assert.match(runner, /'--locked'.*'--filter-platform'/);
  assert.doesNotMatch(runner, /'--ignore'|'--no-yanked'/);
  const client = await readFile(new URL('../src-tauri/src/web_fetch/client.rs', import.meta.url), 'utf8');
  assert.match(client, /TLS 1\.3 handshake/);
  assert.match(client, /production must reject the untrusted CA/);
  assert.equal((client.match(/#\[test\]/g) || []).length, 2);
});
