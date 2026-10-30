import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { evaluateApplication } from './application-inspector.mjs';

const geometry = `(()=>{const host=document.querySelector('#preview'),r=host.getBoundingClientRect();
 const ranges=[...CSS.highlights?.get('preview-selection-sync')||[]];
 const rects=ranges.flatMap(range=>[...range.getClientRects()]).filter(x=>x.width>0&&x.height>0);
 return {text:ranges.map(range=>range.toString()).join(''),visible:rects.length>0&&rects.every(x=>x.top>=r.top-1&&x.bottom<=r.bottom+1),
 top:host.scrollTop,width:host.clientWidth,rects:rects.map(x=>({top:x.top,bottom:x.bottom})),viewport:{top:r.top,bottom:r.bottom}};})()`;

async function stableTarget(page, expected) {
  return page.evaluate(`new Promise(resolve=>{let previous=null,stable=0;const started=performance.now();
    function sample(){const value=${geometry};stable=value.text===${JSON.stringify(expected)}&&value.visible&&previous!==null&&Math.abs(value.top-previous)<=1?stable+1:0;previous=value.top;
      if(stable>=12||performance.now()-started>5000)resolve({...value,stable:stable>=12,ms:performance.now()-started});else requestAnimationFrame(sample);}requestAnimationFrame(sample);})`);
}

async function selectSource(page, from, to) {
  const positions=await evaluateApplication(page, `({start:editorApi.getPositionCoordinates(${from}),end:editorApi.getPositionCoordinates(${to})})`);
  for(const point of Object.values(positions))assert.ok(point&&Number.isFinite(point.left),'actual editor coordinates available');
  await page.drag({x:positions.start.left+1,y:(positions.start.top+positions.start.bottom)/2},
    {x:positions.end.left+1,y:(positions.end.top+positions.end.bottom)/2},{steps:10,stepDelayMs:5});
}

async function openCompactPane(page, side) {
  // Compact mode follows ResizeObserver; inspect it after the released width is committed.
  await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  if(await page.evaluate(`document.querySelector('.f-${side}-pane').classList.contains('is-collapsed')`)) {
    await page.click(`.f-${side}-pane`);
    await page.waitFor(`!document.querySelector('.f-${side}-pane').classList.contains('is-collapsed')`);
  }
}

async function dragBoundary(page,start,end,capture) {
  const width=await page.evaluate("document.documentElement.style.getPropertyValue('--sidebar-width')");
  await page.connection.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x,y:start.y,button:'none',buttons:0});
  await page.connection.send('Input.dispatchMouseEvent',{type:'mousePressed',x:start.x,y:start.y,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=24;i++){
    await page.connection.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+(end.x-start.x)*i/24,y:start.y,button:'left',buttons:1});
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  await page.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  const shown=await page.evaluate("(()=>{const r=document.getElementById('sidebar-resizer').getBoundingClientRect();return {width:document.documentElement.style.getPropertyValue('--sidebar-width'),center:(r.left+r.right)/2};})()");
  assert.equal(shown.width,width,'large-document content width stays fixed until release');
  assert.ok(Math.abs(shown.center-end.x)<=6,'the visible separator follows the requested boundary');
  if(capture)await page.screenshot(capture);
  await page.connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:end.x,y:end.y,button:'left',buttons:0,clickCount:1});
}

/** Use actual pointer drags and source text; no follow-up navigation may repair a failed selection. */
export async function runSidebarResizeSelectionChecks({page,app,artifacts,source,resizeViewport=size=>page.setViewport(size)}) {
  assert.ok(source.length>5000000,'exercise the real five-million-character document');
  const lines=source.split('\n'),offsets=[];let offset=0;
  for(const line of lines){offsets.push(offset);offset+=line.length+1;}
  const paragraph=fraction=>{let i=Math.floor(lines.length*fraction);while(i<lines.length&&(!/^\p{Script=Han}/u.test(lines[i])||lines[i].length<90||/[*_`\[\]<>]/.test(lines[i])))i++;return i;};
  const line=paragraph(.63);
  assert.ok(line<lines.length,'a long plain paragraph is required');
  const from=offsets[line]+40,to=from+12,expected=source.slice(from,to);
  await app.loadMarkdown(source,{layout:'both',selection:0,timeoutMs:30000});await app.waitForIdle();
  await page.click('#sidebar-outline-tab');
  await app.revealPosition(from);await selectSource(page,from,to);
  const initial=await stableTarget(page,expected),failures=[],measurements=[];
  if(!initial.stable)failures.push({phase:'initial',...initial});
  await page.evaluate(`(()=>{const probe={tasks:[],widths:[],active:false,width:document.documentElement.style.getPropertyValue('--sidebar-width')};
    probe.observer=new PerformanceObserver(list=>{if(probe.active)probe.tasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})));});
    probe.observer.observe({type:'longtask',buffered:false});
    probe.styles=new MutationObserver(()=>{const width=document.documentElement.style.getPropertyValue('--sidebar-width');if(width!==probe.width){if(probe.active)probe.widths.push(width);probe.width=width;}});
    probe.styles.observe(document.documentElement,{attributes:true,attributeFilter:['style']});globalThis.__sidebarResizeProbe=probe;})()`);
  try {
    const matrix=[[1280,180],[1280,360],[1280,520],[1060,240],[1440,420],[1280,240]];
    for(const [caseIndex,[windowWidth,sidebarWidth]]of matrix.entries()) {
      await resizeViewport({width:windowWidth,height:860});
      await page.waitFor(()=>document.querySelector('#sidebar-resizer').getBoundingClientRect().width>0);
      const handle=await page.elementRect('#sidebar-resizer');
      const origin=await page.evaluate("document.querySelector('.l-workspace').getBoundingClientRect().left");
      await page.evaluate('globalThis.__sidebarResizeProbe.tasks=[];globalThis.__sidebarResizeProbe.widths=[];globalThis.__sidebarResizeProbe.active=true');
      const started=Date.now();
      await dragBoundary(page,{x:handle.x+handle.width/2,y:handle.y+120},{x:origin+sidebarWidth,y:handle.y+120},
        caseIndex===0?join(artifacts,'sidebar-dragging.png'):null);
      const elapsedMs=Date.now()-started;
      await openCompactPane(page,'preview');
      const retained=await stableTarget(page,expected);
      const probe=await page.evaluate('globalThis.__sidebarResizeProbe.active=false;({tasks:globalThis.__sidebarResizeProbe.tasks,widths:globalThis.__sidebarResizeProbe.widths})'),tasks=probe.tasks;
      const selected=await app.snapshot();
      if(selected.selectedText!==expected||!retained.stable)failures.push({phase:'retained',windowWidth,sidebarWidth,selected:selected.selectedText,...retained});
      const freshLine=paragraph([.25,.6,.9][caseIndex%3]);assert.ok(freshLine<lines.length);
      const next=offsets[freshLine]+lines[freshLine].length-18;
      await openCompactPane(page,'editor');
      await app.revealPosition(next,{preserveSelection:true});
      const scope=await app.getPreviewStats();
      assert.ok(freshLine+1<scope.scopeStartLine||freshLine+1>scope.scopeEndLine,'new word selection must locate a different chapter');
      const freshStarted=Date.now();
      await selectSource(page,next,next+12);
      await openCompactPane(page,'preview');
      const fresh=await stableTarget(page,source.slice(next,next+12));
      if((await app.snapshot()).selectedText!==source.slice(next,next+12)||!fresh.stable)failures.push({phase:'fresh',windowWidth,sidebarWidth,...fresh,
        continuation:await evaluateApplication(page,'({intent:selectionSync.editorIntent,state:selectionSync.getState(),scroll:selectionSync.scrollController.getState(),layout:selectionSync.layoutRevision})')});
      measurements.push({windowWidth,sidebarWidth,elapsedMs,widthCommits:probe.widths.length,longTasks:tasks.length,longTaskMs:tasks.reduce((sum,t)=>sum+t.ms,0),maxTaskMs:Math.max(0,...tasks.map(t=>t.ms)),freshLine:freshLine+1,freshTotalMs:Date.now()-freshStarted,retained,fresh});
      await openCompactPane(page,'editor');
      await app.revealPosition(from,{preserveSelection:true});await selectSource(page,from,to);await stableTarget(page,expected);
    }
    assert.equal(await app.getEditorValue(),source,'resizing and selection must not alter the document');
    await page.screenshot(join(artifacts,'sidebar-resize-selection.png'));
    await writeFile(join(artifacts,'sidebar-resize-selection.json'),JSON.stringify({characters:source.length,line:line+1,measurements,failures},null,2));
    assert.deepEqual(failures,[],'retained and new selections must be visible at every actual width');
    assert.ok(measurements.every(m=>m.widthCommits<=1),'large-document text layout changes only once per completed drag');
    return {characters:source.length,measurements};
  }finally{await page.evaluate('globalThis.__sidebarResizeProbe?.observer.disconnect();globalThis.__sidebarResizeProbe?.styles.disconnect();delete globalThis.__sidebarResizeProbe');}
}
