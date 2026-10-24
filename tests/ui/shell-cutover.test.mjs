import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const readText = path => readFile(path, 'utf8');
const missing = path => access(path).then(() => false, () => true);

test('R16-08 retires the temporary content mount and its modal bridge', async () => {
  for (const path of ['public/compatibility/current-shell.html','src/ui/compatibility/mount-current-shell.js',
    'public/compatibility/business-content.html','src/ui/compatibility/business-content-port.js',
    'src/ui/compatibility/mount-modal-shells.js','src/ui/compatibility/index.js']) assert.equal(await missing(path), true, path);
  const entry = await readText('src/bootstrap/module-entry.js');
  assert.match(entry, /createWorkspaceContent/);
  assert.doesNotMatch(entry, /compatibility-business-ports|createCompatibilityBusinessContentPort|fetchImpl/);
});

test('Stage 16 owns explicit deletion of every temporary compatibility mount artifact', async () => {
  const plan = await readText('docs/markdown-main-full-rewrite-taskbook-18-docs/17-阶段16-旧代码彻底清除与单实现切换.md');
  for (const path of [
    'public/compatibility/business-content.html',
    'src/ui/compatibility/business-content-port.js',
    'src/ui/compatibility/mount-modal-shells.js',
    'src/ui/compatibility/index.js'
  ]) assert.match(plan, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(plan, /16\.8 兼容路径清理/);
});

test('Stage 2 workflow verifies the shell cutover contract', async () => {
  const workflow = await readText('.github/workflows/stage-02-atomic.yml');
  assert.match(workflow, /Verify Atomic Task 2\.11 old shell cutover/);
  assert.match(workflow, /tests\/ui\/shell-cutover\.test\.mjs/);
});


test('Stage 2 evidence keeps its exact module scope while later stages add independent modules', async () => {
  const recorder = await readText('scripts/stage-02/record-ui-foundation-evidence.mjs');
  assert.match(recorder, /const stage2OwnedModulePaths = Object\.freeze/);
  assert.match(recorder, /stage2OwnedModulePaths\.length !== 69/);
  assert.match(recorder, /new Set\(stage2OwnedModulePaths\)\.size !== 69/);
  assert.match(recorder, /historicalStage2OwnedModulePaths\.length !== 72/);
  assert.match(recorder, /stage2OwnedModuleCount: stage2OwnedModulePaths\.length/);
  assert.match(recorder, /nextStage: hasStage3PlatformModules \? 'stage-03-started' : 'stage-03-not-started'/);
  assert.doesNotMatch(recorder, /moduleFixture\.modules\.length !== 139/);
});
