import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { getFreePort, launchChromium } from './lib/cdp-browser.mjs';

// Independent full-composition coverage supplements the migrated regression suite.
test('Figma blue composition matches every node and attribute and releases exact owned DOM', { timeout: 60000 }, async () => {
  const baseline = JSON.parse(await readFile('tests/fixtures/blue-ui/markup-baseline.json', 'utf8'));
  const historical = await readFile('tests/fixtures/stage-16/ui-markup-baseline.json');
  assert.equal(createHash('sha256').update(historical).digest('hex'), baseline.authority.historicalSha256);
  assert.equal(baseline.authority.fileKey, 'hMLGpGuR3Cpo0Tt2U8iagb');
  const temporary = await mkdtemp(join(tmpdir(), 'mdr-blue-ownership-'));
  const server = await createServer({ configLoader: 'native', cacheDir: join(temporary, 'vite-cache'),
    server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen(); browser = await launchChromium();
    await browser.page.navigate('http://127.0.0.1:' + server.httpServer.address().port + '/?e2e=1');
    await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 30000 });
    const actual = await browser.page.evaluate(`(async () => {
      const { createUI } = await import('/src/ui/create-ui.js');
      const { createWorkspaceContent } = await import('/src/bootstrap/workspace-content.js');
      const doc = document.implementation.createHTMLDocument('Blue ownership');
      const root = doc.createElement('main'); root.id = 'app-root'; doc.body.append(root);
      const ui = createUI(root), content = createWorkspaceContent(ui);
      const boolean = new Set(['hidden','disabled','checked','multiple','selected','readonly','autofocus','required']);
      const encode = node => node.nodeType === 3 ? node.nodeValue : [node.tagName.toLowerCase(),
        Object.fromEntries([...node.attributes].map(a => [a.name, boolean.has(a.name) ? true : a.value])),
        [...node.childNodes].filter(n => n.nodeType !== 8).map(encode)];
      const slots = Object.fromEntries(['menu','toolbar','sidebar','editor','preview','status'].map(key => [key, [...ui[key].childNodes].map(encode)]));
      slots.overlay = [...ui.overlay.children].map(encode); slots.ports = [];
      const foreign = doc.createElement('span'); ui.overlay.append(foreign);
      content.destroy(); content.destroy();
      const remaining = [...ui.overlay.children].map(node => node.tagName);
      const emptied = ['menu','toolbar','sidebar','editor','preview','status'].every(key => ui[key].childNodes.length === 0);
      ui.destroy();
      const host = document.getElementById('editor');
      return { slots, remaining, emptied, restored: root.childNodes.length === 0,
        globals: ['virtualEditor','value','selectionStart','setRangeText'].filter(key => Object.hasOwn(host,key)),
        legacyHost: Boolean(document.getElementById('compatibility-business-ports')) };
    })()`);
    assert.deepEqual(actual.slots, baseline.slots);
    assert.deepEqual(actual.remaining, ['SPAN']);
    assert.equal(actual.emptied, true);
    assert.equal(actual.restored, true);
    assert.deepEqual(actual.globals, []);
    assert.equal(actual.legacyHost, false);
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});
