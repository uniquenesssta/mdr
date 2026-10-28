import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { getFreePort, launchChromium } from './lib/cdp-browser.mjs';
import { createApplicationInspector } from './lib/application-inspector.mjs';

test('R16-08 feature Views preserve the approved Figma blue markup and release their exact DOM ownership', { timeout: 60000 }, async () => {
  const baseline = JSON.parse(await readFile('tests/fixtures/blue-ui/markup-baseline.json', 'utf8'));
  const historical = await readFile('tests/fixtures/stage-16/ui-markup-baseline.json');
  const historicalSha256 = '4eb83c94c2175a651127b413084c56ecbee3f564afa2359c1ffe6d9d249984a2';
  assert.equal(createHash('sha256').update(historical).digest('hex'), historicalSha256);
  assert.equal(baseline.authority.historicalSha256, historicalSha256);
  assert.equal(baseline.authority.fileKey, 'hMLGpGuR3Cpo0Tt2U8iagb');
  const booleanAttributes = new Set(['hidden','disabled','checked','multiple','selected','readonly','autofocus','required']);
  const normalizeMarkup = node => {
    if (!Array.isArray(node)) return node;
    return [node[0], Object.fromEntries(Object.entries(node[1]).map(([key, value]) =>
      [key, value === true && !booleanAttributes.has(key) ? '' : value])), node[2].map(normalizeMarkup)];
  };
  const server = await createServer({ configLoader: 'native', server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    browser = await launchChromium();
    await browser.page.navigate('http://127.0.0.1:' + server.httpServer.address().port + '/?e2e=1');
    await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 30000 });
    const actual = await browser.page.evaluate(`(async () => {
      const { createUI } = await import('/src/ui/create-ui.js');
      const { createWorkspaceContent } = await import('/src/bootstrap/workspace-content.js');
      const doc = document.implementation.createHTMLDocument('View characterization');
      const root = doc.createElement('main'); root.id = 'app-root'; doc.body.append(root);
      const ui = createUI(root), content = createWorkspaceContent(ui);
      const boolean = new Set(['hidden','disabled','checked','multiple','selected','readonly','autofocus','required']);
      const encode = node => {
        if (node.nodeType === 3) return node.nodeValue;
        return [node.tagName.toLowerCase(), Object.fromEntries([...node.attributes].map(a => [a.name, boolean.has(a.name) ? true : a.value])), [...node.childNodes].filter(n => n.nodeType !== 8).map(encode)];
      };
      const slots = Object.fromEntries(['menu','toolbar','sidebar','editor','preview','status'].map(key => [key, [...ui[key].childNodes].map(encode)]));
      const overlays = Object.fromEntries([...ui.overlay.children].map(node => [node.id, encode(node)]));
      const host = document.getElementById('editor');
      const forbidden = ['virtualEditor','value','textLength','lineCount','selectionStart','selectionEnd','setRangeText','setSelectionRange'];
      const published = forbidden.filter(key => Object.hasOwn(host, key));
      const portHost = Boolean(document.getElementById('compatibility-business-ports'));
      const foreign = doc.createElement('span'); ui.overlay.append(foreign);
      content.destroy(); content.destroy();
      const remaining = [...ui.overlay.children].map(node => node.tagName);
      const emptied = ['menu','toolbar','sidebar','editor','preview','status'].every(key => ui[key].childNodes.length === 0);
      ui.destroy();
      return { slots, overlays, published, portHost, remaining, emptied, restored: root.childNodes.length === 0 };
    })()`);
    for (const [key, nodes] of Object.entries(actual.slots)) assert.deepEqual(nodes, baseline.slots[key].map(normalizeMarkup), key);
    const expectedOverlays = Object.fromEntries([...baseline.slots.overlay, ...baseline.slots.ports]
      .filter(Array.isArray).map(node => [node[1].id, normalizeMarkup(node)]));
    assert.deepEqual(actual.overlays, expectedOverlays, 'complete overlay nodes and attributes');
    assert.deepEqual(actual.published, []);
    assert.equal(actual.portHost, false);
    assert.deepEqual(actual.remaining, ['SPAN']);
    assert.equal(actual.emptied, true);
    assert.equal(actual.restored, true);
    const editing = await browser.page.evaluate(`(async () => {
      const { createVirtualEditor, createDocumentModelBinding, createEditorController } = await import('/src/features/editor/index.js');
      const { createDocumentModel } = await import('/src/model-kernel/index.js');
      const host = document.createElement('div'); document.body.append(host);
      const editor = createVirtualEditor(host), model = createDocumentModel(createDocumentModelBinding(editor));
      const controller = createEditorController({ model, adapter: editor }), transactions = [];
      const unsubscribe = controller.subscribeTransactions(value => transactions.push(value));
      try {
        model.activate({ id: 'binding-test', title: 'test.md' }, { chunks: ['甲'.repeat(100000), '\\n尾部'] });
        editor.setSelection(100001, 100003);
        editor.replaceRange('结尾', 100001, 100003, 'select');
        model.replaceRange('首', 0, 1, 'end');
        const snapshot = model.createSnapshot('binding-test');
        const result = { length: model.getTextLength(), head: snapshot.slice(0, 2), tail: snapshot.slice(-3),
          selection: model.getSelection(), version: model.getDocumentVersion(),
          transactions: transactions.map(value => ({ version: value.version, interactive: value.interactive })),
          published: ['virtualEditor','value','selectionStart','selectionEnd','setRangeText'].filter(key => Object.hasOwn(host, key)) };
        model.activate({ id: 'next', title: 'next.md' }, { content: 'fresh' });
        result.reloaded = model.createSnapshot('binding-reload');
        result.resetVersion = model.getDocumentVersion();
        return result;
      } finally { unsubscribe(); controller.destroy(); model.destroy(); editor.destroy(); host.remove(); }
    })()`);
    assert.equal(editing.length, 100003);
    assert.equal(editing.head, '首甲');
    assert.equal(editing.tail, '\n结尾');
    assert.equal(editing.version, 2);
    assert.deepEqual(editing.transactions, [{ version: 1, interactive: true }, { version: 2, interactive: false }]);
    assert.deepEqual(editing.published, []);
    assert.equal(editing.reloaded, 'fresh');
    assert.equal(editing.resetVersion, 0);
    for (const [action, id, focus, role] of [['open-link','link-modal','link-url-input','dialog'], ['open-find','find-modal','find-input','search'],
      ['open-image','image-modal','image-url-input','dialog'], ['open-mermaid','mermaid-modal','mermaid-code','dialog']]) {
      const modal = await browser.page.evaluate(`(async () => {
        document.querySelector('[data-editor-action="${action}"]').click();
        await new Promise(requestAnimationFrame);
        const root = document.getElementById('${id}'), panel = root.firstElementChild;
        const result = { open: root.classList.contains('show'), role: panel.getAttribute('role'), focused: document.activeElement.id };
        if ('${action}' === 'open-find') {
          result.popover = root.classList.contains('c-popover');
          result.modal = panel.getAttribute('aria-modal') === 'true';
        }
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        result.closed = !root.classList.contains('show');
        // ModalShell releases its focus scope and restores focus on the next frame.
        await new Promise(requestAnimationFrame);
        return result;
      })()`);
      assert.deepEqual(modal, { open: true, role, focused: focus, closed: true,
        ...(action === 'open-find' ? { popover: true, modal: false } : {}) }, id);
    }
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});

test('R16-08 integration inspection accesses actual owners without enabling a product test slot', { timeout: 60000 }, async () => {
  const server = await createServer({ configLoader: 'native', server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false, hmr: false }, logLevel: 'error' });
  let browser, inspector;
  try {
    await server.listen(); browser = await launchChromium();
    await browser.page.navigate('http://127.0.0.1:' + server.httpServer.address().port + '/');
    await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 30000 });
    inspector = createApplicationInspector(browser.page.connection);
    const result = await inspector.evaluate(`(async () => {
      const loaded = await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('importTextContent', 'inspection.md', '实际文档', '');
      const snapshot = documentModel.getState();
      return { loaded, idMatches: snapshot.documentId === applicationCapabilities.markdownEditorDocumentSessionPort.activeId,
        textMatches: documentModel.createSnapshot('inspection') === editorApi.getText(), text: editorApi.getText(),
        globalPublished: Object.hasOwn(globalThis, '__markdownEditorE2E'),
        legacyHost: Boolean(document.getElementById('compatibility-business-ports')),
        projection: Object.hasOwn(document.getElementById('editor'), 'value') };
    })()`);
    assert.deepEqual(result, { loaded: true, idMatches: true, textMatches: true, text: '实际文档', globalPublished: false, legacyHost: false, projection: false });
    const disposed = await browser.page.evaluate(`(async () => {
      const { startModuleEntry } = await import('/src/bootstrap/module-entry.js');
      const application = await startModuleEntry({ documentRef: document });
      application.destroy(); application.destroy();
      return { ready: document.documentElement.classList.contains('app-ready'),
        shell: Boolean(document.querySelector('[data-ui-shell="app"]')),
        overlays: Boolean(document.getElementById('overlay-root')),
        editor: Boolean(document.getElementById('editor')),
        legacyHost: Boolean(document.getElementById('compatibility-business-ports')) };
    })()`);
    assert.deepEqual(disposed, { ready: false, shell: false, overlays: false, editor: false, legacyHost: false });
    await assert.rejects(inspector.evaluate('applicationCapabilities.markdownEditorDocumentControllerPort.newDocument()'), /destroyed/);
    await inspector.destroy(); await inspector.destroy();
    await assert.rejects(inspector.evaluate('true'), /destroyed/);
  } finally {
    try { await inspector?.destroy(); } finally { try { await browser?.close(); } finally { await server.close(); } }
  }
});
