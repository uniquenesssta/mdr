import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const readText = path => readFile(path, 'utf8');
const missing = path => access(path).then(() => false, () => true);

test('Atomic Task 2.11 removes old-shell production entry names and keeps one compatibility public port', async () => {
  assert.equal(await missing('public/compatibility/current-shell.html'), true);
  assert.equal(await missing('src/ui/compatibility/mount-current-shell.js'), true);
  const [entry, publicEntry, port] = await Promise.all([
    readText('src/bootstrap/module-entry.js'),
    readText('src/ui/compatibility/index.js'),
    readText('src/ui/compatibility/business-content-port.js')
  ]);
  assert.match(entry, /import \{ createUI \} from '\.\.\/ui\/create-ui\.js'/);
  assert.match(entry, /createCompatibilityBusinessContentPort/);
  assert.match(entry, /ui = createUI\(root\)[\s\S]*contentPort = createCompatibilityBusinessContentPort\(root, ui\)[\s\S]*contentPort\.mount\(markup\)/);
  assert.doesNotMatch(entry, /current-shell|mountCurrentShell/);
  assert.match(publicEntry, /business-content-port\.js/);
  assert.doesNotMatch(port, /createUI|app-shell-view|shell\//);
});

test('temporary business content contains only slot templates and no shell DOM authority', async () => {
  const markup = await readText('public/compatibility/business-content.html');
  assert.deepEqual([...markup.matchAll(/<template\s+data-compat-slot="([^"]+)">/g)].map(match => match[1]), [
    'menu', 'toolbar', 'sidebar', 'editor', 'preview', 'status', 'overlay', 'ports'
  ]);
  assert.doesNotMatch(markup, /<html\b|<head\b|<body\b|<script\b/i);
  assert.doesNotMatch(markup, /<div class="app">|<nav class="menu-bar"|<div class="workspace"|<aside class="sidebar"|<div class="statusbar"/);
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
