import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateApplication } from './application-inspector.mjs';
import { capturePerformance } from './performance-capture.mjs';

const frames = (page, count = 3) => page.evaluate(`new Promise(resolve=>{let n=${count};function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);})`);
async function settledSelection(page, expected) {
  return page.evaluate(`new Promise(resolve=>{const started=performance.now();let last=null,stable=0;
    function tick(){const host=document.getElementById('preview'),box=host.getBoundingClientRect();
      const ranges=[...CSS.highlights.get('preview-selection-sync')||[]],rects=ranges.flatMap(r=>[...r.getClientRects()]).filter(r=>r.width>0&&r.height>0);
      const ok=ranges.map(r=>r.toString()).join('')===${JSON.stringify(expected)}&&rects.length&&rects.every(r=>r.top>=box.top-1&&r.bottom<=box.bottom+1);
      stable=ok&&last!==null&&Math.abs(host.scrollTop-last)<1?stable+1:0;last=host.scrollTop;
      if(stable>=3||performance.now()-started>5000)resolve({visible:Boolean(ok),stable:stable>=3,ms:performance.now()-started});else requestAnimationFrame(tick);}tick();})`);
}

export async function runLargeDocumentInteractionChecks({ page, app, artifacts, source, enforce = false }) {
  assert.ok(source.length > 5000000);
  const lines = source.split('\n'), offsets = []; let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const position = fraction => {
    let line = Math.floor(lines.length * fraction);
    while (line < lines.length && (!/^\p{Script=Han}/u.test(lines[line]) || lines[line].length < 90 || /[*_`\[\]<>]/.test(lines[line]))) line++;
    assert.ok(line < lines.length); return offsets[line] + 35;
  };
  await app.loadMarkdown(source, { layout: 'hybrid', selection: 0, timeoutMs: 30000 });
  await app.waitForIdle();
  // Discover the real owners before capture; heap inspection itself must not pollute timings.
  await evaluateApplication(page, 'editorApi.getTextLength()');
  await page.evaluate(`(()=>{const p={tasks:[],phase:'idle'};p.observer=new PerformanceObserver(list=>p.tasks.push(...list.getEntries().map(e=>({phase:p.phase,start:e.startTime,ms:e.duration}))));p.observer.observe({type:'longtask'});globalThis.__interactionProbe=p;})()`);
  const measurements = [];
  const measure = async (name, work) => {
    await page.evaluate(`globalThis.__interactionProbe.phase=${JSON.stringify(name)}`);
    const start = Date.now(), result = await work(), elapsedMs = Date.now() - start;
    // Drain observer delivery separately: these extra frames are not response latency.
    await frames(page);
    measurements.push({ name, elapsedMs, observationMs: Date.now() - start, ...result });
    await page.evaluate("globalThis.__interactionProbe.phase='idle'");
  };
  let report;
  try {
    await capturePerformance(page, artifacts, async () => {
      await measure('outline-open', async () => { await page.click('#sidebar-outline-tab'); return {}; });
      await measure('split-open', async () => { await page.click('.writing-modes [data-mode="both"]'); await app.waitForIdle(); return {}; });
      for (const fraction of [.343, .6, .9]) {
        const from = position(fraction), to = from + 12;
        await app.revealPosition(from, { preserveSelection: true }); await frames(page);
        const points = await evaluateApplication(page, `({from:editorApi.getPositionCoordinates(${from}),to:editorApi.getPositionCoordinates(${to})})`);
        await measure(`chapter-selection-${fraction}`, async () => {
          await page.drag({x:points.from.left+1,y:(points.from.top+points.from.bottom)/2},{x:points.to.left+1,y:(points.to.top+points.to.bottom)/2},{steps:10,stepDelayMs:5});
          return await settledSelection(page, source.slice(from,to));
        });
        const editor = await page.elementRect('#editor');
        await measure(`scroll-${fraction}`, async () => {
          for(let i=0;i<12;i++) { await page.connection.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:editor.x+editor.width/2,y:editor.y+editor.height/2,deltaX:0,deltaY:100}); await frames(page,1); }
          return {};
        });
      }
      const handle = await page.elementRect('#sidebar-resizer');
      await measure('sidebar-drag', async () => { await page.drag({x:handle.x+handle.width/2,y:handle.y+120},{x:handle.x+100,y:handle.y+120},{steps:24,stepDelayMs:5}); return {}; });
    });
    const tasks = await page.evaluate('globalThis.__interactionProbe.tasks');
    const dom = await page.evaluate("({nodes:document.querySelectorAll('*').length,outlineRows:document.querySelectorAll('.outline-row').length})");
    const selection = await evaluateApplication(page, 'selectionSync.getState()');
    const failures = [];
    if(enforce&&(dom.nodes>2500||dom.outlineRows>80))failures.push('large outline mounts more than the viewport budget');
    for(const m of measurements) {
      const longTasks = tasks.filter(t=>t.phase===m.name);
      Object.assign(m,{longTasks:longTasks.length,longTaskMs:longTasks.reduce((s,t)=>s+t.ms,0),maxTaskMs:Math.max(0,...longTasks.map(t=>t.ms))});
      if(m.name.startsWith('chapter-selection')&&(!m.visible||!m.stable))failures.push(m.name+': incorrect or unstable selection');
      // Budgets are fixed before the repair: user-facing frame stalls and complete selection latency.
      if(enforce&&m.maxTaskMs>100)failures.push(m.name+': main-thread task exceeds 100ms');
      if(enforce&&m.name.startsWith('chapter-selection')&&m.elapsedMs>400)failures.push(m.name+': selection exceeds 400ms');
    }
    assert.equal(await app.getEditorValue(),source,'original full document remains intact');
    report={characters:source.length,dom,selection,measurements,tasks,failures,enforce};
    await writeFile(join(artifacts,'large-document-interactions.json'),JSON.stringify(report,null,2));
    await page.screenshot(join(artifacts,'large-document-interactions.png'));
    assert.deepEqual(failures,[]);return report;
  } finally { await page.evaluate('globalThis.__interactionProbe.observer.disconnect();delete globalThis.__interactionProbe'); }
}
