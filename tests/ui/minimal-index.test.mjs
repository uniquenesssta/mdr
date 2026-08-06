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

test('compatibility asset owns unmigrated business content while App Shell owns the mounted structure', async () => {
  const markup = await readText('public/compatibility/business-content.html');
  const inlineEvents = collectInlineEvents('public/compatibility/business-content.html', markup);
  assert.equal(inlineEvents.reduce((sum, record) => sum + record.count, 0), 184);
  assert.doesNotMatch(markup, /<script\b/i);
  assert.doesNotMatch(markup, /<html\b|<head\b|<body\b/i);
  assert.deepEqual([...markup.matchAll(/<template\s+data-compat-slot=\"([^\"]+)\">/g)].map(match => match[1]), ['menu', 'toolbar', 'sidebar', 'editor', 'preview', 'status', 'overlay', 'ports']);
  assert.doesNotMatch(markup, /<div class=\"app\">|<nav class=\"menu-bar\"|<div class=\"editor-toolbar\"|<div class=\"workspace\"|<aside class=\"sidebar\"|<div class=\"statusbar\"/);
  for (const required of ['id="editor"', 'id="preview"', 'id="settings-modal"']) {
    assert.match(markup, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(markup, /<symbol\b|class="icon-sprite"|href="#icon-/i);
  assert.match(markup, /href="\/assets\/icons\.svg#icon-/i);
});

test('module entry creates the App Shell before mounting temporary compatibility content', async () => {
  const [entrySource, compatibilityModule] = await Promise.all([
    readText('src/bootstrap/module-entry.js'),
    import(pathToFileURL(resolve(root, 'src/ui/compatibility/index.js')).href)
  ]);
  assert.equal(typeof compatibilityModule.createCompatibilityBusinessContentPort, 'function');
  const uiModule = await import(pathToFileURL(resolve(root, 'src/ui/create-ui.js')).href);
  assert.equal(typeof uiModule.createUI, 'function');
  assert.throws(() => compatibilityModule.createCompatibilityBusinessContentPort(null, {}), /#app-root/);
  assert.match(entrySource, /\/compatibility\/business-content\.html/);
  assert.match(entrySource, /\/i18n\.js/);
  assert.match(entrySource, /import\('\.\.\/main\.js'\)/);
  assert.match(entrySource, /ui = createUI\(root\)/);
  assert.match(entrySource, /contentPort = createCompatibilityBusinessContentPort\(root, ui\)/);
  assert.match(entrySource, /contentPort\.mount\(markup\)/);
  assert.match(entrySource, /contentPort\?\.destroy\(\)/);
  assert.match(entrySource, /ui\?\.destroy\(\)/);
  assert.doesNotMatch(await readText('src/ui/compatibility/business-content-port.js'), /createUI|app-shell-view|shell\//);
  assert.doesNotMatch(entrySource, /current-shell|mountCurrentShell|\bwindow\./);
});
