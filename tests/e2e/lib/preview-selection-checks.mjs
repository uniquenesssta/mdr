import assert from 'node:assert/strict';
import { join } from 'node:path';

const sample = '# 阅读选区验证\n\n这是一段可以划选的正文，用来验证渲染查看中的文字选择和工具条。\n\n第二段文字。';

/** Real pointer selections over the two rendered preview surfaces and the source editor. */
export async function runPreviewSelectionChecks({ page, app, artifacts, includeLarge = true }) {
  const checks = [];
  const check = (name, value) => { assert.equal(value, true, name); checks.push(name); };
  const toolbarHidden = () => page.evaluate("getComputedStyle(document.querySelector('.format-group')).display==='none'");
  const points = target => page.evaluate(`(() => {
    const root=${target === 'preview' ? "document.querySelector('#preview p')" : "[...document.querySelectorAll('#editor .cm-line')].find(n=>n.textContent.includes('这是一段'))"};
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())&&node.textContent.length<14){}
    if(!node)throw Error('No visible selection fixture text.');
    const a=document.createRange(),b=document.createRange();a.setStart(node,1);a.setEnd(node,2);b.setStart(node,12);b.setEnd(node,13);
    const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {start:{x:x.left+1,y:(x.top+x.bottom)/2},end:{x:y.right-1,y:(y.top+y.bottom)/2}};
  })()`);
  const drag = async target => { const p=await points(target); await page.drag(p.start,p.end,{steps:12}); };
  const verifyPreview = async name => {
    await drag('preview');
    await page.waitFor(() => getSelection().toString().length>0 && getComputedStyle(document.querySelector('.format-group')).display==='none');
    const selected=await page.evaluate(`(() => {
      const s=getSelection(),p=document.querySelector('#preview p'),bg=getComputedStyle(p,'::selection').backgroundColor;
      return {text:s.toString(),inside:document.getElementById('preview').contains(s.anchorNode),bg,
        painted:CSS.highlights?.has('preview-selection-sync')||Boolean(document.querySelector('.preview-text-highlight'))};
    })()`);
    check(name+' keeps a real rendered text selection',selected.inside&&selected.text.length>5);
    const rgb=selected.bg.match(/[\d.]+/g)?.map(Number)||[];
    check(name+' has a visible blue native selection',rgb.length>=3&&rgb[2]>rgb[0]+12&&(rgb.length<4||rgb[3]>.5));
    await page.waitFor(() => CSS.highlights?.has('preview-selection-sync')||Boolean(document.querySelector('.preview-text-highlight')));
    check(name+' preserves the synchronized character highlight',true);
    check(name+' never shows a formatting toolbar',await toolbarHidden());
    await page.pressKey('F10',{modifiers:1,code:'F10'});
    check(name+' cannot pin a toolbar with Alt+F10',await toolbarHidden());
    await page.screenshot(join(artifacts,'selection-'+name+'.png'));
  };

  await app.loadMarkdown(sample,{layout:'both',selection:0}); await app.waitForIdle();
  await drag('editor');
  await page.waitFor(() => getComputedStyle(document.querySelector('.format-group')).display==='flex');
  check('source selection still opens the editing toolbar',true);
  await page.pressKey('F10',{modifiers:1,code:'F10'});
  await verifyPreview('split');
  await page.click('.writing-modes [data-mode="preview"]');await app.waitForIdle();
  await verifyPreview('reading');
  check('pure reading remains readonly',await page.evaluate("document.querySelector('#editor .cm-content').contentEditable==='false'"));
  assert.equal(await app.getEditorValue(),sample);

  for(const mode of ['hybrid','edit']) {
    await app.setLayout(mode);await app.waitForIdle();
    const p=await points('editor');await page.connection.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.start.x,y:p.start.y,button:'left',buttons:1,clickCount:1});
    await page.connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.start.x,y:p.start.y,button:'left',buttons:0,clickCount:1});
    const state=await page.evaluate(`({activeLines:document.querySelectorAll('#editor .cm-activeLine').length,
      bars:[...document.querySelectorAll('#editor .cm-hybrid-source-active')].map(n=>({bg:getComputedStyle(n).backgroundColor,shadow:getComputedStyle(n).boxShadow})),
      cursor:Boolean(document.querySelector('#editor .cm-cursor'))})`);
    check(mode+' has a normal cursor without an active-line strip',state.activeLines===0&&state.cursor&&state.bars.every(b=>b.bg==='rgba(0, 0, 0, 0)'&&b.shadow==='none'));
    await page.screenshot(join(artifacts,'caret-'+mode+'.png'));
  }

  if(includeLarge) {
    const text=sample+'\n\n'+('这是用于验证大文档预览选区的正文。'.repeat(20)+'\n\n').repeat(4500);
    await app.loadMarkdown(text,{layout:'both',selection:0,timeoutMs:60000});await app.waitForIdle({timeoutMs:60000});
    await verifyPreview('large-split');
    check('large preview selection leaves the actual document intact',await app.getEditorValue()===text);
  }
  return checks;
}
