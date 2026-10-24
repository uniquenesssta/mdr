import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHtmlInventory } from '../../scripts/stage-02/dom-inventory/html-inventory.mjs';
import { collectInlineEvents } from '../../scripts/architecture/source-analysis.mjs';

const root = process.cwd();
const readText = path => readFile(resolve(root, path), 'utf8');
const readJson = async path => JSON.parse(await readText(path));

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

test('R16-08 business content belongs to safe feature Views while the frozen shell stays minimal', async () => {
  const paths = ['menu/ui/menu-content-view.js','editor/ui/editor-toolbar-view.js','editor/ui/editor-content-view.js',
    'sidebar/ui/sidebar-content-view.js','preview/ui/preview-content-view.js','persistence/ui/status-content-view.js',
    'documents/ui/document-content-view.js','import/ui/import-content-view.js'];
  const sources = await Promise.all(paths.map(path => readText('src/features/' + path)));
  for (const source of sources) {
    assert.match(source, /mountStaticContent/);
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|new Function|eval\(|<script\b/);
    assert.doesNotMatch(source, /["']on(?:click|change|input)["']\s*:/);
  }
  assert.match(sources.join('\n'), /\/assets\/icons\.svg#icon-/);
  const frozen = await readJson('tests/ui/fixtures/dom-asset-inventory.json');
  assert.equal(frozen.summary.inlineEventCount, 184);
});

test('R16-08 module entry composes the shell before explicit application construction and owns rollback', async () => {
  const source = await readText('src/bootstrap/module-entry.js');
  assert.match(source, /const ui = own\(createUI\(root\)\);[\s\S]*own\(createWorkspaceContent\(ui\)\);[\s\S]*await importApplication\(\)/);
  assert.match(source, /own\(await startApplication\(/);
  assert.match(source, /lifetime\.destroy\(\)/);
  assert.doesNotMatch(source, /compatibility-business-ports|business-content|mountCurrentShell|current-shell/);
});
