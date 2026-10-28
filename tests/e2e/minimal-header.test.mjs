import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from 'vite';import {getFreePort,launchChromium} from './lib/cdp-browser.mjs';
import {createApplicationDriver} from './lib/application-driver.mjs';
import {startBuiltApplicationHost} from './lib/built-application-host.mjs';import {verifyBuiltApplication} from './lib/built-application-check.mjs';
import {runMinimalHeaderChecks,inspectMinimalHeader} from './lib/minimal-header-checks.mjs';

test('minimal workspace header preserves commands while centering exactly three modes',{timeout:60000},async()=>{
  const artifacts=process.env.E2E_ARTIFACT_DIR||await mkdtemp(join(tmpdir(),'mdr-minimal-header-'));await mkdir(artifacts,{recursive:true});
  const dist=process.env.E2E_DIST,admission=dist?await verifyBuiltApplication({projectRoot:process.cwd(),distRoot:dist}):null;
  if(dist)assert.equal(admission.accepted,true);
  const server=dist?await startBuiltApplicationHost(dist):await createServer({configLoader:'native',cacheDir:join(artifacts,'vite-cache'),server:{host:'127.0.0.1',port:await getFreePort(),strictPort:true,open:false,hmr:false},logLevel:'error'});
  let browser;
  try{
    if(!dist)await server.listen();browser=await launchChromium({width:1280,height:860});const page=browser.page,app=createApplicationDriver(page);
    await page.addInitScript("localStorage.setItem('md_editor_help_shown','true');");
    await page.navigate((dist?server.origin:'http://127.0.0.1:'+server.httpServer.address().port)+'/?e2e=1');await page.waitFor(()=>document.documentElement.classList.contains('app-ready'));
    assert.equal(await page.evaluate("[...document.querySelectorAll('.writing-modes button')].every(b=>b.disabled)&&document.querySelector('.writing-modes button.active').dataset.mode==='hybrid'"),true);
    const checks=await runMinimalHeaderChecks({page,app}),views=[];
    for(const width of [1280,980,600]){
      await page.setViewport({width,height:860});await app.waitForIdle();const geometry=await inspectMinimalHeader(page);
      assert.equal(geometry.height,76);assert.equal(geometry.width,208);assert.ok(geometry.centerX<=1&&geometry.centerY<=1,JSON.stringify(geometry));
      await page.screenshot(join(artifacts,'header-'+width+'.png'));views.push({viewportWidth:width,...geometry});
    }
    assert.deepEqual(page.exceptions,[]);await writeFile(join(artifacts,'minimal-header-results.json'),JSON.stringify({passed:true,checks,views,admission},null,2));console.log('Minimal header: '+checks.length+' checks and '+views.length+' viewports passed.');
  }catch(error){if(browser){await writeFile(join(artifacts,'failure.json'),JSON.stringify({error:error.stack,exceptions:browser.page.exceptions,console:browser.page.consoleMessages.filter(x=>x.type==='error')},null,2));await browser.page.screenshot(join(artifacts,'failure.png'));}throw error;
  }finally{try{await browser?.close();}finally{await server.close();}}
});
