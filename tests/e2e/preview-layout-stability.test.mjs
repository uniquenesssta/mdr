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
    html,body{margin:0;width:100%;height:100%}.preview-pane{width:420px;height:260px}.preview-pane.collapsed{display:none}#preview{width:100%;height:100%;overflow:auto}.markdown-body{min-height:40px}
  </style></head><body><section id="pane" class="preview-pane collapsed"><div id="preview"></div></section></body></html>`);
  await browser.page.evaluate(`(async()=>{
    const base=${JSON.stringify(virtualHost.origin)};
    const [{createPreviewCancellation},{createPreviewScheduler},{createPreviewLayoutStability}]=await Promise.all([
      import(base+'/src/features/preview/pipeline/preview-cancellation.js'),
      import(base+'/src/features/preview/pipeline/preview-scheduler.js'),
      import(base+'/src/features/preview/pipeline/preview-layout-stability.js')
    ]);
    const root=document.getElementById('preview');
    const pane=document.getElementById('pane');
    const cancellation=createPreviewCancellation();
    const scheduler=createPreviewScheduler({cancellation});
    const state=window.__layoutState={renders:0,refreshes:0,invalidations:0,geometry:0,stable:false};
    const controller=createPreviewLayoutStability({
      root,pane,scheduler,thresholds:{maxAttempts:18,stableFrames:2,retryMs:34},
      createResizeObserver:callback=>new ResizeObserver(callback),
      now:()=>performance.now()
    });
    controller.connect({
      isSuspended:()=>false,
      hasStablePreview:()=>state.stable,
      inspectRenderTarget:()=>{const body=root.querySelector('.markdown-body');return {present:Boolean(body),loading:Boolean(body?.classList.contains('preview-loading')),empty:!body||body.childElementCount===0};},
      render(){state.renders+=1;const body=document.createElement('div');body.className='markdown-body';body.append(document.createElement('p'));root.replaceChildren(body);state.stable=true;},
      refreshViewport(){state.refreshes+=1;},
      invalidateGeometry(){state.invalidations+=1;},
      notifyGeometryChanged(reason){if(reason!=='preview')throw new Error('unexpected geometry reason');state.geometry+=1;},
      getStats:()=>({previewBlocks:1,mountedBlocks:0})
    });
    controller.start();
    controller.requestRefresh({forceRender:true,reason:'hidden-start'});
    window.__layoutController=controller;
    window.__layoutScheduler=scheduler;
  })()`);

  await new Promise(resolvePromise => setTimeout(resolvePromise, 90));
  assert.equal(await browser.page.evaluate(`window.__layoutState.renders`), 0, 'hidden preview must not render into zero geometry');

  await browser.page.evaluate(`document.getElementById('pane').classList.remove('collapsed')`);
  await browser.page.waitFor(() => window.__layoutState?.renders === 1 && window.__layoutState?.geometry >= 2, {
    timeoutMs: 3000,
    description: 'first visible preview stabilized and geometry published'
  });
  const visible = await browser.page.evaluate(`(()=>({
    width:document.getElementById('preview').clientWidth,
    height:document.getElementById('preview').clientHeight,
    ...window.__layoutState
  }))()`);
  assert.equal(visible.renders, 1);
  assert.ok(visible.width > 0 && visible.height > 0);
  assert.ok(visible.refreshes >= 2 && visible.invalidations >= 2 && visible.geometry >= 2);

  const geometryBeforeResize = visible.geometry;
  await browser.page.evaluate(`window.__layoutGeometryTarget=${geometryBeforeResize + 2};document.getElementById('pane').style.width='520px'`);
  await browser.page.waitFor(() => window.__layoutState?.geometry >= window.__layoutGeometryTarget, {
    timeoutMs: 3000,
    description: 'container resize geometry refresh'
  });
  assert.equal(await browser.page.evaluate(`window.__layoutState.renders`), 1, 'stable populated preview should not rerender on size-only change');

  const beforeDestroy = await browser.page.evaluate(`window.__layoutState.geometry`);
  await browser.page.evaluate(`window.__layoutController.destroy();window.__layoutScheduler.destroy();document.getElementById('pane').style.width='600px'`);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 120));
  assert.equal(await browser.page.evaluate(`window.__layoutState.geometry`), beforeDestroy);
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 7.9 preview layout visibility/stability/geometry browser contract');
} finally {
  await virtualHost.close();
  await browser.close();
}
