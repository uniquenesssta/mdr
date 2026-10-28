import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { getFreePort, launchChromium } from './lib/cdp-browser.mjs';
import { createApplicationDriver } from './lib/application-driver.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';
import { verifyBuiltApplication } from './lib/built-application-check.mjs';
import { runPreviewSelectionChecks } from './lib/preview-selection-checks.mjs';

test('rendered preview selections stay highlighted without formatting controls; source keeps a caret only', { timeout: 120000 }, async () => {
  const artifacts=process.env.E2E_ARTIFACT_DIR||await mkdtemp(join(tmpdir(),'mdr-preview-selection-'));
  await mkdir(artifacts,{recursive:true});
  const dist=process.env.E2E_DIST;
  if(dist)assert.equal((await verifyBuiltApplication({projectRoot:process.cwd(),distRoot:dist})).accepted,true);
  const server=dist?await startBuiltApplicationHost(dist):await createServer({configLoader:'native',cacheDir:join(artifacts,'vite-cache'),
    server:{host:'127.0.0.1',port:await getFreePort(),strictPort:true,open:false,hmr:false},logLevel:'error'});
  let browser;
  try {
    if(!dist)await server.listen();browser=await launchChromium({width:1440,height:960});const page=browser.page;
    await page.addInitScript("localStorage.setItem('md_editor_help_shown','true');localStorage.setItem('md_editor_active_line_color','#ff0000');");
    await page.navigate((dist?server.origin:'http://127.0.0.1:'+server.httpServer.address().port)+'/?e2e=1');
    await page.waitFor(()=>document.documentElement.classList.contains('app-ready'));
    const checks=await runPreviewSelectionChecks({page,app:createApplicationDriver(page),artifacts});
    assert.equal(await page.evaluate("document.body.style.getPropertyValue('--color-editor-active-line')"),'');
    await page.click('[data-menu-toggle="file-menu"]');await page.click('[data-settings-open]');
    await page.waitFor(()=>!document.getElementById('settings-modal').hidden);await page.click('[data-settings-page="editor"]');
    assert.equal(await page.evaluate("document.getElementById('setting-active-line-color')===null"),true);
    assert.equal(await page.evaluate("localStorage.getItem('md_editor_active_line_color')"),'#ff0000');
    assert.deepEqual(page.exceptions,[]);
    await writeFile(join(artifacts,'preview-selection-results.json'),JSON.stringify({passed:true,checks,legacyColorStored:true,retiredControlHidden:true},null,2));
    console.log('Preview selection: '+checks.length+' checks passed.');
  } catch(error) {
    if(browser){await writeFile(join(artifacts,'preview-selection-failure.json'),JSON.stringify({error:error.stack,exceptions:browser.page.exceptions,console:browser.page.consoleMessages.filter(row=>row.type==='error')},null,2));await browser.page.screenshot(join(artifacts,'preview-selection-failure.png'));}
    throw error;
  } finally {try{await browser?.close();}finally{await server.close();}}
});
