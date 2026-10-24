import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectTestSource, retiredSurfacePaths } from './support/test-cleanup-audit.mjs';

const ledger = JSON.parse(await readFile('docs/audit/r16-10-test-cleanup.json', 'utf8'));
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const baselineCache = new Map();
const baseline = path => {
  if (!baselineCache.has(path)) baselineCache.set(path, git(['show', ledger.sourceCommit + ':' + path]));
  return baselineCache.get(path);
};
const matches = (entry, path, name) => entry.path === path && entry.name === name;

test('R16-10 source inventory distinguishes active reads from negative fixtures, absence and frozen evidence', () => {
  const source = `
    import { readFile } from './support/application-surface-source.mjs';
    const dynamic = await import('./support/application-surface-source.mjs');
    readFile(new URL('../public/app/core.js', import.meta.url), 'utf8');
    read('public/' + 'app/bootstrap.js');
    readFileSync(\`public/app/events.js\`);
    readFile(resolve(root, 'public/app/editor-tools.js'), 'utf8');
    const malicious = { 'public/app/core.js': 'window.legacy = 1;' };
    access('public/app/core.js');
    execFileSync('git', ['show', 'baseline:public/app/core.js']);
    readFile('src/editor/hybrid/ranges.js');
    test('behavior', () => { assert.equal(actual(), expected); });
    test('late ' + reason, () => { assert.rejects(pending); });
    test.skip('skipped', () => {});
    test('disabled', { todo: true }, () => {});
  `;
  const result = inspectTestSource(source);
  assert.equal(result.readerImports.length, 2);
  assert.equal(result.readerImports[1].dynamic, true);
  assert.deepEqual(result.retiredReads.map(item => item.path), retiredSurfacePaths.slice(0, 2).concat('public/app/events.js', 'public/app/editor-tools.js'));
  assert.deepEqual(result.cases, ['behavior', "expression:'late ' + reason", 'disabled']);
  assert.deepEqual(result.caseContracts[0], { name: 'behavior', assertions: ['assert.equal(actual(), expected)'] });
  assert.equal(result.disabledCases.length, 2);
  assert.throws(() => inspectTestSource('test('), /Expression expected/);
});

test('R16-10 migration ledger is anchored to complete historical consumers and their Git blobs', () => {
  assert.match(ledger.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(git(['rev-parse', ledger.sourceCommit + ':' + ledger.sourceReader.path]), ledger.sourceReader.sourceBlob);
  const paths = git(['grep', '-l', '-z', '-e', 'application-surface-source\\.mjs', '-e', 'public/app/', ledger.sourceCommit, '--', 'tests'])
    .split('\0').filter(Boolean).map(path => path.slice(ledger.sourceCommit.length + 1)).filter(path => path.endsWith('.mjs'));
  const consumers = paths.filter(path => {
    const parsed = inspectTestSource(baseline(path));
    return parsed.readerImports.length || parsed.retiredReads.length;
  });
  assert.deepEqual(ledger.consumers.map(row => row.path), consumers);
  for (const row of ledger.consumers) {
    assert.equal(git(['rev-parse', ledger.sourceCommit + ':' + row.path]), row.sourceBlob, row.path);
    const original = inspectTestSource(baseline(row.path));
    assert.deepEqual(row.caseNames, original.cases, row.path);
    assert.deepEqual(row.sourceReads, original.retiredReads.map(({ path: retired, reader }) => ({
      retired, reader, currentOwners: ledger.retiredSurfaceOwners[retired]
    })), row.path);
  }
});

test('R16-10 migration retains declared scenarios and assertions except the explicit replacement ledger', async () => {
  // This detects accidental omissions; runtime suites remain the behavior oracle.
  for (const row of ledger.consumers) {
    const original = inspectTestSource(baseline(row.path));
    const current = inspectTestSource(await readFile(row.path, 'utf8'));
    const expected = original.caseContracts.filter(item => !ledger.retiredCases.some(entry => matches(entry, row.path, item.name)));
    assert.deepEqual(current.cases, expected.map(item => item.name), row.path);
    assert.deepEqual(current.disabledCases, original.disabledCases, row.path);
    for (const [index, contract] of expected.entries()) {
      if (!ledger.behaviorReplacements.some(entry => matches(entry, row.path, contract.name))) {
        assert.deepEqual(current.caseContracts[index].assertions, contract.assertions, row.path + ': ' + contract.name);
      }
    }
  }
  for (const retired of ledger.retiredCases) {
    assert.ok(retired.reason);
    const replacement = inspectTestSource(await readFile(retired.replacement.path, 'utf8'));
    assert.ok(replacement.cases.includes(retired.replacement.name));
  }
});

test('R16-10 tracked tests use current sources without retired reader imports or direct classic reads', async () => {
  await assert.rejects(access(ledger.sourceReader.path), { code: 'ENOENT' });
  const paths = git(['ls-files', '-z', 'tests']).split('\0').filter(path => path.endsWith('.mjs'));
  for (const path of paths) {
    const result = inspectTestSource(await readFile(path, 'utf8'));
    assert.deepEqual(result.readerImports, [], path);
    assert.deepEqual(result.retiredReads, [], path);
  }
});
