import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const browser = await launchChromium({ width: 800, height: 600 });
const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });

try {
  await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${virtualHost.origin}/"><style>
    html,body{margin:0;width:100%;height:100%}#preview{height:120px;overflow:auto}#space{height:1000px}
  </style></head><body><div id="preview"><div id="space"></div></div></body></html>`);
  await browser.page.evaluate(`(async()=>{
    const base=${JSON.stringify(virtualHost.origin)};
    const {createPreviewFocusController}=await import(base+'/src/features/preview/pipeline/preview-focus-controller.js');
    const preview=document.getElementById('preview');
    const scheduler={
      schedule(){return true;},
      cancel(){return true;},
      hasPending(){return false;}
    };
    let releaseOld;
    let section={startLine:1,endLine:10};
    const events=[];
    const controller=createPreviewFocusController({scheduler,focusDelay:0});
    controller.connect({
      isSuspended:()=>false,
      isCursorTrackingEligible:()=>true,
      getFocusSection:()=>section,
      getMode:()=> 'chapter',
      isVirtualWindowActive:()=>false,
      virtualWindowContainsLine:()=>false,
      refreshPreview({line}){
        if(line===50){
          return new Promise(resolve=>{releaseOld=()=>{section={startLine:50,endLine:55};resolve();};});
        }
        section={startLine:line,endLine:line+5};
        return true;
      },
      ensureLineVisible:()=>null,
      invalidateAnchors:()=>events.push('invalidate'),
      scrollToLine(line){preview.scrollTop=line*10;events.push(line);}
    });
    const oldRequest=controller.focusLine(50);
    const newResult=await controller.focusLine(5);
    const afterNew=preview.scrollTop;
    releaseOld();
    const oldResult=await oldRequest;
    window.__focusResult={newResult,oldResult,afterNew,finalTop:preview.scrollTop,events};
    controller.destroy();
  })()`);

  const result = await browser.page.evaluate(`window.__focusResult`);
  assert.equal(result.newResult, true);
  assert.equal(result.oldResult, false);
  assert.equal(result.afterNew, 50);
  assert.equal(result.finalTop, 50, 'stale async focus must not overwrite the newer preview position');
  assert.deepEqual(result.events, [5]);
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 7.11 stale focus request cannot overwrite newer preview positioning');
} finally {
  await virtualHost.close();
  await browser.close();
}
