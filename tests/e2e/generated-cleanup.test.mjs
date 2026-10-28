import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, createServer } from 'vite';
import { getFreePort, launchChromium } from './lib/cdp-browser.mjs';
import { createApplicationInspector } from './lib/application-inspector.mjs';
import { verifyBuiltApplication } from './lib/built-application-check.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';

async function verifyDocument(browser, origin) {
  await browser.page.navigate(origin);
  await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 30000 });
  const inspector = createApplicationInspector(browser.page.connection);
  try {
    const actual = await inspector.evaluate(`(async () => {
      const text = ${JSON.stringify('# 无旧缓存启动\n\n独立构建与文档导入 😀')};
      const loaded = await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('importTextContent', 'clean.md', text, '');
      return { loaded, sameText: editorApi.getText() === text && documentModel.createSnapshot('clean-build') === text,
        sameId: documentModel.getState().documentId === applicationCapabilities.markdownEditorDocumentSessionPort.activeId,
        testGlobal: Object.hasOwn(globalThis, '__markdownEditorE2E'), legacyHost: Boolean(document.getElementById('compatibility-business-ports')) };
    })()`);
    assert.deepEqual(actual, { loaded: true, sameText: true, sameId: true, testGlobal: false, legacyHost: false });
  } finally { await inspector.destroy(); }
}

test('R16-09 fresh Vite cache and clean production output both load real documents without retired repository caches', { timeout: 120000 }, async () => {
  const projectRoot = resolve(import.meta.dirname, '../..');
  for (const path of ['.vite/deps/_metadata.json', '.vite/deps/package.json']) {
    await assert.rejects(access(join(projectRoot, path)), { code: 'ENOENT' });
  }
  const temporary = await mkdtemp(join(tmpdir(), 'mdr-r1609-clean-'));
  const cacheDir = join(temporary, 'vite-cache');
  const server = await createServer({ configLoader: 'native', cacheDir, server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen(); browser = await launchChromium();
    assert.equal(server.config.cacheDir, cacheDir.replaceAll('\\', '/'));
    await verifyDocument(browser, 'http://127.0.0.1:' + server.httpServer.address().port + '/');
  } finally { try { await browser?.close(); } finally { await server.close(); } }

  const distRoot = join(temporary, 'build');
  // A preceding DEV server sets NODE_ENV for this test process. Restore a real
  // production build explicitly, and verify the resolved configuration.
  const previousEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await build({ configLoader: 'native', cacheDir, mode: 'production', build: { outDir: distRoot, emptyOutDir: false }, logLevel: 'error',
      plugins: [{ name: 'verify-production-clean-build', configResolved(config) {
        assert.equal(config.isProduction, true); assert.equal(config.mode, 'production');
      } }] });
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
  const fingerprint = await verifyBuiltApplication({ projectRoot, distRoot });
  assert.equal(fingerprint.accepted, true);
  const host = await startBuiltApplicationHost(distRoot);
  browser = null;
  try {
    browser = await launchChromium(); await verifyDocument(browser, host.origin);
    assert.equal(browser.page.exceptions.length, 0);
  } finally { try { await browser?.close(); } finally { await host.close(); } }
  // Temporary verification outputs stay outside the repository; no recursive
  // cleanup can reach the user's logs, documents or daily development build.
  for (const path of ['.vite/deps/_metadata.json', '.vite/deps/package.json']) {
    await assert.rejects(access(join(projectRoot, path)), { code: 'ENOENT' });
  }
});
