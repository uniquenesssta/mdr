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

test('R16-05 App Shell mounts no legacy query aliases and destroy restores prior nodes', async () => {
  const { createUI } = await import(pathToFileURL(resolve(root, 'src/ui/create-ui.js')).href);
  const documentRef = new FakeDocument(), appRoot = documentRef.createElement('div');
  appRoot.id = 'app-root';
  const previous = documentRef.createElement('span');
  appRoot.append(previous);
  const ui = createUI(appRoot);
  const retired = new Set(['app', 'menu-bar', 'editor-toolbar', 'workspace', 'sidebar', 'sidebar-resizer',
    'main', 'pane', 'editor-pane', 'preview-pane', 'resizer', 'statusbar', 'overlay-root']);
  const aliases = [];
  const inspect = node => {
    aliases.push(...node.className.split(/\s+/).filter(name => retired.has(name)));
    node.children.forEach(inspect);
  };
  appRoot.children.forEach(inspect);
  try { assert.deepEqual(aliases, []); }
  finally { ui.destroy(); }
  assert.deepEqual(appRoot.childNodes, [previous]);
});

test('createUI returns the exact named App Shell refs and owns an idempotent lifecycle', async () => {
  const { createUI } = await import(pathToFileURL(resolve(root, 'src/ui/create-ui.js')).href);
  const documentRef = new FakeDocument();
  const appRoot = documentRef.createElement('div');
  appRoot.id = 'app-root';
  appRoot.hidden = true;
  const previous = documentRef.createElement('span');
  appRoot.append(previous);

  const ui = createUI(appRoot);
  assert.deepEqual(Object.keys(ui).sort(), [...REQUIRED_REFS, 'workspace', 'destroy'].sort());
  assert.equal(createUI(appRoot), ui);
  assert.equal(appRoot.hidden, false);
  assert.equal(appRoot.childNodes.length, 2);

  assert.equal(ui.menu.tagName, 'NAV');
  assert.equal(ui.menu.className, 'l-menu-bar');
  assert.equal(ui.menu.getAttribute('aria-label'), '应用菜单');
  assert.equal(ui.toolbar.className, 'l-toolbar-shell');
  assert.equal(ui.toolbar.getAttribute('role'), 'toolbar');
  assert.equal(ui.sidebar.id, 'sidebar');
  assert.equal(ui.editor.className, 'l-pane f-editor-pane');
  assert.equal(ui.preview.className, 'l-pane f-preview-pane');
  assert.equal(ui.status.className, 'l-status-bar');
  assert.equal(ui.overlay.id, 'overlay-root');

  const app = appRoot.childNodes[0];
  assert.equal(app.className, 'l-app-shell');
  assert.equal(app.getAttribute('data-ui-shell'), 'app');
  assert.deepEqual(app.childNodes.map(node => node.className), ['l-menu-bar', 'l-workspace', 'l-status-bar']);
  const workspace = app.childNodes[1];
  assert.equal(ui.workspace, workspace);
  assert.deepEqual(workspace.childNodes.map(node => node.id || node.className), ['sidebar', 'sidebar-resizer', 'l-workspace-main']);
  assert.equal(workspace.childNodes[1].getAttribute('aria-label'), '调整侧边栏宽度');
  assert.equal(workspace.childNodes[1].title, '拖动调整侧边栏宽度');
  assert.deepEqual(workspace.childNodes[2].childNodes.map(node => node.id || node.className), ['writing-toolbar', 'l-split-pane']);
  assert.deepEqual(workspace.childNodes[2].childNodes[1].childNodes.map(node => node.id || node.className), ['l-pane f-editor-pane', 'resizer', 'l-pane f-preview-pane']);

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

test('R16-08 feature composition uses the existing shell and never constructs another shell', async () => {
  const entry = await readText('src/bootstrap/module-entry.js');
  const composition = await readText('src/bootstrap/workspace-content.js');
  assert.match(entry, /const ui = own\(createUI\(root\)\)/);
  assert.match(entry, /own\(createWorkspaceContent\(ui\)\)/);
  assert.doesNotMatch(entry, /compatibility-business-ports|business-content\.html|fetchImpl/);
  assert.doesNotMatch(composition, /createUI|app-shell-view|shell\//);
  for (const feature of ['menu','editor','sidebar','preview','persistence','documents','import']) assert.match(composition, new RegExp('features/' + feature + '/index\\.js'));
  assert.match(composition, /lifetime\.own\(\(\) => view\.destroy\(\)\)/);
});
