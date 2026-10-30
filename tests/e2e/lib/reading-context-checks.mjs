import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { evaluateApplication } from './application-inspector.mjs';

export async function runReadingContextChecks({ page, app, artifacts, resizeViewport = size => page.setViewport(size) }) {
  const checks = [], text = '# 阅读测试\n\nalpha beta gamma\n\n' + '正文会随阅读宽度重新排版，保持文字可选且不可编辑。'.repeat(18);
  const waitFrames = () => page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const rightAt = async (x,y) => {
    await page.connection.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'right',buttons:2,clickCount:1});
    await page.connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'right',buttons:0,clickCount:1});
    await page.waitFor(()=>!document.getElementById('text-context-menu').hidden);
  };
  const previewMenu = async () => { const r = await page.elementRect('#preview'); await rightAt(r.x+r.width*.65,r.y+80); };
  await resizeViewport({width:1440,height:900});
  await app.loadMarkdown(text,{layout:'preview',selection:0}); await app.waitForIdle();
  for(const [value,fraction] of [['third',1/3],['half',.5],['full',1]]) {
    await previewMenu();
    assert.deepEqual(await page.evaluate("[...document.querySelectorAll('#text-context-menu > button:not([hidden])')].map(b=>b.dataset.textContextAction)"),['copy','select-all','find']);
    await page.click(`[data-reading-width="${value}"]`); await waitFrames();
    const metrics=await page.evaluate("(()=>{const p=document.querySelector('#preview'),b=p.querySelector('.markdown-body');return {available:b.parentElement.clientWidth,width:b.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,viewport:innerWidth};})()");
    assert.ok(Math.abs(metrics.width-Math.min(metrics.available,Math.max(320,metrics.available*fraction)))<2,JSON.stringify(metrics));
    assert.ok(metrics.scroll<=metrics.viewport);assert.equal(await app.getEditorValue(),text);
    await page.screenshot(join(artifacts,`reading-width-${value}.png`));checks.push(value+' changes actual reading width without editing the document');
  }
  await previewMenu();await page.click('[data-reading-width="third"]');
  await page.navigate(await page.evaluate('location.href')); await page.waitFor(()=>document.documentElement.classList.contains('app-ready'));
  assert.equal(await page.evaluate("localStorage.getItem('md_editor_reading_width')"),'third');
  await app.loadMarkdown(text,{layout:'preview',selection:0});await app.waitForIdle();await previewMenu();
  assert.equal(await page.evaluate("document.querySelector('[data-reading-width=third]').getAttribute('aria-checked')"),'true');
  checks.push('reading width survives relaunch through real Settings persistence');
  await page.pressKey('Escape');
  await resizeViewport({width:600,height:600});await waitFrames();await previewMenu();
  assert.ok(await page.evaluate("(()=>{const r=document.getElementById('text-context-menu').getBoundingClientRect();return r.left>=8&&r.right<=innerWidth-8&&r.bottom<=innerHeight-8;})()"));
  await page.pressKey('Escape'); checks.push('narrow reading and menu stay inside the window');
  await resizeViewport({width:1280,height:860});await app.setLayout('both');await app.waitForIdle();await previewMenu();
  assert.equal(await page.evaluate("document.querySelector('.text-context-width').hidden"),true);
  assert.deepEqual(await page.evaluate("[...document.querySelectorAll('#text-context-menu > button:not([hidden])')].map(b=>b.dataset.textContextAction)"),['copy','select-all','find']);
  await page.screenshot(join(artifacts,'split-preview-context.png'));await page.pressKey('Escape');
  checks.push('split preview offers reading commands without width or editing actions');
  await page.evaluate("globalThis.__contextPrevented=[];document.addEventListener('contextmenu',e=>__contextPrevented.push(e.defaultPrevented));");
  await page.evaluate("document.querySelector('.l-toolbar-shell').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
  assert.equal(await page.evaluate('__contextPrevented.at(-1)'),true);assert.equal(await page.evaluate("document.getElementById('text-context-menu').hidden"),true);
  checks.push('web context menu is prevented even outside document text');
  const originalClipboard=await page.evaluate('navigator.clipboard.readText()');
  try {
    await app.loadMarkdown('alpha beta gamma',{layout:'both',selection:0});await app.waitForIdle();
    await evaluateApplication(page,'editorApi.setSelection(0,5)');
    const p=await evaluateApplication(page,'editorApi.getPositionCoordinates(1)');await rightAt(p.left+1,(p.top+p.bottom)/2);
    await page.screenshot(join(artifacts,'editor-context.png'));await page.click('[data-text-context-action=copy]');
    assert.equal(await page.evaluate('navigator.clipboard.readText()'),'alpha');
    await page.evaluate("navigator.clipboard.writeText('delta')");await rightAt(p.left+1,(p.top+p.bottom)/2);await page.click('[data-text-context-action=paste]');
    await page.waitFor(()=>document.querySelector('#editor').textContent.includes('delta'));
    assert.equal(await app.getEditorValue(),'delta beta gamma');
    const next=await evaluateApplication(page,'editorApi.getPositionCoordinates(1)');await rightAt(next.left+1,(next.top+next.bottom)/2);await page.click('[data-text-context-action=undo]');
    await app.waitForIdle();assert.equal(await app.getEditorValue(),'alpha beta gamma');checks.push('actual clipboard copy/paste reaches editor transactions and undo');
    await app.setLayout('preview');await app.waitForIdle();await previewMenu();await page.click('[data-text-context-action=select-all]');
    assert.ok(await page.evaluate("getSelection().toString().includes('alpha beta gamma')"));await previewMenu();await page.click('[data-text-context-action=copy]');
    assert.ok((await page.evaluate('navigator.clipboard.readText()')).includes('alpha beta gamma'));
    assert.equal(await app.getEditorValue(),'alpha beta gamma');checks.push('preview selection copies real text without modifying the document');
  } finally { await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(originalClipboard)})`); }
  assert.equal(page.exceptions.length,0,JSON.stringify(page.exceptions));
  return checks;
}

/** Original large source, real scroll and width changes; no editor/preview replacements. */
export async function runLargeReadingWidthChecks({page,app,artifacts,source}) {
  assert.ok(source.length>5000000);
  await app.loadMarkdown(source,{layout:'preview',selection:0,timeoutMs:30000});await app.waitForIdle();
  const frames=()=>page.evaluate('new Promise(r=>{let n=12;function f(){if(--n===0)r();else requestAnimationFrame(f);}requestAnimationFrame(f);})');
  const rect=await page.elementRect('#preview');
  for(let i=0;i<30;i++)await page.connection.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.x+rect.width*.5,y:rect.y+rect.height*.5,deltaX:0,deltaY:180});
  await frames();
  const visible=()=>page.evaluate("(()=>{const p=document.getElementById('preview'),r=p.getBoundingClientRect();return [...p.querySelectorAll('[data-source-line][data-preview-block-id]')].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>r.top+16&&b.top<r.bottom-16;}).map(e=>e.dataset.previewBlockId);})()");
  const measurements=[];
  for(const value of ['third','full','half']) {
    const before=await visible();assert.ok(before.length);
    const p=await page.elementRect('#preview'),x=p.x+p.width*.8,y=p.y+80;
    for(const [type,buttons]of [['mousePressed',2],['mouseReleased',0]])await page.connection.send('Input.dispatchMouseEvent',{type,x,y,buttons,button:'right',clickCount:1});
    await page.click(`[data-reading-width=${value}]`);await frames();await app.waitForIdle();
    const after=await visible();assert.ok(after.some(id=>before.includes(id)),'reading anchor retained through '+value);
    const nodes=await page.evaluate("document.querySelectorAll('*').length");assert.ok(nodes<2500,'large document remains bounded');
    measurements.push({value,anchorRetained:true,nodes});
  }
  assert.equal(await app.getEditorValue(),source);
  await page.screenshot(join(artifacts,'large-reading-width.png'));
  await writeFile(join(artifacts,'large-reading-width.json'),JSON.stringify({passed:true,characters:source.length,measurements},null,2));
}
