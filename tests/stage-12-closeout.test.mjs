import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assessCloseout, assessNativeBoundary } from '../scripts/ci/verify-r12-closeout.mjs';

const policy = JSON.parse(await readFile(new URL('../docs/audit/r12-24-closeout.json', import.meta.url), 'utf8'));
const dependencyPolicy = JSON.parse(await readFile(new URL('../docs/audit/r12-23-dependency-advisories.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(40);
function fixture() {
  return {
    commit: sha, policy: structuredClone(policy), dependencyPolicy: structuredClone(dependencyPolicy),
    jobResults: Object.fromEntries(policy.requiredJobs.map(job => [job, { result: 'success' }])),
    inventory: ['tests/a.test.mjs', 'tests/nested/b.test.mjs'],
    currentTests: ['tests/nested/b.test.mjs', 'tests/a.test.mjs'],
    suites: [{ directory: 'tests', files: 1, status: 0, error: null }, { directory: 'tests/nested', files: 1, status: 0, error: null }],
    dependency: { commit: sha, target: 'x86_64-pc-windows-msvc', accepted: true, databaseCommit: dependencyPolicy.databaseCommit, assessment: { vulnerabilities: 0 } },
    webview: {
      commit: sha, acceptedSecurityBoundary: true, phase: 'post-remediation-security-regression', driverProvider: 'embedded-isolated-host',
      environment: { nativeCanaryControlPassed: true, globalTauriPublished: false },
      cspControl: { executed: false, violations: ['script-src-attr'] },
      surfaces: ['preview-markdown', 'preview-full-html', 'preview-block-html', 'hybrid-html-widget', 'preview-virtual-block'].map(surface => ({ surface, securityVerdict: 'attack-fixtures-blocked; normal-content-verification-required' })),
      normalContent: ['both', 'hybrid'].map(mode => ({ mode, markdown: true, image: true, math: true, mermaid: true, safeHtml: true }))
    },
    rustLog: [256, 5, 1, 6].map(count => 'test result: ok. ' + count + ' passed; 0 failed; 0 ignored').join('\n')
  };
}

test('all same-commit evidence passes while A04/A05 remain explicitly unfixed', () => {
  const result = assessCloseout(fixture());
  assert.equal(result.rustPassed, 268);
  assert.equal(result.nodeTestFiles, 2);
  assert.deepEqual(result.deferredNotFixed, ['A04', 'A05']);
});

test('failure, cancellation, skip and missing jobs block admission', () => {
  for (const status of ['failure', 'cancelled', 'skipped']) {
    const input = fixture();
    input.jobResults.rust.result = status;
    assert.throws(() => assessCloseout(input), /blocks closeout/);
  }
  const input = fixture();
  delete input.jobResults.frontend;
  assert.throws(() => assessCloseout(input), /Missing or unexpected/);
});

test('stale commit, wrong target and unaccepted dependency results block admission', () => {
  for (const change of [
    input => { input.dependency.commit = 'b'.repeat(40); },
    input => { input.webview.commit = 'b'.repeat(40); },
    input => { input.dependency.target = 'other-target'; },
    input => { input.dependency.accepted = false; },
    input => { input.dependency.assessment.vulnerabilities = 1; },
    input => { input.dependencyPolicy.accepted = false; }
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => assessCloseout(input));
  }
});

test('recursive inventory omissions, duplicate suites and failed directories block admission', () => {
  for (const change of [
    input => input.inventory.pop(),
    input => input.suites.pop(),
    input => input.suites.push(input.suites[0]),
    input => { input.suites[0].status = 1; },
    input => { input.suites[0].files = 0; },
    input => { input.suites[0].error = 'spawn failed'; }
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => assessCloseout(input));
  }
});

test('missing virtual surface, failed CSP or normal content cannot be concealed by accepted flag', () => {
  for (const change of [
    input => input.webview.surfaces.pop(),
    input => { input.webview.surfaces[0].securityVerdict = 'pending'; },
    input => { input.webview.cspControl.executed = true; },
    input => { input.webview.cspControl.violations = []; },
    input => { input.webview.environment.nativeCanaryControlPassed = false; },
    input => { input.webview.normalContent[1].math = false; }
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => assessCloseout(input));
  }
});

test('unfixed transfer, removed receiver and reopened current risk block admission', () => {
  for (const change of [
    input => { input.policy.records.find(item => item.id === 'A04').fixed = true; },
    input => { input.policy.records.find(item => item.id === 'A05').receiver = []; },
    input => { input.policy.records.find(item => item.id === 'A04').stopCondition = ''; },
    input => { input.policy.records.find(item => item.id === 'A01').status = 'open'; }
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => assessCloseout(input));
  }
});

test('failed, ignored and incomplete full Rust results block admission', () => {
  for (const log of ['test result: FAILED', fixture().rustLog.replace('0 ignored', '1 ignored'), fixture().rustLog.split('\n')[0]]) {
    const input = fixture(); input.rustLog = log;
    assert.throws(() => assessCloseout(input));
  }
});

test('silent successful native compilation is valid only with a passing signature test', () => {
  assert.doesNotThrow(() => assessNativeBoundary({ compileLog: '', signatureLog: 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured' }));
  for (const signatureLog of ['', 'test result: FAILED. 0 passed; 1 failed', 'test result: ok. 0 passed; 0 failed; 1 ignored']) {
    assert.throws(() => assessNativeBoundary({ compileLog: '', signatureLog }));
  }
  assert.throws(() => assessNativeBoundary({ signatureLog: 'test result: ok. 1 passed; 0 failed; 0 ignored' }), /Missing native compilation/);
});
