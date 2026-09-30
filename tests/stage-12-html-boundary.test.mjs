import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRenderBoundaryProbe, PROBE_SURFACES } from './e2e/windows/render-boundary-probe.mjs';

test('R12-22 probe covers both production sinks and full/block Preview paths with harmless markers', () => {
  assert.deepEqual(PROBE_SURFACES, ['preview-markdown', 'preview-full-html', 'preview-block-html', 'hybrid-html-widget']);
  const fixture = createRenderBoundaryProbe('r12-preview-markdown', 'http://127.0.0.1:4592');
  for (const marker of ['onerror', 'onclick', 'javascript:', 'onload', 'srcdoc', '<object', '<embed', '<style', 'read_dropped_file']) {
    assert.ok(fixture.html.includes(marker), marker);
  }
  assert.match(fixture.markdown, /^# R12 baseline\n\n<div/);
  assert.doesNotMatch(fixture.html, /write_local|fetch_url|open_external|document\.cookie|localStorage|navigator\.sendBeacon/);
  assert.throws(() => createRenderBoundaryProbe('r12-probe', 'https://example.com'), /owned loopback/);
  assert.throws(() => createRenderBoundaryProbe('x" onclick="x', 'http://127.0.0.1:4592'), /Invalid probe id/);
});

test('R12-22 baseline requires real native IPC, own canary, exact SHA and keeps A03 open', async () => {
  const runner = await readFile('tests/e2e/windows/run-render-boundary-probe.mjs', 'utf8');
  assert.match(runner, /process\.platform !== 'win32'/);
  assert.match(runner, /withEmbeddedSession/);
  assert.match(runner, /window\.__TAURI_INTERNALS__\.invoke\('read_dropped_file', \{ path \}\)/);
  assert.match(runner, /nativeCanaryControlPassed, true/);
  assert.match(runner, /mkdtemp\(join\(resolve\(process\.env\.RUNNER_TEMP\)/);
  assert.match(runner, /acceptedSecurityBoundary: false/);
  assert.match(runner, /await persist\(\)/);
  assert.match(runner, /saveScreenshot/);
  assert.match(runner, /await rm\(canaryRoot, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(runner, /createCDP|__markdownEditorE2E|setDocumentContent|__TAURI_INTERNALS__\s*=/);
});

test('R12-22 automatic Windows baseline preserves cumulative gates and production locked dependencies', async () => {
  const [workflow, host] = await Promise.all([
    readFile('.github/workflows/r12-14.yml', 'utf8'),
    readFile('scripts/stage-03/windows/prepare-embedded-driver-host.ps1', 'utf8')
  ]);
  const job = workflow.split('  webview-baseline:')[1].split('  repository-tests:')[0];
  assert.match(job, /runs-on: windows-2025/);
  assert.match(job, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(job, /selenium-webdriver@4\.34\.0/);
  assert.match(job, /-PreserveProductionLock/);
  assert.match(job, /cargo build --locked/);
  assert.match(job, /run-render-boundary-probe\.mjs/);
  assert.match(job, /if: always\(\)/);
  assert.match(host, /cargo metadata --format-version 1 --manifest-path/);
  assert.match(host, /hostIdentities -cnotcontains \$identity/);
  assert.match(host, /changed a production locked dependency/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  for (const preserved of ['Full Node regression', 'Full Rust tests', 'Full Clippy warnings-denied gate', 'Built-app browser regression', 'Run every tracked Node test']) {
    assert.ok(workflow.includes(preserved), preserved);
  }
});

test('R12-22 Virtual Preview consumes canonical leaf responsibilities without importing its own public entry', async () => {
  const source = await readFile('src/features/preview/virtual/virtual-preview-controller.js', 'utf8');
  assert.match(source, /from '\.\.\/pipeline\/preview-thresholds\.js'/);
  assert.match(source, /from '\.\.\/render\/virtual-window\/virtual-window-controller\.js'/);
  assert.match(source, /class VirtualPreviewController extends VirtualWindowController/);
  assert.doesNotMatch(source, /from '\.\.\/index\.js'/);
});

test('R12-22 runner-derived log path is set during execution, never in job-level env', async () => {
  const workflow = await readFile('.github/workflows/r12-14.yml', 'utf8');
  const envBlocks = [...workflow.matchAll(/^    env:\n((?:      [^\n]*\n)*)/gm)].map(match => match[1]);
  assert.ok(envBlocks.some(block => block.includes('MARKDOWN_EDITOR_BINARY:')), 'Native job env must be inspected.');
  for (const block of envBlocks) {
    for (const expression of block.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      assert.doesNotMatch(expression[1], /\b(?:runner|steps|job|env)\s*(?:\.|\[)/, 'Unavailable job-level env context.');
    }
  }
  const job = workflow.split('  webview-baseline:')[1].split('  repository-tests:')[0];
  const setup = job.split('      - name: Record exact source and install pinned Rust')[1]
    .split('      - name: Install locked frontend')[0];
  assert.ok(setup.includes("printf 'MARKDOWN_EDITOR_LOG_DIR=%s/r12-22-webview/performance-logs\\n' \"$RUNNER_TEMP\" >> \"$GITHUB_ENV\""));
  assert.ok(job.indexOf('"$GITHUB_ENV"') < job.indexOf('run-render-boundary-probe.mjs'), 'Path must be exported before launching the native app.');
});
