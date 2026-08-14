import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const browser = await launchChromium({ width: 900, height: 700 });
const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });

try {
  await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${virtualHost.origin}/"><style>
    html,body{margin:0;width:100%;height:100%}#preview{width:420px;height:240px;overflow:auto}.virtual-preview-body{margin:0}.preview-virtual-block{min-height:76px;margin:3px 0}.preview-virtual-block p{margin:0}
  </style></head><body><div id="preview"></div></body></html>`);
  await browser.page.evaluate(`(async()=>{
    const base=${JSON.stringify(virtualHost.origin)};
    const {createVirtualWindowController}=await import(base+'/src/features/preview/render/virtual-window/virtual-window-controller.js');
    const root=document.getElementById('preview');
    const state=window.__virtualState={mountedReasons:[],geometry:0,invalidations:0};
    const controller=createVirtualWindowController(root,{
      thresholds:{
        mode:{virtualChars:400000,virtualBlocks:1400},
        virtualWindow:{overscanPx:0,minimumBlocks:4,maximumBlocks:8,prewarmBlocks:4}
      },
      documentRef:document,
      storage:null,
      requestFrame:callback=>requestAnimationFrame(callback),
      cancelFrame:handle=>cancelAnimationFrame(handle),
      createResizeObserver:callback=>new ResizeObserver(callback),
      getComputedStyleFn:node=>getComputedStyle(node),
      scheduleTimer:(callback,delay)=>setTimeout(callback,delay),
      cancelTimer:handle=>clearTimeout(handle),
      scheduleIdle:callback=>callback(),
      now:()=>Date.now(),
      notifyPreviewMounted:reason=>state.mountedReasons.push(reason),
      notifyGeometryChanged:()=>{state.geometry+=1;},
      invalidateAnchorMetrics:()=>{state.invalidations+=1;}
    });
    const blocks=Array.from({length:80},(_,index)=>({
      id:'b'+index,type:'paragraph',startLine:index+1,endLine:index+1,raw:'line '+index
    }));
    const result=controller.update({blocks,changedIds:blocks.map(block=>block.id),reason:'initial'}, {
      forceAll:true,
      createNodes:block=>{const p=document.createElement('p');p.textContent=block.raw;return [p];},
      applySourceRange(nodes,block){for(const node of nodes){node.dataset.sourceLine=String(block.startLine);node.dataset.sourceEndLine=String(block.endLine);}}
    });
    window.__virtualController=controller;
    window.__virtualInitial={
      stats:controller.getStats(),
      childCount:result.body.children.length,
      top:Number.parseFloat(result.body.firstElementChild.style.height)||0,
      bottom:Number.parseFloat(result.body.lastElementChild.style.height)||0
    };
  })()`);

  const initial = await browser.page.evaluate(`window.__virtualInitial`);
  assert.ok(initial.stats.mountedBlocks >= 4 && initial.stats.mountedBlocks <= 8);
  assert.ok(initial.stats.mountedBlocks < initial.stats.blocks);
  assert.equal(initial.childCount, initial.stats.mountedBlocks + 2);
  assert.equal(initial.top, 0);
  assert.ok(initial.bottom > 0);

  await browser.page.waitFor(() => window.__virtualController?.getStats().measuredHeights > 0, {
    timeoutMs: 3000,
    description: 'virtual block measurements committed'
  });
  const measured = await browser.page.evaluate(`window.__virtualController.getStats()`);
  assert.ok(measured.estimatedHeight > initial.stats.estimatedHeight, 'measured heights must correct the estimated geometry');
  assert.ok((await browser.page.evaluate(`window.__virtualState.invalidations`)) > 0);

  await browser.page.evaluate(`(()=>{const root=document.getElementById('preview');root.scrollTop=2200;root.dispatchEvent(new Event('scroll'));})()`);
  await browser.page.waitFor(() => window.__virtualController?.getStats().start > 0, {
    timeoutMs: 3000,
    description: 'virtual window switched after scroll'
  });
  const shifted = await browser.page.evaluate(`(()=>{const controller=window.__virtualController;const stats=controller.getStats();const body=document.querySelector('.virtual-preview-body');return {stats,top:Number.parseFloat(body.firstElementChild.style.height)||0,bottom:Number.parseFloat(body.lastElementChild.style.height)||0,children:body.children.length};})()`);
  assert.ok(shifted.stats.start > 0);
  assert.ok(shifted.stats.mountedBlocks <= 8);
  assert.ok(shifted.stats.mountedBlocks < shifted.stats.blocks);
  assert.equal(shifted.children, shifted.stats.mountedBlocks + 2);
  assert.ok(shifted.top > 0);
  assert.ok(shifted.bottom > 0);

  await browser.page.evaluate(`window.__virtualController.destroy()`);
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 7.10 virtual window initial/scroll/measurement browser contract');
} finally {
  await virtualHost.close();
  await browser.close();
}
