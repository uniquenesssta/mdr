import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const historicalWorkflows = [
  'stage-00-baseline', 'stage-01-atomic', 'stage-02-atomic', 'stage-03-atomic',
  'stage-03-windows-window', 'stage-04-atomic', 'stage-05-atomic', 'stage-06-atomic',
  'stage-07-atomic', 'r10-11', 'r10-12', 'r11-03', 'r11-14', 'r11-15',
  'r11-16', 'r12-01', 'r12-02', 'r12-03', 'r12-04', 'r12-05', 'r12-06', 'r12-07', 'r12-08', 'r12-09', 'r12-10', 'r12-11', 'r12-12', 'r12-13'
];

test('historical workflow definitions retain their dispatch syntax and do not validate later PRs', async () => {
  const sources = await Promise.all(historicalWorkflows.map(name =>
    readFile(`.github/workflows/${name}.yml`, 'utf8')
  ));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /^\s*workflow_dispatch:\s*$/m, `${historicalWorkflows[index]} retains historical dispatch syntax`);
    assert.doesNotMatch(source, /^\s*pull_request:\s*$/m, `${historicalWorkflows[index]} must not validate later PRs`);
  }
});

test('the existing Windows workflow follows the current R14 stage branch for workflow changes', async () => {
  const workflow = await readFile('.github/workflows/r12-14.yml', 'utf8');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[agent\/r14-stage\]/);
  assert.match(workflow, /tests\/stage-14-export-characterization\.test\.mjs/);
  assert.match(workflow, /tests\/stage-14-export-request\.test\.mjs/);
  assert.match(workflow, /tests\/stage-14-export-task\.test\.mjs/);
  assert.match(workflow, /docs\/markdown-main-full-rewrite-taskbook-18-docs\/15-\*/);
  assert.match(workflow, /- '\.github\/workflows\/\*\*'/);
  assert.doesNotMatch(workflow, /^\s*pull_request:\s*$/m);
});


test('every enabled CI job targets Windows and obsolete non-Windows workflows are retired', async () => {
  for (const name of await readdir('.github/workflows')) {
    if (!name.endsWith('.yml')) continue;
    const source = await readFile(`.github/workflows/${name}`, 'utf8');
    const jobs = source.split('jobs:')[1].split(/(?=^  [\w-]+:\s*$)/m).filter(value => /^  [\w-]+:/m.test(value));
    assert.ok(jobs.length, `${name}: no jobs inspected`);
    const activeWorkflow = ['r12-14.yml', 'stage-03-windows-window.yml'].includes(name);
    for (const job of jobs) {
      if (!activeWorkflow) {
        assert.match(job, /^    if: \$\{\{ false \}\} # Retired:/m, `${name}: historical job can still schedule`);
      } else {
        assert.doesNotMatch(job, /^    if: \$\{\{ false/m, `${name}: active validation disabled`);
        if (/runs-on: \$\{\{ matrix.os \}\}/.test(job)) {
          assert.match(job, /os: \[windows-latest\]/);
        } else {
          assert.match(job, /runs-on: windows-(?:latest|2025)/);
        }
        assert.doesNotMatch(job, /ubuntu-|macos-|apt-get|xdg-utils/);
      }
    }
  }
});
