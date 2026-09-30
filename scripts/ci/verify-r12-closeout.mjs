// Aggregate same-run Windows evidence; production tests remain in their existing jobs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assessDependencyAudit } from './run-windows-dependency-audit.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const requiredJobs = ['frontend', 'rust', 'native-boundary', 'repository-tests', 'dependency-advisories', 'webview-baseline'];
const surfaces = ['preview-markdown', 'preview-full-html', 'preview-block-html', 'hybrid-html-widget', 'preview-virtual-block'];
const closedIds = ['A01', 'A02', 'A03', 'A06', 'A07', 'A08', 'A09', 'A10'];

export function assessCloseout(input) {
  const { commit, jobResults, policy, dependencyPolicy, inventory, currentTests, suites, dependency, webview, rustLog } = input;
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(jobResults).sort(), [...requiredJobs].sort(), 'Missing or unexpected cumulative job.');
  for (const job of requiredJobs) assert.equal(jobResults[job].result, 'success', job + ': failed/skipped/cancelled blocks closeout.');
  assert.deepEqual(policy.requiredJobs, requiredJobs);
  assert.equal(dependencyPolicy.accepted, true, 'R12-23 prerequisite not accepted.');
  assert.equal(dependencyPolicy.a10Closed, true);
  assert.equal(policy.baselineCommit, dependencyPolicy.acceptance.commit);
  assert.deepEqual(policy.records.map(item => item.id).sort(), Array.from({ length: 10 }, (_, i) => 'A' + String(i + 1).padStart(2, '0')));
  for (const id of closedIds) {
    const record = policy.records.find(item => item.id === id);
    assert.equal(record.status, 'closed-current-scope', id + ': unresolved current risk.');
    assert.match(record.repairCommit, /^[a-f0-9]{40}$/);
    assert.ok(record.record && record.regressionRun);
  }
  for (const [id, receiver] of [['A04', ['15.4', '15.7']], ['A05', ['R13-S01']]]) {
    const record = policy.records.find(item => item.id === id);
    assert.equal(record.status, 'deferred-not-fixed', id + ': transfer must not be called fixed.');
    assert.equal(record.fixed, false);
    assert.deepEqual(record.receiver, receiver);
    for (const key of ['risk', 'deadline', 'acceptance', 'stopCondition', 'reviewConclusion', 'record']) assert.ok(record[key], id + ': missing ' + key);
  }
  assert.ok(inventory.length > 0 && suites.length > 0, 'Empty Node evidence.');
  assert.deepEqual(inventory, [...new Set(currentTests)].sort(), 'Recursive inventory differs from tracked tests.');
  const directories = Map.groupBy(inventory, path => path.slice(0, path.lastIndexOf('/')));
  assert.deepEqual(suites.map(item => item.directory).sort(), [...directories.keys()].sort(), 'Missing/duplicate Node directory result.');
  for (const result of suites) {
    assert.equal(result.files, directories.get(result.directory).length);
    assert.equal(result.status, 0, result.directory + ': Node failure.');
    assert.equal(result.error, null);
  }
  assert.equal(dependency.commit, commit, 'Stale dependency evidence.');
  assert.equal(dependency.target, 'x86_64-pc-windows-msvc');
  assert.equal(dependency.accepted, true);
  assert.equal(dependency.databaseCommit, dependencyPolicy.databaseCommit);
  assert.equal(dependency.assessment.vulnerabilities, 0);
  assert.equal(webview.commit, commit, 'Stale WebView evidence.');
  assert.equal(webview.acceptedSecurityBoundary, true);
  assert.equal(webview.phase, 'post-remediation-security-regression');
  assert.equal(webview.driverProvider, 'embedded-isolated-host');
  assert.equal(webview.environment.nativeCanaryControlPassed, true);
  assert.equal(webview.environment.globalTauriPublished, false);
  assert.equal(webview.cspControl.executed, false);
  assert.ok(webview.cspControl.violations.includes('script-src-attr'));
  assert.deepEqual(webview.surfaces.map(item => item.surface).sort(), [...surfaces].sort(), 'Missing/duplicate WebView surface.');
  for (const surface of webview.surfaces) assert.equal(surface.securityVerdict, 'attack-fixtures-blocked; normal-content-verification-required');
  assert.deepEqual(webview.normalContent.map(item => item.mode).sort(), ['both', 'hybrid']);
  for (const result of webview.normalContent) for (const key of ['markdown', 'image', 'math', 'mermaid', 'safeHtml']) assert.equal(result[key], true);
  const rustResults = [...rustLog.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
  assert.ok(rustResults.length >= 4, 'Incomplete full Rust result.');
  for (const result of rustResults) assert.equal(Number(result[2]) + Number(result[3]), 0, 'Rust failure/ignored tests.');
  assert.doesNotMatch(rustLog, /test result: FAILED/);
  const rustPassed = rustResults.reduce((sum, result) => sum + Number(result[1]), 0);
  assert.ok(rustPassed > 0);
  return { rustPassed, nodeTestFiles: inventory.length, nodeDirectories: suites.length, closedCurrentScope: closedIds, deferredNotFixed: ['A04', 'A05'] };
}

async function runCloseout() {
  assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_SHA && process.env.R12_JOB_RESULTS);
  const outputRoot = join(process.env.RUNNER_TEMP, 'r12-24');
  await mkdir(outputRoot, { recursive: true });
  const evidence = { schemaVersion: 1, commit: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, accepted: false, eligibleForR13: false };
  const command = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  const read = path => readFile(path, 'utf8');
  const json = async path => JSON.parse(await read(path));
  const artifactRoot = join(process.env.RUNNER_TEMP, 'r12-24-inputs');
  const artifact = prefix => join(artifactRoot, prefix + '-' + evidence.commit + '-' + evidence.attempt);
  try {
    assert.equal(process.platform, 'win32', 'Closeout must execute on Windows.');
    assert.equal(command(['rev-parse', 'HEAD']), evidence.commit);
    const policy = await json(join(repository, 'docs/audit/r12-24-closeout.json'));
    const dependencyPolicy = await json(join(repository, 'docs/audit/r12-23-dependency-advisories.json'));
    command(['merge-base', '--is-ancestor', policy.baselineCommit, 'HEAD']);
    for (const source of policy.reviewedSources) assert.equal(command(['hash-object', source.path]), source.blobSha, source.path + ': risk review became stale.');
    const stage = await read(join(repository, 'docs/markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md'));
    for (let task = 1; task <= 23; task++) assert.ok(stage.includes('- [x] 12.' + task + ' '), 'R12 prerequisite ' + task + ' is not accepted.');
    const r13 = await read(join(repository, policy.records.find(item => item.id === 'A05').record));
    const r15 = await read(join(repository, policy.records.find(item => item.id === 'A04').record));
    for (const marker of ['### R13-S01', '13.9', '策略决策', 'Windows 验收', '退出']) assert.ok(r13.includes(marker), 'Missing R13 handoff: ' + marker);
    for (const marker of ['### 15.4', '### 15.7', 'A04 必做', '完成标准', '50ms']) assert.ok(r15.includes(marker), 'Missing R15 handoff: ' + marker);
    const frontend = artifact('r12-14-frontend');
    const rust = artifact('r12-14-rust');
    const native = artifact('r12-14-native-windows-latest');
    const dependencyRoot = artifact('r12-23-dependencies');
    const webviewRoot = artifact('r12-22-webview-verification');
    for (const directory of [frontend, rust, native, dependencyRoot, webviewRoot]) assert.equal((await read(join(directory, 'commit.txt'))).trim(), evidence.commit, 'Stale artifact source.');
    for (const name of ['architecture.log', 'no-legacy.log', 'generated.log', 'readme.log', 'npm-audit.log', 'build.log']) assert.ok((await read(join(frontend, name))).trim(), 'Missing frontend evidence: ' + name);
    for (const name of ['safe-user-writer.log', 'save-commit-rust.log', 'lifecycle-after.log', 'release-lifecycle.log', 'writer-after.log', 'release-writer.log', 'log-redaction.log', 'frontend-payload.log', 'redaction-pipeline.log', 'web-client-unit.log', 'web-http.log', 'clippy.log', 'cargo-check.log']) assert.ok((await read(join(rust, name))).trim(), 'Missing Rust evidence: ' + name);
    for (const name of ['compile.log', 'signature.log']) assert.ok((await read(join(native, name))).trim());
    for (const name of ['browser-contract.log', 'browser-app.log']) {
      const match = (await read(join(frontend, name))).match(/Browser tests: (\d+), passed: (\d+), failed: (\d+)/);
      assert.ok(match && Number(match[1]) > 0 && match[1] === match[2] && Number(match[3]) === 0, 'Browser evidence failed: ' + name);
    }
    const lockText = await read(join(repository, 'src-tauri/Cargo.lock'));
    const dependency = await json(join(dependencyRoot, 'dependency-verification.json'));
    assert.equal(dependency.lockSha256, createHash('sha256').update(lockText).digest('hex'));
    const rawAssessment = assessDependencyAudit({ audit: await json(join(dependencyRoot, 'cargo-audit.json')), metadata: await json(join(dependencyRoot, 'windows-metadata.json')), lockText, policy: dependencyPolicy });
    assert.deepEqual(rawAssessment, dependency.assessment, 'Dependency raw reports contradict the summary.');
    const nodeRoot = artifact('repository-tests-windows');
    evidence.results = assessCloseout({
      commit: evidence.commit, jobResults: JSON.parse(process.env.R12_JOB_RESULTS), policy, dependencyPolicy, dependency,
      inventory: await json(join(nodeRoot, 'test-inventory.json')),
      currentTests: command(['ls-files', '-z', 'tests']).split('\0').filter(path => path.endsWith('.test.mjs')),
      suites: await json(join(nodeRoot, 'suite-results.json')),
      webview: await json(join(webviewRoot, 'render-boundary-verification.json')),
      rustLog: await read(join(rust, 'rust-tests.log'))
    });
    evidence.handoffs = policy.records.filter(item => item.status === 'deferred-not-fixed');
    evidence.reviewedSources = policy.reviewedSources;
    evidence.scopeLimits = policy.scopeLimits;
    evidence.status = 'same-commit Windows revalidation passed; formal repository acceptance must reference this run';
    evidence.accepted = true;
    evidence.eligibleForR13 = true;
  } catch (error) {
    evidence.status = 'failed; R12 and R13 admission remain blocked';
    evidence.error = error.message;
    process.exitCode = 1;
    console.error(error.stack || error);
  } finally {
    await writeFile(join(outputRoot, 'closeout-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log('R12-24 closeout: ' + evidence.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCloseout();
