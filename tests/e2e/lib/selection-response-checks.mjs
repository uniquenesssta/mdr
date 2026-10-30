import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateApplication } from './application-inspector.mjs';

// Actual Windows pointer events, original document and real application owners.
// Frame timestamps are paint opportunities, not a claim about compositor pixels.
export async function runSelectionResponseChecks({ page, app, source, artifacts, resizeViewport, enforce = true }) {
  assert.ok(source.length > 5000000);
  const originalSize = await page.evaluate('({width:innerWidth,height:innerHeight})');
  const frames = (n = 4) => page.evaluate(`new Promise(resolve=>{let n=${n};function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);})`);
  const state = () => evaluateApplication(page, '({selection:editorApi.getSelection(),sync:selectionSync.getState()})');
  await app.loadMarkdown(source, { layout: 'both', selection: 0, timeoutMs: 60000 });
  await app.waitForIdle();
  await state(); // Capture inspector owners before timing any interaction.
  const samples = [];
  let sampleIndex=0;
  for (const width of [1000, 600, 1600]) {
    await resizeViewport({ width, height: 860 }); await app.waitForIdle();
    for (const layout of ['preview', 'both']) {
      await app.setLayout(layout); await app.waitForIdle(); await frames(12);
      if(layout==='both' && await page.evaluate("document.querySelector('.f-preview-pane').classList.contains('is-collapsed')")) {
        await page.click('.f-preview-pane'); await app.waitForIdle(); await frames(12);
      }
      const editorHidden=await page.evaluate("document.querySelector('#editor').clientHeight===0");
      const before = await state();
      const offset=2+(sampleIndex++%4)*3;
      const points = await page.evaluate(`(()=>{
        getSelection().removeAllRanges();
        const p=document.querySelector('#preview'),box=p.getBoundingClientRect();
        const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;
        while(node=walker.nextNode()){
          if(node.textContent.length<40||node.parentElement.closest('pre,code,svg,.katex'))continue;
          const a=document.createRange(),b=document.createRange();a.setStart(node,${offset});a.setEnd(node,${offset+1});b.setStart(node,${offset+12});b.setEnd(node,${offset+13});
          const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
          if(x.top<box.top+16||y.bottom>box.bottom-16||x.width<=0||y.width<=0)continue;
          return {start:{x:x.left+1,y:(x.top+x.bottom)/2},end:{x:y.left+1,y:(y.top+y.bottom)/2}};
        }throw Error('No visible rendered text for real pointer selection');
      })()`);
      await page.evaluate(`(()=>{
        const d={moves:[],frames:[],release:0,done:false};globalThis.__selectionResponseProbe=d;
        let latest=null,last=performance.now();
        const move=e=>{if(e.buttons===1){latest={at:performance.now(),input:e.timeStamp};d.moves.push(latest);}};
        const up=()=>{d.release=performance.now();document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);};
        document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);
        function frame(){const now=performance.now();if(latest){d.frames.push({wait:now-latest.at,queue:latest.at-latest.input,gap:now-last,selected:getSelection().toString().length});latest=null;}last=now;if(!d.done)requestAnimationFrame(frame);}requestAnimationFrame(frame);
      })()`);
      await page.drag(points.start, points.end, { steps: 24, stepDelayMs: 8 });
      await page.waitFor(() => getSelection().toString().length > 0 && CSS.highlights.has('preview-selection-sync'));
      await frames(8);
      const after = await state();
      const probe = await page.evaluate(`(()=>{const d=globalThis.__selectionResponseProbe;d.done=true;delete globalThis.__selectionResponseProbe;return {...d,text:getSelection().toString(),inside:document.querySelector('#preview').contains(getSelection().anchorNode),toolbarHidden:getComputedStyle(document.querySelector('.format-group')).display==='none'};})()`);
      const sample = { width, layout, editorHidden, before, after, text: probe.text, nativeSelection: probe.inside, toolbarHidden: probe.toolbarHidden,
        dragSamples: probe.frames.length, maxPointerToFrameMs: Math.max(0, ...probe.frames.map(f => f.wait + Math.max(0, f.queue))),
        maxFrameGapMs: Math.max(0, ...probe.frames.map(f => f.gap)), selectedFrames: probe.frames.filter(f => f.selected > 0).length };
      samples.push(sample);
      if (enforce) {
        assert.ok(sample.nativeSelection && sample.toolbarHidden && sample.selectedFrames > 0);
        assert.ok(sample.maxPointerToFrameMs <= 100 && sample.maxFrameGapMs <= 100, 'native selection must retain the existing main-thread 100ms budget');
        if (editorHidden) assert.deepEqual(after.selection, before.selection, 'reading must not update the hidden editor');
        else {
          assert.equal(source.slice(after.selection.start, after.selection.end), probe.text, 'preview maps to the exact source characters');
          assert.ok(after.sync.previewRevealsCompleted > before.sync.previewRevealsCompleted);
          assert.ok(after.sync.lastPreviewRevealDurationMs <= 400, 'release through stable target must meet the existing 400ms budget');
        }
      }
      if (editorHidden) {
        await app.setLayout('both'); await app.waitForIdle(); await frames(12);
        if(await page.evaluate("document.querySelector('.f-editor-pane').classList.contains('is-collapsed')")) {
          await page.click('.f-editor-pane'); await app.waitForIdle(); await frames(12);
        }
        const returned = await state(); sample.returnedSelection = returned.selection;
        if (enforce) assert.equal(source.slice(returned.selection.start, returned.selection.end), probe.text, 'return to editing restores the reading selection');
      }
    }
  }
  assert.equal(await app.getEditorValue(), source);
  // A deterministic cross-block source drag catches presentation reflow while
  // the large-document scenarios above exercise native selection and mapping.
  const hybridSource='开头 **源码** 内容\n\n## 跨段标题\n\n> 跨段引用内容\n\n末尾正文';
  await app.loadMarkdown(hybridSource,{layout:'hybrid',selection:0});await app.waitForIdle();
  const wordPoint=(text,offset)=>page.evaluate(`(()=>{const line=[...document.querySelectorAll('#editor .cm-line')].find(n=>n.textContent.includes(${JSON.stringify(text)}));const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let n,left=line.textContent.indexOf(${JSON.stringify(text)})+${offset};while(n=walker.nextNode()){if(left<n.length){const r=document.createRange();r.setStart(n,left);r.setEnd(n,left+1);const b=r.getBoundingClientRect();if(b.width<=0||b.height<=0)throw Error('Hidden hybrid drag boundary');return {x:b.left+1,y:(b.top+b.bottom)/2};}left-=n.length;}throw Error('Missing hybrid drag boundary');})()`);
  const caret=await wordPoint('开头',1);await page.clickAt(caret.x,caret.y);await frames();
  const a=await wordPoint('开头',4),b=await wordPoint('跨段标题',2);
  const headingHeight=()=>page.evaluate("[...document.querySelectorAll('#editor .cm-line')].find(n=>n.textContent.includes('跨段标题')).getBoundingClientRect().height");
  const beforeHeight=await headingHeight();
  await page.connection.send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1});
  const heights=[];
  for(let i=1;i<=20;i++){
    await page.connection.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/20,y:a.y+(b.y-a.y)*i/20,button:'left',buttons:1});
    await frames(1);heights.push(await headingHeight());
  }
  await page.connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1});await frames();
  const hybrid={beforeHeight,heights,selectedText:(await app.snapshot()).selectedText};
  if(enforce){
    assert.ok(hybrid.selectedText.includes('跨段'),'the real native drag must cross into the heading text');
    assert.ok(heights.every(height=>Math.abs(height-beforeHeight)<=1),'crossing a heading must not change its presentation height during native drag');
  }
  assert.equal(await app.getEditorValue(),hybridSource);
  await resizeViewport(originalSize); await app.waitForIdle();
  const report = { passed: true, enforced: enforce, characters: source.length, samples, hybrid };
  await writeFile(join(artifacts, 'selection-response.json'), JSON.stringify(report, null, 2));
  return report;
}
