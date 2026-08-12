import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const browser = await launchChromium({ width: 500, height: 300 });
const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });

try {
  await browser.page.setViewport({ width: 500, height: 300 });
  await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${virtualHost.origin}/"><style>
    html,body{margin:0;width:100%;height:100%}.menu-submenu{position:fixed;width:50px;height:32px}.menu-submenu-list{display:block;width:120px;height:100px}.right{left:440px;top:260px}.left{left:50px;top:20px}
  </style></head><body>
    <div id="root">
      <div id="right" class="menu-submenu right"><button id="right-focus">right</button><div id="right-list" class="menu-submenu-list"><button id="right-child">child</button></div></div>
      <div id="left" class="menu-submenu left"><span>left</span><div id="left-list" class="menu-submenu-list"></div></div>
    </div>
    <button id="outside">outside</button>
  </body></html>`);
  const moduleUrl = `${virtualHost.origin}/src/features/menu/index.js`;
  await browser.page.evaluate(`(async()=>{
    const {createSubmenuPositioner}=await import(${JSON.stringify(moduleUrl)});
    window.__submenuPositioner=createSubmenuPositioner({root:document.getElementById('root'),runtime:window,closeDelayMs:30});
    window.__submenuPositioner.start();
  })()`);

  await browser.page.evaluate(`document.getElementById('right').dispatchEvent(new PointerEvent('pointerenter'))`);
  await browser.page.waitFor(() => document.getElementById('right-list')?.style.position === 'absolute', { description: 'right submenu positioned' });
  const right = await browser.page.evaluate(`(()=>{const owner=document.getElementById('right'),list=document.getElementById('right-list');return {open:owner.classList.contains('is-submenu-open'),left:list.style.left,top:list.style.top,position:list.style.position}})()`);
  assert.deepEqual(right, { open: true, left: '-124px', top: '-68px', position: 'absolute' });

  await browser.page.evaluate(`document.getElementById('left').dispatchEvent(new PointerEvent('pointerenter'))`);
  await browser.page.waitFor(() => document.getElementById('left-list')?.style.position === 'absolute', { description: 'left submenu positioned' });
  const left = await browser.page.evaluate(`(()=>{const list=document.getElementById('left-list');return {left:list.style.left,top:list.style.top}})()`);
  assert.deepEqual(left, { left: '54px', top: '-6px' });

  // Focus behavior is verified independently of pointer hover. Synthetic pointerenter does not establish CSS :hover,
  // so reset the pointer-opened state, move the real browser pointer to a neutral location, then open by focusin.
  await browser.page.evaluate(`window.__submenuPositioner.closeAll()`);
  await browser.page.connection.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: 250, y: 150, button: 'none', buttons: 0
  });
  await browser.page.evaluate(`document.getElementById('right-focus').focus()`);
  await browser.page.waitFor(() => document.getElementById('right')?.classList.contains('is-submenu-open'), { description: 'focus opens submenu' });
  await browser.page.evaluate(`document.getElementById('right-child').focus()`);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 60));
  assert.equal(await browser.page.evaluate(`document.getElementById('right').classList.contains('is-submenu-open')`), true);

  await browser.page.evaluate(`document.getElementById('outside').focus()`);
  await browser.page.waitFor(() => !document.getElementById('right')?.classList.contains('is-submenu-open'), { timeoutMs: 1000, description: 'focus-out delayed close' });
  assert.equal(await browser.page.evaluate(`document.getElementById('right-list').style.position`), '');

  await browser.page.evaluate(`window.__submenuPositioner.destroy();document.getElementById('left').dispatchEvent(new PointerEvent('pointerenter'))`);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  const destroyed = await browser.page.evaluate(`(()=>{const owner=document.getElementById('left'),list=document.getElementById('left-list');return {open:owner.classList.contains('is-submenu-open'),position:list.style.position}})()`);
  assert.deepEqual(destroyed, { open: false, position: '' });
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 6.11 submenu browser geometry/focus/destroy contract');
} finally {
  await virtualHost.close();
  await browser.close();
}
