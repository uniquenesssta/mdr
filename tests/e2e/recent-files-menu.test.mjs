import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const browser = await launchChromium({ width: 700, height: 500 });
const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });

try {
  await browser.page.setDocumentContent(`<!doctype html><html><body>
    <div id="recent-files-menu-item" class="menu-item menu-submenu">
      <span>最近打开</span>
      <div id="recent-files-menu" class="menu-dropdown-list menu-submenu-list"></div>
    </div>
  </body></html>`);
  const moduleUrl = `${virtualHost.origin}/src/features/menu/index.js`;
  await browser.page.evaluate(`(async()=>{
    const {createRecentFilesMenuController}=await import(${JSON.stringify(moduleUrl)});
    let listener=null;
    let snapshot=Object.freeze({entries:Object.freeze([
      Object.freeze({path:'C:/Notes/A.md',name:'A.md',openedAt:2}),
      Object.freeze({path:'C:/Notes/B.md',name:'B.md',openedAt:1})
    ]),revision:1});
    window.__recentCalls=[];
    window.__recentSource={
      get snapshot(){return snapshot;},
      subscribe(next){listener=next;return()=>{if(listener===next)listener=null;};},
      publish(entries){const previous=snapshot;snapshot=Object.freeze({entries:Object.freeze(entries),revision:snapshot.revision+1});listener?.(Object.freeze({previous,snapshot}));},
      hasListener(){return Boolean(listener);}
    };
    window.__recentController=createRecentFilesMenuController({
      owner:document.getElementById('recent-files-menu-item'),
      list:document.getElementById('recent-files-menu'),
      source:window.__recentSource,
      commands:{execute(commandId,payload){window.__recentCalls.push({commandId,payload});return true;}},
      available:true
    });
    window.__recentController.start();
  })()`);

  const initial = await browser.page.evaluate(`(()=>{const list=document.getElementById('recent-files-menu');return {count:list.children.length,first:list.children[0].textContent,second:list.children[1].textContent,clear:list.children[3].textContent,listener:window.__recentSource.hasListener()};})()`);
  assert.deepEqual(initial, { count: 4, first: 'A.md', second: 'B.md', clear: '清空记录', listener: true });

  await browser.page.evaluate(`document.querySelector('.recent-file-item span').click()`);
  assert.deepEqual(await browser.page.evaluate(`window.__recentCalls[0]`), {
    commandId: 'document.open-recent',
    payload: { path: 'C:/Notes/A.md', source: 'recent-files-menu' }
  });

  await browser.page.evaluate(`window.__recentSource.publish([Object.freeze({path:'D:/Work/C.md',name:'C.md',openedAt:3})])`);
  await browser.page.waitFor(() => document.querySelector('.recent-file-item')?.textContent === 'C.md', { description: 'recent files snapshot projected' });
  assert.equal(await browser.page.evaluate(`document.getElementById('recent-files-menu').children.length`), 3);

  await browser.page.evaluate(`document.querySelector('[data-recent-files-action="clear"]').click()`);
  assert.deepEqual(await browser.page.evaluate(`window.__recentCalls[1]`), {
    commandId: 'document.clear-recent',
    payload: { source: 'recent-files-menu' }
  });

  await browser.page.evaluate(`window.__recentController.destroy();window.__recentSource.publish([Object.freeze({path:'E:/After.md',name:'After.md'})])`);
  const destroyed = await browser.page.evaluate(`(()=>({count:document.getElementById('recent-files-menu').children.length,listener:window.__recentSource.hasListener()}))()`);
  assert.deepEqual(destroyed, { count: 0, listener: false });
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 6.12 Recent Files Menu browser subscription/command/destroy contract');
} finally {
  await virtualHost.close();
  await browser.close();
}
