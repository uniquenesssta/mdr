import assert from 'node:assert/strict';
import {openWorkspaceExport,openWorkspaceFind} from './workspace-header-actions.mjs';

export async function inspectMinimalHeader(page) {
  return page.evaluate(`(()=>{const header=document.querySelector('.l-toolbar-shell'),h=header.getBoundingClientRect(),m=header.querySelector('.writing-modes').getBoundingClientRect();return {labels:[...header.querySelectorAll('.writing-modes button')].map(b=>b.textContent),modes:[...header.querySelectorAll('.writing-modes button')].map(b=>b.dataset.mode),height:h.height,width:m.width,centerX:Math.abs((h.left+h.right-m.left-m.right)/2),centerY:Math.abs((h.top+h.bottom-m.top-m.bottom)/2),titleVisible:document.getElementById('filename').getBoundingClientRect().width>0,actions:header.querySelectorAll('.writing-actions,[data-workspace-export]').length};})()`);
}

export async function runMinimalHeaderChecks({page,app}) {
  const checks=[];const check=(name,value)=>{assert.equal(value,true,name);checks.push(name);};
  const geometry=await inspectMinimalHeader(page);
  assert.deepEqual(geometry.labels,['写作','分栏','纯阅读']);assert.deepEqual(geometry.modes,['hybrid','both','preview']);
  check('header contains only the three requested visible modes',!geometry.titleVisible&&geometry.actions===0);
  check('mode group is 208px wide and centered in the 76px header',geometry.width===208&&geometry.height===76&&geometry.centerX<=1&&geometry.centerY<=1);
  const text='# 简洁页头\n\n这里是实际文档内容。';
  await app.loadMarkdown(text,{name:'顶部简化验证.md',layout:'hybrid',selection:0});
  for(const mode of ['both','preview','hybrid']){
    await page.click(`.writing-modes [data-mode="${mode}"]`);await app.waitForIdle();
    const state=await page.evaluate(`({active:document.querySelector('.writing-modes button.active').dataset.mode,readonly:document.querySelector('#editor .cm-content').contentEditable==='false'})`);
    check(mode+' switches the actual document view',state.active===mode&&state.readonly===(mode==='preview'));
  }
  await openWorkspaceFind(page);await page.waitFor(()=>document.getElementById('find-modal').classList.contains('show'));
  check('find remains available through its real shortcut',true);await page.pressKey('Escape');
  await openWorkspaceExport(page);await page.waitFor(()=>document.getElementById('export-document-modal').classList.contains('show'));
  const exportState=await page.evaluate(`({name:document.querySelector('.writing-export-name').textContent,formats:document.querySelectorAll('.writing-export-formats button').length,menu:document.querySelector('[data-menu-toggle="file-menu"]').getAttribute('aria-expanded')})`);
  check('file menu opens all five export formats with the actual active document name',exportState.name==='顶部简化验证.md'&&exportState.formats===5&&exportState.menu==='false');
  await page.waitFor(()=>document.getElementById('export-document-modal').contains(document.activeElement));
  await page.pressKey('Escape');
  await page.waitFor(()=>getComputedStyle(document.getElementById('export-document-modal')).display==='none');
  await page.waitFor(()=>document.activeElement===document.querySelector('[data-menu-toggle="file-menu"]'));
  check('closing export returns keyboard focus to the visible File menu',true);
  assert.equal(await app.getEditorValue(),text);check('header simplification preserves actual document content',true);
  return checks;
}
