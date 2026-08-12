import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const browser = await launchChromium({ width: 720, height: 520 });
const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });

try {
  await browser.page.setDocumentContent(`<!doctype html><html><body>
    <div class="menu-bar" style="width:600px;height:44px">
      <div class="menu-dropdown">File</div>
      <div id="window-controls" hidden>
        <button id="window-minimize-btn">-</button>
        <button id="window-maximize-btn" data-maximized="false"><svg><use href="/assets/icons.svg#icon-maximize"></use></svg></button>
        <button id="window-close-btn">x</button>
      </div>
    </div>
  </body></html>`);
  const moduleUrl = `${virtualHost.origin}/src/features/window/index.js`;
  await browser.page.evaluate(`(async()=>{
    const {
      createWindowState,createWindowControlsView,createWindowDragRegion,
      createWindowCloseController,createWindowController
    }=await import(${JSON.stringify(moduleUrl)});
    let maximized=false;
    let resizeHandler=null;
    let closeHandler=null;
    window.__windowCalls=[];
    const port={
      async startDrag(){window.__windowCalls.push('startDrag');},
      async minimize(){window.__windowCalls.push('minimize');},
      async toggleMaximize(){window.__windowCalls.push('toggleMaximize');maximized=!maximized;return maximized;},
      async isMaximized(){window.__windowCalls.push('isMaximized');return maximized;},
      async subscribeResize(handler){window.__windowCalls.push('subscribeResize');resizeHandler=handler;return async()=>{window.__windowCalls.push('disposeResize');resizeHandler=null;};},
      async subscribeCloseRequest(handler){window.__windowCalls.push('subscribeClose');closeHandler=handler;return async()=>{window.__windowCalls.push('disposeClose');closeHandler=null;};},
      async requestClose(){window.__windowCalls.push('requestClose');},
      async forceClose(){window.__windowCalls.push('forceClose');}
    };
    const state=createWindowState();
    let controller=null;
    const controlsView=createWindowControlsView({
      state,
      root:document.documentElement,
      controls:document.getElementById('window-controls'),
      minimizeButton:document.getElementById('window-minimize-btn'),
      maximizeButton:document.getElementById('window-maximize-btn'),
      closeButton:document.getElementById('window-close-btn'),
      onMinimize:()=>controller.minimize(),
      onToggleMaximize:()=>controller.toggleMaximize(),
      onClose:()=>controller.requestClose('control')
    });
    const dragRegion=createWindowDragRegion({
      target:document.querySelector('.menu-bar'),
      enabled:true,
      startDrag:()=>controller.startDrag(),
      toggleMaximize:()=>controller.toggleMaximize()
    });
    const closeController=createWindowCloseController({
      state,windowPort:port,supported:true,
      closeSave:{async prepareClose(){window.__windowCalls.push('prepareClose');return true;}}
    });
    controller=createWindowController({state,windowPort:port,controlsView,dragRegion,closeController,supported:true});
    window.__windowController=controller;
    window.__windowState=state;
    window.__emitResize=value=>{maximized=Boolean(value);resizeHandler?.({});};
    window.__emitNativeClose=()=>{const event={prevented:false,preventDefault(){this.prevented=true;}};closeHandler?.(event);window.__nativeCloseEvent=event;return event.prevented;};
    await controller.start();
  })()`);

  const initial = await browser.page.evaluate(`(()=>({
    hidden:document.getElementById('window-controls').hidden,
    tauri:document.documentElement.classList.contains('tauri-shell'),
    maximized:document.documentElement.classList.contains('window-maximized'),
    icon:document.querySelector('#window-maximize-btn use').getAttribute('href'),
    calls:[...window.__windowCalls]
  }))()`);
  assert.equal(initial.hidden, false);
  assert.equal(initial.tauri, true);
  assert.equal(initial.maximized, false);
  assert.equal(initial.icon, '/assets/icons.svg#icon-maximize');
  assert.ok(initial.calls.includes('subscribeClose'));
  assert.ok(initial.calls.includes('subscribeResize'));
  assert.ok(initial.calls.includes('isMaximized'));

  await browser.page.evaluate(`document.getElementById('window-minimize-btn').click()`);
  await browser.page.waitFor(() => window.__windowCalls.includes('minimize'), { description: 'window minimize command' });

  await browser.page.evaluate(`document.getElementById('window-maximize-btn').click()`);
  await browser.page.waitFor(() => document.documentElement.classList.contains('window-maximized'), { description: 'window maximize projection' });
  const maximized = await browser.page.evaluate(`(()=>({
    data:document.getElementById('window-maximize-btn').dataset.maximized,
    title:document.getElementById('window-maximize-btn').title,
    aria:document.getElementById('window-maximize-btn').getAttribute('aria-label'),
    icon:document.querySelector('#window-maximize-btn use').getAttribute('href')
  }))()`);
  assert.deepEqual(maximized, { data: 'true', title: '还原窗口', aria: '还原窗口', icon: '/assets/icons.svg#icon-restore' });

  const beforeInteractiveDrag = await browser.page.evaluate(`window.__windowCalls.filter(call=>call==='startDrag').length`);
  await browser.page.evaluate(`document.getElementById('window-minimize-btn').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1,detail:1}))`);
  assert.equal(await browser.page.evaluate(`window.__windowCalls.filter(call=>call==='startDrag').length`), beforeInteractiveDrag);
  await browser.page.evaluate(`document.querySelector('.menu-bar').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1,detail:1}))`);
  await browser.page.waitFor(() => window.__windowCalls.includes('startDrag'), { description: 'window drag command' });

  const toggleCount = await browser.page.evaluate(`window.__windowCalls.filter(call=>call==='toggleMaximize').length`);
  await browser.page.evaluate(`document.querySelector('.menu-bar').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1,detail:2}))`);
  await browser.page.waitFor(`window.__windowCalls.filter(call=>call==='toggleMaximize').length > ${toggleCount}`, { description: 'double click maximize command' });

  await browser.page.evaluate(`window.__emitResize(true)`);
  await browser.page.waitFor(() => window.__windowState.snapshot.maximized === true, { description: 'resize maximize refresh' });
  await browser.page.evaluate(`window.__emitResize(false)`);
  await browser.page.waitFor(() => window.__windowState.snapshot.maximized === false, { description: 'resize restore refresh' });

  assert.equal(await browser.page.evaluate(`window.__emitNativeClose()`), true);
  await browser.page.waitFor(() => window.__windowCalls.includes('requestClose'), { description: 'native close save and close command' });
  const nativeOrder = await browser.page.evaluate(`window.__windowCalls.filter(call=>call==='prepareClose'||call==='requestClose')`);
  assert.deepEqual(nativeOrder.slice(-2), ['prepareClose', 'requestClose']);

  await browser.page.evaluate(`window.__windowState.setClosePhase('idle');document.getElementById('window-close-btn').click()`);
  await browser.page.waitFor(() => window.__windowCalls.filter(call=>call==='requestClose').length === 2, { description: 'control close command' });

  await browser.page.evaluate(`window.__windowController.destroy()`);
  await browser.page.waitFor(() => window.__windowCalls.includes('disposeResize') && window.__windowCalls.includes('disposeClose'), { description: 'window subscription cleanup' });
  const destroyed = await browser.page.evaluate(`(()=>({
    hidden:document.getElementById('window-controls').hidden,
    tauri:document.documentElement.classList.contains('tauri-shell'),
    maximized:document.documentElement.classList.contains('window-maximized'),
    calls:window.__windowCalls.length
  }))()`);
  assert.deepEqual({ hidden: destroyed.hidden, tauri: destroyed.tauri, maximized: destroyed.maximized }, { hidden: true, tauri: false, maximized: false });

  await browser.page.evaluate(`{
    document.getElementById('window-minimize-btn').click();
    document.querySelector('.menu-bar').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1,detail:1}));
  }`);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await browser.page.evaluate(`window.__windowCalls.length`), destroyed.calls);
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 6.13 Window Controller browser controls/drag/resize/close/destroy contract');
} finally {
  await virtualHost.close();
  await browser.close();
}
