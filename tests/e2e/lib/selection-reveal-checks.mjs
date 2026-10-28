import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function runSelectionRevealChecks({page,app,artifacts}) {
  const checks=[];
  const check=(name,value)=>{assert.equal(value,true,name);checks.push(name);};
  const source='# 定位保持稳定\n\n'+Array.from({length:30},(_,i)=>`可见段落 ${String(i+1).padStart(2,'0')}：选择不同文字时，预览只更新高亮，不反复移动页面。\n\n`).join('');
  await app.loadMarkdown(source,{layout:'both',selection:0});await app.waitForIdle();
  const sidebarWidth=await page.evaluate("document.querySelector('.l-sidebar').getBoundingClientRect().width");
  await page.click('[data-sidebar-hide]');
  await page.waitFor(()=>document.querySelector('.l-sidebar').getBoundingClientRect().width===0);
  const collapsed=await page.evaluate(`(()=>{const side=document.querySelector('.l-sidebar'),main=document.querySelector('.l-workspace-main');return {width:side.getBoundingClientRect().width,display:getComputedStyle(side).display,mainLeft:main.getBoundingClientRect().left,workspaceLeft:main.parentElement.getBoundingClientRect().left,resizer:getComputedStyle(document.querySelector('.l-sidebar-resizer')).display};})()`);
  check('collapsed sidebar and resizer occupy no space',collapsed.width===0&&collapsed.display==='none'&&collapsed.resizer==='none'&&collapsed.mainLeft===collapsed.workspaceLeft);
  await page.screenshot(join(artifacts,'sidebar-collapsed.png'));
  await page.pressKey('B',{modifiers:10,code:'KeyB'});
  await page.waitFor(`document.querySelector('.l-sidebar').getBoundingClientRect().width===${sidebarWidth}`);
  check('the existing shortcut restores the original sidebar width',true);
  await app.waitForIdle();
  for(const label of ['可见段落 01','可见段落 02','可见段落 03']) {
    const points=await page.evaluate(`(()=>{const root=[...document.querySelectorAll('#editor .cm-line')].find(n=>n.textContent.includes(${JSON.stringify(label)}));if(!root)throw Error('Source row missing');const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())&&n.textContent.length<6){}if(!n)throw Error('Source text missing');const a=document.createRange(),b=document.createRange();a.setStart(n,0);a.setEnd(n,1);b.setStart(n,5);b.setEnd(n,6);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {start:{x:x.left+1,y:x.top+x.height/2},end:{x:y.right-1,y:y.top+y.height/2}};})()`);
    const before=await page.evaluate("document.querySelector('#preview').scrollTop");
    await page.drag(points.start,points.end,{steps:8});
    await page.waitFor(()=>CSS.highlights?.has('preview-selection-sync')||document.querySelector('.preview-text-highlight'));
    const values=await page.evaluate(`new Promise(resolve=>{const values=[];const frame=()=>{values.push(document.querySelector('#preview').scrollTop);if(values.length===90)resolve(values);else requestAnimationFrame(frame);};requestAnimationFrame(frame);})`);
    check(label+' keeps the visible preview fixed through subsequent mounts',values.every(value=>Math.abs(value-before)<=1));
  }
  assert.equal(await app.getEditorValue(),source);
  check('selection and sidebar changes preserve the real document',true);
  await page.screenshot(join(artifacts,'visible-selection-stable.png'));
  return checks;
}
