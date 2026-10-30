import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateApplication, waitForApplication } from './application-inspector.mjs';

// Real source, pointer, resize and wheel events exercise the continuation chain.
// No application owners are replaced and the complete body is compared at exit.
export async function runSelectionContinuationChecks({ page, app, source, artifacts, resizeViewport, resizeBurst }) {
  assert.ok(source.length > 5000000);
  const originalSize=await page.evaluate('({width:innerWidth,height:innerHeight})');
  const frames = (count=4) => page.evaluate(`new Promise(resolve=>{let n=${count};function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);})`);
  const state = () => evaluateApplication(page,'({...selectionSync.getState(),layoutRevision:selectionSync.layoutRevision})');
  await app.loadMarkdown(source,{layout:'both',selection:0,timeoutMs:30000});await app.waitForIdle();
  await evaluateApplication(page,'editorApi.getTextLength()');
  const reveals=[];
  for(const [from,length]of [[2287772,13],[1834411,11],[3403570,10]]) {
    await app.revealPosition(from,{preserveSelection:true});await frames();
    const before=await state(),to=from+length;
    const points=await evaluateApplication(page,`({a:editorApi.getPositionCoordinates(${from}),b:editorApi.getPositionCoordinates(${to})})`);
    const started=Date.now();
    await page.drag({x:points.a.left+1,y:(points.a.top+points.a.bottom)/2},{x:points.b.left+1,y:(points.b.top+points.b.bottom)/2},{steps:10,stepDelayMs:5});
    await page.waitFor(`(()=>{const h=[...CSS.highlights.get('preview-selection-sync')||[]];return h.map(r=>r.toString()).join('')===${JSON.stringify(source.slice(from,to))};})()`);
    let after;
    for(let i=0;i<100;i++){after=await state();if(after.revealsCompleted>before.revealsCompleted)break;await frames(1);}
    assert.equal(after.revealsCompleted,before.revealsCompleted+1);
    assert.ok(after.lastRevealDurationMs<=400,'pointer release to stable visible highlight must meet the existing400ms budget');
    reveals.push({from,length,gestureThroughStableMs:Date.now()-started,releaseThroughStableMs:after.lastRevealDurationMs});
  }
  const beforeResize=await state();
  await resizeBurst();
  await waitForApplication(page,()=>applicationCapabilities.markdownEditorLayoutStatePort.snapshot.resize.windowBurstEvents===0,
    {description:'the real native resize burst completed'});
  await app.waitForIdle();await frames(12);
  const afterResize=await state();
  assert.ok(afterResize.layoutRevision-beforeResize.layoutRevision>=1&&afterResize.layoutRevision-beforeResize.layoutRevision<=2,
    'one continuous native resize must complete and coalesce geometry revisions');
  await app.setLayout('preview');await app.waitForIdle();await frames(12);
  const beforeWheel=await state(),preview=await page.elementRect('#preview');
  for(let i=0;i<36;i++){await page.connection.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:preview.x+preview.width/2,y:preview.y+preview.height/2,deltaX:0,deltaY:180});await frames(1);}
  await frames(12);const afterWheel=await state();
  assert.equal(afterWheel.previewRefreshes,beforeWheel.previewRefreshes,'pure reading scroll must restore its bookmark without running hidden-editor mappings');
  assert.equal(await app.getEditorValue(),source);
  const report={passed:true,characters:source.length,reveals,resizeRevisions:afterResize.layoutRevision-beforeResize.layoutRevision,
    readingEditorRefreshes:afterWheel.previewRefreshes-beforeWheel.previewRefreshes};
  await resizeViewport(originalSize);await app.waitForIdle();
  await writeFile(join(artifacts,'selection-continuation.json'),JSON.stringify(report,null,2));return report;
}
