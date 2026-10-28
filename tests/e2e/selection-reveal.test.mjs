import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {getFreePort,launchChromium} from './lib/cdp-browser.mjs';
import {createApplicationDriver} from './lib/application-driver.mjs';
import {startBuiltApplicationHost} from './lib/built-application-host.mjs';
import {verifyBuiltApplication} from './lib/built-application-check.mjs';
import {runSelectionRevealChecks} from './lib/selection-reveal-checks.mjs';
import {runCrossChapterSelectionCheck,runLargeSelectionScrollCheck} from './lib/selection-stability-checks.mjs';

test('sidebar collapse has no residual geometry and preview selections reveal only when needed',{timeout:120000},async()=>{
  const artifacts=process.env.E2E_ARTIFACT_DIR||await mkdtemp(join(tmpdir(),'mdr-selection-reveal-'));
  await mkdir(artifacts,{recursive:true});const dist=process.env.E2E_DIST;
  const admission=dist?await verifyBuiltApplication({projectRoot:process.cwd(),distRoot:dist}):null;
  if(dist)assert.equal(admission.accepted,true);
  const server=dist?await startBuiltApplicationHost(dist):await createServer({configLoader:'native',cacheDir:join(artifacts,'vite-cache'),server:{host:'127.0.0.1',port:await getFreePort(),strictPort:true,open:false,hmr:false},logLevel:'error'});
  let browser;
  try{
    if(!dist)await server.listen();browser=await launchChromium({width:1280,height:860});const page=browser.page,app=createApplicationDriver(page);
    await page.addInitScript("localStorage.setItem('md_editor_help_shown','true');");
    await page.navigate((dist?server.origin:'http://127.0.0.1:'+server.httpServer.address().port)+'/?e2e=1');
    await page.waitFor(()=>document.documentElement.classList.contains('app-ready'));
    const checks=await runSelectionRevealChecks({page,app,artifacts});
    const chapters=await runCrossChapterSelectionCheck(page,app);
    const wheel=await runLargeSelectionScrollCheck(page,app);
    assert.deepEqual(page.exceptions,[]);
    await page.screenshot(join(artifacts,'chapter-selection-stable.png'));
    await writeFile(join(artifacts,'selection-reveal-results.json'),JSON.stringify({passed:true,checks,chapters,wheel,admission},null,2));
    console.log(`Selection reveal: ${checks.length} checks and ${chapters.measurements.length} first chapter selections passed.`);
  }catch(error){if(browser){await writeFile(join(artifacts,'failure.json'),JSON.stringify({error:error.stack,exceptions:browser.page.exceptions,console:browser.page.consoleMessages.filter(x=>x.type==='error')},null,2));await browser.page.screenshot(join(artifacts,'failure.png'));}throw error;
  }finally{try{await browser?.close();}finally{await server.close();}}
});
