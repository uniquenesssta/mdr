import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { getFreePort, launchChromium } from './lib/cdp-browser.mjs';
import { createApplicationDriver } from './lib/application-driver.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';
import { verifyBuiltApplication } from './lib/built-application-check.mjs';

test('empty session has one unobstructed paper and locks writing until a document exists', { timeout: 60000 }, async () => {
  const artifacts = process.env.E2E_ARTIFACT_DIR || await mkdtemp(join(tmpdir(), 'mdr-empty-modes-'));
  await mkdir(artifacts, { recursive: true });
  const dist = process.env.E2E_DIST;
  if (dist) assert.equal((await verifyBuiltApplication({ projectRoot: process.cwd(), distRoot: dist })).accepted, true);
  const server = dist ? await startBuiltApplicationHost(dist) : await createServer({ configLoader: 'native', cacheDir: join(artifacts, 'vite-cache'),
    server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    if (!dist) await server.listen();
    browser = await launchChromium({ width: 1280, height: 860 });
    const page = browser.page;
    await page.addInitScript("localStorage.setItem('md_editor_help_shown','true');localStorage.setItem('md_editor_layout_mode','preview');");
    await page.navigate((dist ? server.origin : 'http://127.0.0.1:' + server.httpServer.address().port) + '/?e2e=1');
    await page.waitFor(() => document.documentElement.classList.contains('app-ready'));
    const app = createApplicationDriver(page);
    const state = () => page.evaluate(`({ mode: document.querySelector('.writing-modes button.active').dataset.mode,
      locked: [...document.querySelectorAll('.writing-modes button')].every(button => button.disabled),
      empty: !document.querySelector('.document-empty').hidden,
      readOnly: document.querySelector('#editor .cm-content').contentEditable === 'false' })`);
    assert.deepEqual(await state(), { mode: 'hybrid', locked: true, empty: true, readOnly: true });
    for (const mode of ['both', 'preview', 'hybrid']) {
      // Dispatch deliberately bypasses native disabled activation to verify the command boundary too.
      await page.evaluate(`document.querySelector('.writing-modes [data-mode="${mode}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      assert.deepEqual(await state(), { mode: 'hybrid', locked: true, empty: true, readOnly: true });
    }
    assert.equal(await page.evaluate("localStorage.getItem('md_editor_layout_mode')"), 'preview', 'empty-session clamping preserves the stored preference');
    for (const [width, height] of [[1280, 860], [600, 480]]) {
      await page.setViewport({ width, height });
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const geometry = await page.evaluate(`(() => {
        const root=document.querySelector('.l-split-pane'),button=document.querySelector('.document-empty button');
        const r=root.getBoundingClientRect(),b=button.getBoundingClientRect();
        const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
        const splitter=document.querySelector('.l-pane-resizer');
        return {centered:Math.abs(b.x+b.width/2-(r.x+r.width/2))<1,unobstructed:hit===button||button.contains(hit),
          splitHidden:getComputedStyle(splitter).display==='none'||getComputedStyle(splitter).visibility==='hidden',
          inside:b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom};
      })()`);
      assert.deepEqual(geometry, { centered: true, unobstructed: true, splitHidden: true, inside: true });
      await page.screenshot(join(artifacts, `empty-${width}-${height}.png`));
    }
    await page.click('.document-empty button');
    await page.waitFor(() => document.querySelector('.document-empty').hidden && !document.querySelector('.writing-modes button').disabled);
    assert.deepEqual(await state(), { mode: 'hybrid', locked: false, empty: false, readOnly: false });
    for (const mode of ['both', 'preview', 'hybrid']) {
      await page.click(`.writing-modes [data-mode="${mode}"]`);
      await page.waitFor(`document.querySelector('.writing-modes button.active').dataset.mode === '${mode}'`);
      await app.waitForIdle();
      assert.equal((await state()).mode, mode);
      assert.equal((await state()).readOnly, mode === 'preview');
    }
    await page.click('.writing-modes [data-mode="both"]');
    await page.setViewport({ width: 1280, height: 860 });
    await page.evaluate("document.querySelector('.document-item .document-close').click()");
    await page.waitFor(() => !document.querySelector('.document-empty').hidden);
    assert.deepEqual(await state(), { mode: 'hybrid', locked: true, empty: true, readOnly: true });
    assert.equal(await page.evaluate("localStorage.getItem('md_editor_layout_mode')"), 'both', 'closing the last document does not overwrite the selected preference');
    await page.screenshot(join(artifacts, 'empty-after-close.png'));
    await page.click('.document-empty button');
    await page.waitFor(() => document.querySelector('.document-empty').hidden);
    assert.deepEqual(await state(), { mode: 'hybrid', locked: false, empty: false, readOnly: false });
    assert.deepEqual(page.exceptions, []);
    assert.deepEqual(page.consoleMessages.filter(entry => entry.type === 'error'), []);
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});
