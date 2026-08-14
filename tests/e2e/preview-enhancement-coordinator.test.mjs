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
    #preview{height:120px;overflow:auto;position:relative} .root{height:80px} #gap{height:500px}
  </style></head><body><div id="preview"><div id="visible" class="root" data-source-line="1" data-source-end-line="5">$x$<pre><code class="language-mermaid">graph TD</code></pre></div><div id="gap"></div><div id="buffer" class="root" data-source-line="100" data-source-end-line="110">$y$</div></div></body></html>`);
  await browser.page.evaluate(`(async()=>{
    const base=${JSON.stringify(virtualHost.origin)};
    const {createPreviewEnhancementCoordinator}=await import(base+'/src/features/preview/pipeline/preview-enhancement-coordinator.js');
    const preview=document.getElementById('preview');
    let inputPending=true;
    let queue=[];
    const events=[];
    const scheduler={
      schedule(channel,callback,options={}){queue=queue.filter(item=>item.channel!==channel);queue.push({channel,callback,options});return true;},
      cancel(channel){queue=queue.filter(item=>item.channel!==channel);return true;},
      hasPending(channel){return channel==='input'?inputPending:queue.some(item=>item.channel===channel);},
      async runNext(){
        const item=queue.shift(); if(!item)return false;
        await item.callback({deadline:{didTimeout:false,timeRemaining:()=>10},schedule(callback,options={}){queue.push({channel:item.channel,callback,options});return true;}});
        return true;
      }
    };
    const coordinator=createPreviewEnhancementCoordinator({scheduler,thresholds:{idleTimeoutMs:10,fallbackMs:1,minimumTimeRemainingMs:1}});
    coordinator.connect({
      getLineRange(root){const start=Number(root.dataset.sourceLine)||1;return{start,end:Number(root.dataset.sourceEndLine)||start};},
      getPriority(root){const top=root.offsetTop,bottom=top+root.offsetHeight;return bottom>=preview.scrollTop&&top<=preview.scrollTop+preview.clientHeight?0:2;},
      hasMath(root){return root.textContent.includes('$');},
      hasMermaid(root){return Boolean(root.querySelector('code.language-mermaid'));},
      isConnected(root){return root.isConnected;},
      styleRoots([root]){events.push('style:'+root.id);},
      renderMath([root]){events.push('math:'+root.id);},
      async renderMermaid([root],isCancelled){events.push('mermaid:'+root.id+':'+(isCancelled()?'cancelled':'current'));},
      animate(){},
      onBatchComplete(){},
      isVersionCurrent(version){return version===1;}
    });
    coordinator.begin(1);
    coordinator.enqueue([document.getElementById('buffer'),document.getElementById('visible')]);
    await scheduler.runNext();
    const whileInput=events.slice();
    inputPending=false;
    for(let i=0;i<20&&queue.length;i+=1)await scheduler.runNext();
    window.__enhancementResult={whileInput,events,pending:coordinator.getStats().pending};
    coordinator.destroy();
  })()`);

  const result = await browser.page.evaluate(`window.__enhancementResult`);
  assert.deepEqual(result.whileInput, [], 'secondary enhancements must yield while input work is pending');
  assert.deepEqual(result.events.slice(0, 3), ['style:visible', 'math:visible', 'mermaid:visible:current']);
  assert.ok(result.events.indexOf('math:visible') < result.events.indexOf('math:buffer'));
  assert.equal(result.pending, 0);
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 7.12 yields to input and prioritizes visible Math/Mermaid enhancement work');
} finally {
  await virtualHost.close();
  await browser.close();
}
