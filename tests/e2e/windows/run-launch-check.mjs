// Real Windows processes + WebView2. Only the separately identified test binary/profile are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { CdpConnection, CdpPage } from '../lib/cdp-browser.mjs';

const binary = resolve(process.argv[2]), artifacts = resolve(process.argv[3]);
assert.equal(process.platform, 'win32');
assert.ok((await readFile(binary)).includes(Buffer.from('com.markdowneditor.ui-frame-check')));
await mkdir(artifacts, { recursive: true });
// This exact test-only preference file is the sole reset; user app settings are never touched.
await unlink(join(process.env.APPDATA, 'com.markdowneditor.ui-frame-check', 'single-instance.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port; await new Promise(done => server.close(done));
const env = { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(artifacts, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`, MARKDOWN_EDITOR_LOG_DIR: join(artifacts, 'logs') };
const processes = [], connections = [], checks = [];
const pause = ms => new Promise(done => setTimeout(done, ms));
let stderr = '';
function launch(paths = []) { const p = spawn(binary, paths, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); p.stderr.on('data', data => { stderr += data; }); processes.push(p); return p; }
async function until(read, accept, description, timeout = 20000) { const deadline = Date.now() + timeout; let value; while (Date.now() < deadline) { value = await read(); if (accept(value)) return value; await pause(100); } throw new Error(description + ': ' + JSON.stringify(value)); }
async function targets() { try { return (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).filter(x => x.type === 'page' && x.url !== 'about:blank'); } catch { return []; } }
async function attach(target) { const connection = await new CdpConnection(target.webSocketDebuggerUrl).open(); connections.push(connection); const page = await new CdpPage(connection).initialize(); await page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 30000 }); await page.pressKey('Escape', { code: 'Escape' }); return page; }
const invoke = (page, command, args = {}) => page.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`);
const names = page => page.evaluate(`[...document.querySelectorAll('.document-item .document-title')].map(e=>e.textContent)`);
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
let main;
try {
  const files = [];
  for (const name of ['启动 中文.md', '启动 空格.txt', '连续打开.md', '独立文档.md', '主窗口关闭后.md']) { const path = join(artifacts, name); await writeFile(path, '# ' + name + '\n\n> 这是实际磁盘文档。\n'); files.push(path); }
  main = launch([files[0]]);
  launch([files[1]]); launch([files[2]]);
  const startupProcesses = [...processes];
  const first = (await until(targets, rows => rows.length === 1, 'primary WebView'))[0];
  const primary = await attach(first);
  await until(() => names(primary), rows => rows.length === 3, 'all simultaneous paths imported');
  check('default enabled and simultaneous launches reuse one native window', (await invoke(primary, 'read_launch_context')).enabled === true && (await invoke(primary, 'read_launch_context')).windowCount === 1);
  // Windows may schedule any of the simultaneous processes first. Identify the actual coordinator.
  const startupCodes = await until(async () => startupProcesses.map(p => p.exitCode), codes => codes.filter(c => c === null).length === 1 && codes.filter(c => c === 0).length === 2, 'one coordinator remains');
  main = startupProcesses.find(p => p.exitCode === null);
  check('secondary launcher processes exit and exactly one coordinator remains', startupCodes.filter(code => code === 0).length === 2);
  check('Unicode and spaces preserved in real session titles', (await names(primary)).includes('启动 中文.md') && (await names(primary)).includes('启动 空格.txt'));
  await primary.waitFor(() => Boolean(document.querySelector('.cm-hybrid-blockquote')));
  check('native WebView single-line quote is exactly one line plus padding', await primary.evaluate(`(()=>{const q=document.querySelector('.cm-hybrid-blockquote'),s=getComputedStyle(q);return q.getBoundingClientRect().height===parseFloat(s.lineHeight)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom);})()`));
  const batchPaths = [join(artifacts, '批量一.md'), join(artifacts, '批量二.md')];
  for (const path of batchPaths) await writeFile(path, '# 批量打开\n\n实际文件。\n');
  await primary.click('#window-minimize-btn');
  await until(() => invoke(primary, 'plugin:window|is_minimized'), value => value === true, 'window minimized');
  launch(batchPaths);
  await until(() => names(primary), rows => rows.length === 5, 'all paths from one command line imported');
  check('multiple file arguments restore a minimized existing window', (await invoke(primary, 'plugin:window|is_minimized')) === false && (await invoke(primary, 'read_launch_context')).windowCount === 1);
  await primary.pressKey(',', { modifiers: 2, code: 'Comma' });
  await primary.waitFor(() => !document.getElementById('settings-modal').hidden && !document.getElementById('setting-single-instance').disabled);
  await primary.click('#setting-single-instance');
  await until(() => invoke(primary, 'read_launch_context'), value => value.enabled === false, 'setting persisted off');
  await primary.click('.settings-sidebar .sidebar-footer-action');
  launch([files[3]]);
  const second = (await until(targets, rows => rows.length === 2, 'second independent window')).find(row => row.id !== first.id);
  const secondary = await attach(second);
  await until(() => names(secondary), rows => rows.includes('独立文档.md'), 'new window receives its file');
  check('unrestricted launch has independent document session', (await names(primary)).length === 5 && (await names(secondary)).length === 1);
  await primary.pressKey(',', { modifiers: 2, code: 'Comma' });
  await primary.waitFor(() => !document.getElementById('setting-single-instance').disabled);
  await primary.click('#setting-single-instance');
  await primary.waitFor(() => document.getElementById('setting-single-instance').closest('label').textContent.includes('关闭其他窗口'));
  check('reenabling with two windows is rejected without closing either session', (await invoke(primary, 'read_launch_context')).enabled === false && (await invoke(primary, 'read_launch_context')).windowCount === 2);
  await primary.screenshot(join(artifacts, 'multiwindow-rejection.png'));
  await primary.click('.settings-sidebar .sidebar-footer-action');
  await primary.click('#window-close-btn');
  await until(() => invoke(secondary, 'read_launch_context'), value => value.windowCount === 1, 'main window closes while coordinator remains');
  await invoke(secondary, 'set_single_instance', { enabled: true });
  launch([files[4]]);
  await until(() => names(secondary), rows => rows.includes('主窗口关闭后.md'), 'surviving window receives next launch');
  check('surviving non-main window becomes the restricted destination', (await invoke(secondary, 'read_launch_context')).windowCount === 1 && (await names(secondary)).length === 2);
  await secondary.screenshot(join(artifacts, 'surviving-session.png'));
  await invoke(secondary, 'set_single_instance', { enabled: false });
  await secondary.click('#window-close-btn');
  await until(async () => main.exitCode, value => value === 0, 'last native window exits');
  for (const connection of connections) await Promise.resolve(connection.close()).catch(() => {});
  await pause(500);
  const restarted = launch();
  const restartedTarget = (await until(targets, rows => rows.length === 1, 'restarted native window'))[0];
  const page = await attach(restartedTarget);
  check('disabled policy persists after full application restart', (await invoke(page, 'read_launch_context')).enabled === false);
  check('restart starts an independent empty session', (await names(page)).length === 0);
  await invoke(page, 'set_single_instance', { enabled: true });
  await page.click('#window-close-btn');
  await until(async () => restarted.exitCode, value => value === 0, 'restarted app exits');
  await writeFile(join(artifacts, 'launch-results.json'), JSON.stringify({ checks, stderr, processIds: processes.map(p => p.pid), native: true }, null, 2));
  console.log(`Windows launch: ${checks.length} checks passed.`);
} catch (error) {
  await writeFile(join(artifacts, 'launch-failure.json'), JSON.stringify({ error: error.stack, stderr, checks, targets: await targets() }, null, 2));
  throw error;
} finally {
  for (const connection of connections) await Promise.resolve(connection.close()).catch(() => {});
  for (const owned of processes) if (owned.exitCode === null) owned.kill();
}
