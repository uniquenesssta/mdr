import assert from 'node:assert/strict';
import {openWorkspaceFind} from './workspace-header-actions.mjs';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** Verify user-configured selection tools, genuine read-only mode and narrow content. */
export async function runWritingPreferenceChecks({ page, app, artifacts }) {
  const checks = [];
  const check = (name, value) => { assert.equal(value, true, name); checks.push(name); };
  const settle = () => page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const doc = '# 全功能测试\n\n> 这是一份面向当前版本的综合展示与回归测试文档。\n> 建议分别在混合模式、仅编辑模式和编辑加预览模式中查看，并测试滚动同步、双向划选、源码切换、复制、导出和主题切换。\n> > 嵌套引用也应保留正确的内缩和完整文字。\n\n```js\nconst value = "代码块缩放时仍可完整滚动";\n```\n\n' + '## 标题与大纲\n\n这里是用于验证窗口缩放后滚动范围的正文。\n\n'.repeat(45) + '末尾验证标记';
  await page.setViewport({ width: 1030, height: 1030 });
  await app.loadMarkdown(doc, { layout: 'hybrid', selection: 0 }); await app.waitForIdle();
  await page.pressKey('F10', { modifiers: 1, code: 'F10' });
  await page.click('[data-editor-action="toggle-more"]');
  await page.waitFor(() => !document.getElementById('settings-modal').hidden);
  check('customize opens toolbar settings', await page.evaluate("!document.querySelector('[data-settings-page-panel=toolbar]').hidden"));
  await page.evaluate("document.getElementById('setting-toolbar-density').scrollIntoView({block:'center'})");
  await page.selectOption('#setting-toolbar-density', 'standard');
  const ids = await page.evaluate("[...document.querySelectorAll('#setting-toolbar-primary-items [data-toolbar-setting]')].map(e=>e.dataset.toolbarSetting)");
  for (const id of ids) {
    const selector = `#setting-toolbar-primary-items [data-toolbar-setting="${id}"]`;
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
    if (await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).checked`) !== ['bold','image'].includes(id)) await page.click(selector);
  }
  await page.click('#settings-modal .sidebar-footer-action'); await settle();
  const primary = () => page.evaluate("[...document.querySelector('.selection-toolbar-items').children].filter(e=>e.matches('[data-toolbar-item]')&&!e.classList.contains('toolbar-item-hidden')).map(e=>e.dataset.toolbarItem)");
  assert.deepEqual(await primary(), ['bold','image']);
  check('chosen tools populate the primary strip', true);
  assert.equal(await page.evaluate("document.querySelector('.format-group').getBoundingClientRect().height"), 40);
  check('standard size uses a 40px surface', true);
  await page.click('.format-group [data-editor-action="open-image"]');
  await page.waitFor(() => document.getElementById('image-modal').classList.contains('show'));
  await page.click('#image-modal [data-image-action="close"]');
  await page.waitFor(() => !document.getElementById('image-modal').classList.contains('show')); await settle();
  check('promoted image tool retains its real dialog', true);
  await page.click('[data-editor-action="toggle-more"]');
  await page.evaluate("document.getElementById('setting-toolbar-density').scrollIntoView({block:'center'})");
  await page.selectOption('#setting-toolbar-density', 'compact');
  await page.screenshot(join(artifacts,'toolbar-settings.png'));
  await page.click('#settings-modal .sidebar-footer-action'); await settle();
  assert.equal(await page.evaluate("document.querySelector('.format-group').getBoundingClientRect().height"), 36);
  check('compact size uses a 36px surface', true);
  check('toolbar preferences are persisted', await page.evaluate("localStorage.getItem('md_editor_toolbar_density')==='compact'&&JSON.stringify(JSON.parse(localStorage.getItem('md_editor_toolbar_primary_items')))===JSON.stringify(['bold','image'])"));
  await page.click('.writing-modes [data-mode="preview"]'); await app.waitForIdle();
  check('pure reading removes editing surfaces', await page.evaluate("document.body.classList.contains('preview-only-mode')&&getComputedStyle(document.querySelector('.f-editor-pane')).display==='none'&&!document.querySelector('.format-group').classList.contains('has-selection')&&document.querySelector('#editor .cm-content').getAttribute('contenteditable')==='false'&&document.getElementById('filename').readOnly"));
  await page.click('.preview-content .markdown-body p');
  await page.pressKey('b', { modifiers: 2, code: 'KeyB' }); await page.pressKey('z', { modifiers: 2, code: 'KeyZ' });
  await page.connection.send('Input.insertText', { text: '不应写入' });
  assert.equal(await app.getEditorValue(), doc); check('reading blocks typing formatting and undo', true);
  await page.click('[data-menu-toggle="insert-menu"]'); await page.click('#insert-menu [data-editor-action="open-link"]'); await settle();
  check('reading refuses insert dialog from application menu',await page.evaluate("!document.getElementById('link-modal').classList.contains('show')"));
  await openWorkspaceFind(page);
  check('reading exposes find without replace', await page.evaluate("document.querySelector('[data-find-action=replace-all]').getBoundingClientRect().height===0"));
  await page.fill('#find-input','测试'); await page.click('[data-find-action="next"]');
  await page.waitFor(() => document.getElementById('find-status').textContent.length>0);
  await page.click('[data-find-action="close"]');
  assert.equal(await app.getEditorValue(), doc); check('reading find retains mode and content', await page.evaluate("document.body.classList.contains('preview-only-mode')"));
  await page.screenshot(join(artifacts,'pure-reading.png'));
  await page.click('.writing-modes [data-mode="hybrid"]'); await app.waitForIdle();
  await app.revealPosition(0);
  await page.click('#editor .cm-line'); await page.pressKey('End', { modifiers: 2, code: 'End' });
  await page.connection.send('Input.insertText',{text:'可编辑'});
  await app.waitForIdle();
  check('leaving reading restores actual editing', (await app.getEditorValue()).endsWith('可编辑'));
  await page.pressKey('z',{modifiers:2,code:'KeyZ'}); assert.equal(await app.getEditorValue(),doc);
  for (const width of [600,900,600]) {
    await page.setViewport({width,height:860}); await app.revealPosition(0); await app.waitForIdle(); await settle();
    const geometry = await page.evaluate(`(()=>{const lines=[...document.querySelectorAll('.cm-hybrid-blockquote')];return lines.map(e=>{const s=getComputedStyle(e),depth=Number(s.getPropertyValue('--hybrid-quote-depth'))||1;return {padding:parseFloat(s.paddingLeft),lastBar:parseFloat(s.getPropertyValue('--hybrid-line-inline-padding'))+(depth-1)*24};});})()`);
    check('quote text clears every bar at '+width,geometry.length>=2&&geometry.every(g=>g.padding-g.lastBar>=8));
    await page.screenshot(join(artifacts,`narrow-content-${width}.png`));
    const box=await page.elementRect('#editor .cm-scroller');
    await page.connection.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x+box.width/2,y:box.y+box.height/2,deltaX:0,deltaY:100000});
    await page.waitFor(()=>[...document.querySelectorAll('#editor .cm-line')].some(e=>e.textContent.includes('末尾验证标记')));
    const reachable=await page.evaluate(`(()=>{const e=[...document.querySelectorAll('#editor .cm-line')].find(e=>e.textContent.includes('末尾验证标记')),r=e.getBoundingClientRect(),s=document.querySelector('#editor .cm-scroller').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom+1;})()`);
    check('real wheel reaches full document at '+width,reachable);
    assert.equal(await app.getEditorValue(),doc);
  }
  await page.navigate(await page.evaluate('location.href'));
  await page.waitFor(()=>document.documentElement.classList.contains('app-ready'));
  await page.click('[data-menu-toggle="file-menu"]'); await page.click('[data-settings-open]');
  await page.click('[data-settings-page="toolbar"]');
  check('relaunch restores density and chosen tools from repository',await page.evaluate("document.getElementById('setting-toolbar-density').value==='compact'&&JSON.stringify([...document.querySelectorAll('#setting-toolbar-primary-items input:checked')].map(e=>e.dataset.toolbarSetting))===JSON.stringify(['bold','image'])"));
  for(const id of ids) {
    const selector=`#setting-toolbar-primary-items [data-toolbar-setting="${id}"]`;
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
    if(!await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).checked`))await page.click(selector);
  }
  await page.click('#settings-modal .sidebar-footer-action');
  await page.waitFor(()=>document.getElementById('settings-modal').hidden);
  if (await page.evaluate("!document.querySelector('.document-empty').hidden")) {
    await page.click('.document-empty button');
    check('empty state creates a real session document',await page.evaluate("document.querySelector('.document-empty').hidden&&document.querySelectorAll('.document-item').length>0"));
  }
  await page.click('#editor .cm-line');
  await page.pressKey('F10',{modifiers:1,code:'F10'}); await settle();
  await writeFile(join(artifacts,'all-tools-layout.json'),JSON.stringify(await page.evaluate("(()=>{const e=document.querySelector('.format-group'),r=e.getBoundingClientRect();return {rect:{left:r.left,right:r.right,height:r.height},classes:e.className,root:e.parentElement.className,style:getComputedStyle(e).display,menu:document.querySelectorAll('#format-more-menu [data-toolbar-item]').length,visible:localStorage.getItem('md_editor_toolbar_visible'),density:e.dataset.density,blocked:[...document.querySelectorAll('.modal-overlay.show,.settings-workspace:not([hidden]),.writing-find-panel:not([hidden])')].map(e=>e.id)};})()"),null,2));
  check('all configured tools overflow safely at 600px',await page.evaluate("(()=>{const e=document.querySelector('.format-group'),r=e.getBoundingClientRect(),s=e.querySelector('.selection-toolbar-items');return r.left>=8&&r.right<=innerWidth-8&&s.scrollWidth>s.clientWidth;})()"));
  check('primary tool controls keep their intrinsic widths without overlap',await page.evaluate("(()=>{const a=[...document.querySelector('.selection-toolbar-items').children].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0);return a.every((r,i)=>i===0||r.left>=a[i-1].right+1);})()"));
  await page.click('[data-editor-action="toggle-more"]');
  check('all-tools More opens configuration without a command popup',await page.evaluate("!document.getElementById('settings-modal').hidden&&!document.getElementById('format-more-menu').classList.contains('show')"));
  await page.screenshot(join(artifacts,'all-tools-600.png'));
  return checks;
}
