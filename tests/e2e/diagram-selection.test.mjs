import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { launchChromium, getFreePort } from './lib/cdp-browser.mjs';
import { createApplicationDriver } from './lib/application-driver.mjs';
import { runDiagramSelectionChecks } from './lib/diagram-selection-checks.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';
import { verifyBuiltApplication } from './lib/built-application-check.mjs';

test('Mermaid selection corresponds to the rendered component in both directions', { timeout: 90000 }, async () => {
  const artifacts = process.env.E2E_ARTIFACT_DIR || await mkdtemp(join(tmpdir(), 'mdr-diagram-selection-'));
  await mkdir(artifacts, { recursive: true });
  const dist = process.env.E2E_DIST;
  if (dist) assert.equal((await verifyBuiltApplication({ projectRoot: process.cwd(), distRoot: dist })).accepted, true);
  const server = dist ? await startBuiltApplicationHost(dist) : await createServer({ configLoader: 'native', cacheDir: join(artifacts, 'vite-cache'), server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    if (!dist) await server.listen(); browser = await launchChromium({ width: 1440, height: 960 });
    const page = browser.page; await page.addInitScript("localStorage.setItem('md_editor_help_shown','true')");
    await page.navigate((dist ? server.origin : 'http://127.0.0.1:' + server.httpServer.address().port) + '/?e2e=1');
    await page.waitFor(() => document.documentElement.classList.contains('app-ready'));
    const source = process.env.SELECTION_ORIGINAL_PATH ? await readFile(process.env.SELECTION_ORIGINAL_PATH, 'utf8') : undefined;
    const checks = await runDiagramSelectionChecks({ page, app: createApplicationDriver(page), artifacts, source });
    assert.deepEqual(page.exceptions, []);
    await writeFile(join(artifacts, 'diagram-selection-results.json'), JSON.stringify({ checks }, null, 2));
  } catch (error) {
    if (browser) { await browser.page.screenshot(join(artifacts, 'diagram-selection-failure.png')); await writeFile(join(artifacts, 'diagram-selection-failure.json'), JSON.stringify({ error: error.stack, exceptions: browser.page.exceptions, geometry: await browser.page.evaluate(`({mode:document.querySelector('.writing-modes [aria-pressed=true]')?.dataset.mode,diagram:[...document.querySelectorAll('#preview .mermaid')].map(e=>({data:{...e.dataset},svg:!!e.querySelector('svg'),classes:e.className})),selection:getSelection()?.toString(),toolbar:getComputedStyle(document.querySelector('.format-group')).display})`) }, null, 2)); }
    throw error;
  } finally { try { await browser?.close(); } finally { await server.close(); } }
});
