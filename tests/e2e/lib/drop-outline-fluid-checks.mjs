import assert from 'node:assert/strict';
import { join } from 'node:path';
import { evaluateApplication } from './application-inspector.mjs';

async function contextClick(page,selector) {
  const r=await page.elementRect(selector),point={x:r.x+r.width/2,y:r.y+r.height/2,button:'right',clickCount:1};
  await page.connection.send('Input.dispatchMouseEvent',{type:'mousePressed',buttons:2,...point});
  await page.connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',buttons:0,...point});
}

/** Actual app geometry, drop lifecycle and subtree actions; no replacement owners. */
export async function runDropOutlineFluidChecks({page,app,artifacts,browserDrop=true,resizeViewport=size=>page.setViewport(size)}) {
  const checks=[];
  if(await page.evaluate("!document.getElementById('settings-modal').hidden")) {
    await page.click('#settings-modal .sidebar-footer-action');
    await page.waitFor(()=>document.getElementById('settings-modal').hidden);
  }
  const settle=()=>page.evaluate('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),300))');
  const source='# Alpha\n\n## A1\n\n### A1a\n\n#### A1leaf\n\n## A2\n\n### A2leaf\n\n# Beta\n\n## B1\n\n### B1leaf\n\n'+('正文需要随编辑区域宽度伸缩，不能被固定正文宽度截住。'.repeat(90));
  const widths=[];
  for(const mode of ['hybrid','both'])for(const width of [900,1280,1920,2560]) {
    await resizeViewport({width,height:900});await app.loadMarkdown(source,{layout:mode,selection:0});await app.waitForIdle();await settle();
    const geometry=await page.evaluate(`(()=>{const c=document.querySelector('#editor .cm-content'),s=document.querySelector('#editor .cm-scroller'),g=document.querySelector('#editor .cm-gutters');return {width:innerWidth,content:c.getBoundingClientRect().width,available:s.clientWidth-(g?.getBoundingClientRect().width||0),max:getComputedStyle(c).maxWidth,page:document.documentElement.scrollWidth};})()`);
    assert.equal(geometry.max,'none');assert.ok(Math.abs(geometry.content-geometry.available)<2,JSON.stringify({mode,...geometry}));
    assert.ok(geometry.page<=width);widths.push({mode,...geometry});checks.push(mode+' fills available editor at '+width);
  }
  await page.screenshot(join(artifacts,'fluid-split-2560.png'));
  assert.ok(widths.find(x=>x.mode==='hybrid'&&x.width===2560).content>1800);
  assert.ok(widths.find(x=>x.mode==='both'&&x.width===2560).content>900);
  await resizeViewport({width:1280,height:860});await app.loadMarkdown(source,{layout:'hybrid',selection:0});await settle();
  await page.screenshot(join(artifacts,'fluid-writing-1280.png'));
  await page.click('#sidebar-outline-tab');
  const headings=await evaluateApplication(page,'applicationCapabilities.markdownEditorOutlineControllerPort.snapshot.headings.map(({id,text})=>({id,text}))');
  const id=text=>headings.find(h=>h.text===text).id;
  const row=text=>`#outline-list .outline-link[data-outline-id="${id(text)}"]`;
  const collapsed=text=>page.evaluate(`document.querySelector('#outline-list .outline-node[data-outline-id="${id(text)}"]').classList.contains('is-collapsed')`);
  await page.click(row('Beta'));await contextClick(page,row('Alpha'));
  assert.equal(await page.evaluate("document.getElementById('outline-context-collapse-node').textContent"),'折叠所有子集');
  await page.screenshot(join(artifacts,'outline-subtree-menu.png'));
  await page.click('#outline-context-collapse-node');
  assert.equal(await collapsed('Alpha'),false);assert.equal(await collapsed('A1'),true);assert.equal(await collapsed('A1a'),true);
  assert.equal(await collapsed('A2'),true);assert.equal(await collapsed('Beta'),false);assert.equal(await collapsed('B1'),false);
  checks.push('right-click subtree recursively collapses descendants without collapsing its root or another branch');
  await contextClick(page,row('Alpha'));await page.click('[data-outline-context-action="expand-all"]');
  await page.click(row('A1'));
  await page.evaluate("document.getElementById('sidebar-outline-panel').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:520}))");
  await page.click('#outline-context-collapse-node');
  assert.equal(await collapsed('A1'),false);assert.equal(await collapsed('A1a'),true);assert.equal(await collapsed('B1'),false);
  assert.equal(await app.getEditorValue(),source);checks.push('blank outline context uses the selected heading');
  await page.evaluate("document.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))");
  const overlay=await page.evaluate("(()=>{const e=document.getElementById('drop-overlay'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {shown:e.classList.contains('show'),text:e.textContent.trim(),children:e.children.length,blur:s.backdropFilter,border:s.borderWidth,w:r.width,h:r.height};})()");
  assert.deepEqual(overlay,{shown:true,text:'',children:0,blur:'blur(4px)',border:'2px',w:1280,h:860});
  await page.screenshot(join(artifacts,'drop-blur-no-card.png'));checks.push('file drag shows only full-window blur and blue border');
  await page.evaluate("document.dispatchEvent(new DragEvent('dragleave',{bubbles:true,cancelable:true}))");
  assert.equal(await page.evaluate("document.getElementById('drop-overlay').classList.contains('show')"),false);
  if(browserDrop) {
    const dropped='# 实际拖入\n\n导入链路仍然保留。';
    await page.evaluate(`(()=>{const data=new DataTransfer();data.items.add(new File([${JSON.stringify(dropped)}],'drop-check.md',{type:'text/markdown'}));document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`);
    for(let i=0;i<100;i++){if(await app.getEditorValue()===dropped)break;await settle();}
    assert.equal(await app.getEditorValue(),dropped);checks.push('actual dropped Markdown still reaches the document');
  }
  assert.equal(await page.evaluate("document.getElementById('drop-overlay').classList.contains('show')"),false);
  return checks;
}
