import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const historicalWorkflows = [
  'stage-00-baseline', 'stage-01-atomic', 'stage-02-atomic', 'stage-03-atomic',
  'stage-03-windows-window', 'stage-04-atomic', 'stage-05-atomic', 'stage-06-atomic',
  'stage-07-atomic', 'r10-11', 'r10-12', 'r11-03', 'r11-14', 'r11-15',
    'r11-16', 'r12-01', 'r12-02', 'r12-03'
];

test('completed-stage workflows remain manually runnable but never rerun on later pull-request synchronization', async () => {
  const sources = await Promise.all(historicalWorkflows.map(name =>
    readFile(`.github/workflows/${name}.yml`, 'utf8')
  ));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /^\s*workflow_dispatch:\s*$/m, `${historicalWorkflows[index]} stays manually runnable`);
    assert.doesNotMatch(source, /^\s*pull_request:\s*$/m, `${historicalWorkflows[index]} must not validate later PRs`);
  }
});

test('R12-04 is the automatic Stage branch validation authority for workflow changes', async () => {
  const workflow = await readFile('.github/workflows/r12-04.yml', 'utf8');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[agent\/r12-stage\]/);
  assert.match(workflow, /- '\.github\/workflows\/\*\*'/);
  assert.doesNotMatch(workflow, /^\s*pull_request:\s*$/m);
});
