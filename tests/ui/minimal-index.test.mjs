import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHtmlInventory } from '../../scripts/stage-02/dom-inventory/html-inventory.mjs';
import { collectInlineEvents } from '../../scripts/architecture/source-analysis.mjs';

const root = process.cwd();
const readText = path => readFile(resolve(root, path), 'utf8');

const expectedIndex = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Markdown Editor</title>
</head>
<body>
  <div id="app-root"></div>
  <script type="module" src="/src/bootstrap/module-entry.js"></script>
</body>
</html>
`;

test('Atomic Task 2.2 reduces index.html to the exact minimal document shell', async () => {
  const source = await readText('index.html');
  assert.equal(source, expectedIndex);
  const inventory = buildHtmlInventory(source);
  assert.equal(inventory.summary.elementCount, 8);
  assert.equal(inventory.summary.idCount, 1);
  assert.equal(inventory.summary.classCount, 0);
  assert.equal(inventory.summary.inlineEventCount, 0);
  assert.equal(inventory.summary.inlineStyleCount, 0);
  assert.equal(inventory.summary.ariaNodeCount, 0);
  assert.equal(inventory.summary.dataAttributeNodeCount, 0);
  assert.deepEqual(inventory.ids, ['app-root']);
  assert.deepEqual(inventory.scripts.map(script => ({ src: script.src, type: script.type })), [
    { src: '/src/bootstrap/module-entry.js', type: 'module' }
  ]);
  assert.doesNotMatch(source, /\/i18n\.js|\/src\/main\.js|\son[a-z]+=|<svg|modal|menu-bar|data-theme/i);
});

test('current shell compatibility asset remains the single honest owner of unmigrated DOM', async () => {
  const markup = await readText('public/compatibility/current-shell.html');
  const inlineEvents = collectInlineEvents('public/compatibility/current-shell.html', markup);
  assert.equal(inlineEvents.reduce((sum, record) => sum + record.count, 0), 184);
  assert.doesNotMatch(markup, /<script\b/i);
  assert.doesNotMatch(markup, /<html\b|<head\b|<body\b/i);
  for (const required of ['id="editor"', 'id="preview"', 'id="settings-modal"']) {
    assert.match(markup, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(markup, /<symbol\b|class="icon-sprite"|href="#icon-/i);
  assert.match(markup, /href="\/assets\/icons\.svg#icon-/i);
});

test('module entry owns resource loading while the mount module is independently destroyable', async () => {
  const [entrySource, mountModule] = await Promise.all([
    readText('src/bootstrap/module-entry.js'),
    import(pathToFileURL(resolve(root, 'src/ui/compatibility/mount-current-shell.js')).href)
  ]);
  assert.equal(typeof mountModule.mountCurrentShell, 'function');
  assert.throws(() => mountModule.mountCurrentShell(null, '<div></div>'), /#app-root/);
  assert.match(entrySource, /\/compatibility\/current-shell\.html/);
  assert.match(entrySource, /\/i18n\.js/);
  assert.match(entrySource, /import\('\.\.\/main\.js'\)/);
  assert.match(entrySource, /getElementById\('app-root'\)/);
  assert.match(entrySource, /shellMount\.destroy\(\)/);
  assert.match(entrySource, /classicScript\?\.remove\(\)/);
  assert.doesNotMatch(entrySource, /\bwindow\./);
});
