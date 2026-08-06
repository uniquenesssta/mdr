import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const readText = path => readFile(resolve(root, path), 'utf8');
const REQUIRED_REFS = Object.freeze(['menu', 'toolbar', 'sidebar', 'editor', 'preview', 'status', 'overlay']);
const SHELL_MODULES = Object.freeze([
  'src/ui/create-ui.js',
  'src/ui/shell/app-shell-view.js',
  'src/ui/shell/menu-bar-shell.js',
  'src/ui/shell/toolbar-shell.js',
  'src/ui/shell/sidebar-shell.js',
  'src/ui/shell/workspace-shell.js',
  'src/ui/shell/status-bar-shell.js',
  'src/ui/shell/overlay-root.js'
]);

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    this.className = '';
    this.id = '';
    this.hidden = false;
    this.title = '';
  }

  get children() {
    return this.childNodes;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) {
        const index = node.parentNode.childNodes.indexOf(node);
        if (index >= 0) node.parentNode.childNodes.splice(index, 1);
      }
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

test('createUI returns the exact named App Shell refs and owns an idempotent lifecycle', async () => {
  const { createUI } = await import(pathToFileURL(resolve(root, 'src/ui/create-ui.js')).href);
  const documentRef = new FakeDocument();
  const appRoot = documentRef.createElement('div');
  appRoot.id = 'app-root';
  appRoot.hidden = true;
  const previous = documentRef.createElement('span');
  appRoot.append(previous);

  const ui = createUI(appRoot);
  assert.deepEqual(Object.keys(ui).sort(), [...REQUIRED_REFS, 'destroy'].sort());
  assert.equal(createUI(appRoot), ui);
  assert.equal(appRoot.hidden, false);
  assert.equal(appRoot.childNodes.length, 2);

  assert.equal(ui.menu.tagName, 'NAV');
  assert.equal(ui.menu.className, 'l-menu-bar menu-bar');
  assert.equal(ui.menu.getAttribute('aria-label'), '应用菜单');
  assert.equal(ui.toolbar.className, 'l-toolbar-shell editor-toolbar');
  assert.equal(ui.toolbar.getAttribute('role'), 'toolbar');
  assert.equal(ui.sidebar.id, 'sidebar');
  assert.equal(ui.editor.className, 'l-pane f-editor-pane pane editor-pane');
  assert.equal(ui.preview.className, 'l-pane f-preview-pane pane preview-pane');
  assert.equal(ui.status.className, 'l-status-bar statusbar');
  assert.equal(ui.overlay.id, 'overlay-root');

  const app = appRoot.childNodes[0];
  assert.equal(app.className, 'l-app-shell app');
  assert.equal(app.getAttribute('data-ui-shell'), 'app');
  assert.deepEqual(app.childNodes.map(node => node.className), ['l-menu-bar menu-bar', 'l-toolbar-shell editor-toolbar', 'l-workspace workspace', 'l-status-bar statusbar']);
  const workspace = app.childNodes[2];
  assert.deepEqual(workspace.childNodes.map(node => node.id || node.className), ['sidebar', 'sidebar-resizer', 'l-split-pane main']);
  assert.equal(workspace.childNodes[1].getAttribute('aria-label'), '调整侧边栏宽度');
  assert.equal(workspace.childNodes[1].title, '拖动调整侧边栏宽度');
  assert.deepEqual(workspace.childNodes[2].childNodes.map(node => node.id || node.className), ['l-pane f-editor-pane pane editor-pane', 'resizer', 'l-pane f-preview-pane pane preview-pane']);

  ui.destroy();
  ui.destroy();
  assert.equal(appRoot.hidden, true);
  assert.deepEqual(appRoot.childNodes, [previous]);
  assert.notEqual(createUI(appRoot), ui);
});

test('App Shell modules are presentation-only and do not query business state or bind events', async () => {
  for (const modulePath of SHELL_MODULES) {
    const source = await readText(modulePath);
    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'window.',
      'querySelector',
      'getElementById',
      'addEventListener',
      'removeEventListener',
      'onclick=',
      'onchange='
    ]) {
      assert.equal(source.includes(forbidden), false, `${modulePath}: ${forbidden}`);
    }
    assert.doesNotMatch(source, /(?:^|[^a-z])store(?:[^a-z]|$)/i, modulePath);
    assert.doesNotMatch(source, /\.\.\/(?:app|document|editor|preview|storage|runtime|model-kernel)\//, modulePath);
  }
});

test('compatibility markup contains exact business-content templates and no second shell authority', async () => {
  const [markup, mountSource] = await Promise.all([
    readText('public/compatibility/current-shell.html'),
    readText('src/ui/compatibility/mount-current-shell.js')
  ]);
  const slotNames = [...markup.matchAll(/<template\s+data-compat-slot="([^"]+)">/g)].map(match => match[1]);
  assert.deepEqual(slotNames, [...REQUIRED_REFS, 'ports']);
  assert.doesNotMatch(markup, /<div class="app">|<nav class="menu-bar"|<div class="editor-toolbar"|<div class="workspace"|<aside class="sidebar"|<div class="statusbar"/);
  assert.match(mountSource, /import \{ createUI \} from '\.\.\/create-ui\.js'/);
  assert.match(mountSource, /mountTemplate\(slotTemplates\.get\(slotName\), ui\[slotName\]\)/);
  assert.match(mountSource, /mountTemplate\(slotTemplates\.get\('ports'\), root\)/);
  assert.doesNotMatch(mountSource, /root\.before|root\.hidden\s*=\s*true|className\s*=\s*['"]app['"]/);
});
