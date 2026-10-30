import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchChromium } from './lib/cdp-browser.mjs';
import { createApplicationDriver } from './lib/application-driver.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';
import { verifyBuiltApplication } from './lib/built-application-check.mjs';
import { runReadingContextChecks } from './lib/reading-context-checks.mjs';
const artifacts=resolve(process.env.E2E_ARTIFACT_DIR);
await mkdir(artifacts,{recursive:true});
const admission=await verifyBuiltApplication({projectRoot:process.cwd(),distRoot:resolve('dist')});
const host=await startBuiltApplicationHost('dist'),browser=await launchChromium({width:1440,height:900});
try {
  const page=browser.page;
  await page.connection.send('Browser.grantPermissions',{origin:host.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await page.addInitScript("localStorage.setItem('md_editor_help_shown','true')");
  await page.navigate(host.origin+'/?e2e=1');await page.waitFor(()=>document.documentElement.classList.contains('app-ready'));
  const checks=await runReadingContextChecks({page,app:createApplicationDriver(page),artifacts});
  await writeFile(join(artifacts,'reading-context-results.json'),JSON.stringify({admission,checks,exceptions:page.exceptions},null,2));
  console.log(`Reading/context checks: ${checks.length} passed.`);
} catch(error) {
  await browser.page.screenshot(join(artifacts,'reading-context-failure.png'));
  await writeFile(join(artifacts,'reading-context-failure.json'),JSON.stringify({error:error.stack,exceptions:browser.page.exceptions},null,2));throw error;
} finally {await browser.close();await host.close();}
