import { evaluateExport } from './export-test-commands.mjs';
import { createApplicationDriver } from './application-driver.mjs';
// Exercise the actual built application and locked renderers. Capture file/print
// boundaries only; R14-10 loads the unmodified standalone HTML with network blocked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Keep preparation steps separately observable, using only public actions.
// The identity probe intentionally still compares the frozen model body: that
// independent export-source assertion is not a fixture-loading fallback.
async function loadCompleteBodyFixture(page, source, trace, tracePath) {
  const app = createApplicationDriver(page);
  const steps = [
    // The original import step had the CDP transport's 30s bound. Keep that
    // same total bound when it goes through the public bounded action.
    ['import', () => app.loadMarkdown(source, { layout: 'both', selection: 0, timeoutMs: 30000 })],
    ['initial-position', () => app.revealPosition(0, { timeoutMs: 5000 })],
    ['visual-editing', () => app.setVisualEditing({ code: true, table: true })],
    ['layout', () => app.setLayout('both')],
    ['final-position', () => app.revealPosition(0, { timeoutMs: 6000 })],
    ['idle', () => app.waitForIdle({ timeoutMs: 6000 })],
    ['identity', () => page.evaluate(`(()=>{
      const snapshot=window.__markdownEditorE2E.snapshot(),expected=${JSON.stringify(source)};
      return {ready:snapshot.ready,layout:snapshot.layout,documentLength:snapshot.documentLength,
        selectionStart:snapshot.selectionStart,selectionEnd:snapshot.selectionEnd,
        editorMatches:window.__markdownEditorE2E.getEditorValue()===expected,
        modelMatches:window.__markdownEditorE2E.getEditorValue()===expected};
    })()`)]
  ];
  for(const [step,run] of steps) {
    const row={sourceLength:source.length,step,status:'started'};
    trace.push(row);
    await writeFile(tracePath,JSON.stringify(trace,null,2));
    const started=performance.now();
    try {
      const result=await run();
      if(step==='idle')assert.equal(result,true,'Complete-body fixture must reach idle before export');
      if(step==='identity') {
        row.observation=result;
        assert.equal(result.ready,true);assert.equal(result.layout,'both');
        assert.equal(result.documentLength,source.length);
        assert.equal(result.selectionStart,0);assert.equal(result.selectionEnd,0);
        assert.equal(result.editorMatches,true);assert.equal(result.modelMatches,true);
      }
      row.status='passed';
    } catch(error) {
      row.status='failed';row.error=String(error?.stack||error);
      throw new Error(`Complete-body fixture ${step} failed (${source.length} UTF-16 units)`,{cause:error});
    } finally {
      row.elapsedMs=Math.round(performance.now()-started);
      await writeFile(tracePath,JSON.stringify(trace,null,2));
    }
  }
}

export async function runExportCharacterization({ page, test, loadMarkdown, artifactRoot, applicationHost }) {
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/stage-14-export/contracts.json', import.meta.url), 'utf8'));
  const requests = JSON.parse(await readFile(new URL('../../fixtures/stage-14-export/requests.json', import.meta.url), 'utf8'));

  await test('R14-02 built app normalizes Markdown names and retains R14-01 bytes and HTML/Word complete enhanced-body evidence', async () => {
    await loadMarkdown(fixture.source);
    const result = await evaluateExport(page, `(async () => {
      const names = ${JSON.stringify(requests.names)};
      const blobs = new Map(), captures = [], revoked = [], failures = [], errors = [];
      const error = console.error;
      console.error = (...args) => { errors.push(args.map(x=>String(x)).join(' ')); error.apply(console,args); };
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL, click = HTMLAnchorElement.prototype.click;
      const input = document.getElementById('filename'), originalName = input.value;
      URL.createObjectURL = function(blob) { const url = create.call(URL, blob); blobs.set(url, blob); return url; };
      URL.revokeObjectURL = function(url) { revoked.push(url); return revoke.call(URL, url); };
      HTMLAnchorElement.prototype.click = function() { if(this.download) captures.push({name:this.download,url:this.href,blob:blobs.get(this.href)}); else return click.call(this); };
      try {
        for(const row of names) {
          input.value = row.input;
          for(const [format, run] of [['markdown', exportFile], ['html', exportHTML], ['word', exportWord]]) {
            const start = captures.length;
            await run();
            if(format !== 'markdown') {
              failures.push({format,input:row.input,error:errors.at(-1) || null,progressVisible:document.getElementById('export-progress-modal').classList.contains('show')});
            }
            if(captures.length !== start+1) throw new Error('Expected one actual '+format+' download: '+row.input+'; '+JSON.stringify({errors,failures,task:exportTaskPort.getSnapshot()}));
            const capture = captures.at(-1), content = await capture.blob.text();
            capture.format = format; capture.input = row.input; capture.content = content; capture.mime = capture.blob.type;
            capture.revoked = revoked.includes(capture.url);
            if(format !== 'markdown') {
              const parsed=new DOMParser().parseFromString(content,'text/html');
              capture.rendered={math:parsed.querySelectorAll('.katex').length,diagrams:parsed.querySelectorAll('svg.f-mermaid-svg').length,
                task:parsed.querySelectorAll('li.task-item input[type="checkbox"]').length,code:parsed.querySelectorAll('.markdown-code-token').length,
                rawDiagrams:parsed.querySelectorAll('pre > code.language-mermaid').length,copyButtons:parsed.querySelectorAll('.preview-code-copy').length};
            }

          }
        }
        return {captures:captures.map(({blob,url,...capture})=>capture),failures,retiredTitleBinding:typeof escapeHtml==='undefined'};
      } finally {
        URL.createObjectURL=create; URL.revokeObjectURL=revoke; HTMLAnchorElement.prototype.click=click;
        input.value=originalName;console.error=error;
      }
    })()`);
    await writeFile(join(artifactRoot, 'r14-02-text-exports.json'), JSON.stringify(result, null, 2));
    assert.equal(result.retiredTitleBinding, true);
    assert.equal(result.captures.length, fixture.names.length * 3);
    for (const capture of result.captures) {
      const row = requests.names.find(x => x.input === capture.input);
      assert.equal(capture.name, row[capture.format]);
      assert.equal(capture.revoked, true);
      if (capture.format === 'markdown') {
        assert.equal(capture.content, fixture.source);
        assert.equal(capture.mime, 'text/markdown;charset=utf-8');
      } else {
        assert.equal(capture.mime, capture.format === 'html' ? 'text/html;charset=utf-8' : 'application/msword;charset=utf-8');
        assert.ok(capture.content.startsWith('<!DOCTYPE html>'));
        assert.ok(capture.rendered.math >= 2); assert.equal(capture.rendered.diagrams, 1);
        assert.equal(capture.rendered.task, 1); assert.ok(capture.rendered.code > 0);
        assert.equal(capture.rendered.rawDiagrams, 0); assert.equal(capture.rendered.copyButtons, 0);
        if (capture.format === 'html') {
          assert.doesNotMatch(capture.content, /cdn\.jsdelivr|exportPresentationPort|<script[\s>]/i);
          assert.ok(capture.content.includes('data:font/woff2;base64,'));
        }
      }
    }
    assert.equal(result.failures.length, fixture.names.length * 2);
    for (const failure of result.failures) {
      assert.equal(failure.error, null, 'R14-07 enhances all rendered bodies; original defect fixture stays immutable.');
      assert.equal(failure.progressVisible, false);
    }
  });

  await test('R14-02 actual request rejects bad inputs before any export task and remains scoped and immutable', async () => {
    await loadMarkdown(fixture.source);
    const result = await evaluateExport(page, `(async () => {
      const host=applicationCapabilities,port=host.markdownEditorExportRequestPort;
      const input={format:'IMAGE',name:'request.txt',directory:' C:\\\\exports ',imageOptions:{ratio:'4:5',cropFit:true}};
      const request=port.createRequest(input);
      input.name='late';input.imageOptions.ratio='1:1';
      const fields=[];
      for(const bad of [{format:'exe'},{format:'markdown',documentId:'missing-export-doc'},{format:'image',imageOptions:{ratio:'invalid'}}]) {
        try {port.createRequest(bad);throw new Error('Invalid request was accepted');}
        catch(error) {if(error.code!=='EXPORT_REQUEST_INVALID')throw error;fields.push(error.field);}
      }
      const directory=exportDirectory,print=window.print,click=HTMLAnchorElement.prototype.click;
      const before=exportTaskPort.getSnapshot().lastTaskId;let prints=0,downloads=0;
      window.print=()=>{prints++;};HTMLAnchorElement.prototype.click=function(){downloads++;};
      try {
        exportDirectory='bad'+String.fromCharCode(0);
        for(const run of [exportFile,exportHTML,exportWord,exportPDF,renderExportImagePreview,downloadExportImage])await run();
        await exportContextDocument('missing-export-doc');
        return {request,fields,taskDelta:exportTaskPort.getSnapshot().lastTaskId-before,active:exportTaskPort.getSnapshot().activeTask,prints,downloads,
          frozen:Object.isFrozen(request)&&Object.isFrozen(request.extensions)&&Object.isFrozen(request.imageOptions),
          scoped:typeof window.markdownEditorExportRequestPort==='undefined',
          progressVisible:document.getElementById('export-progress-modal').classList.contains('show')};
      } finally {exportDirectory=directory;window.print=print;HTMLAnchorElement.prototype.click=click;}
    })()`);
    assert.equal(result.request.format, 'image'); assert.equal(result.request.name, 'request.png');
    assert.equal(result.request.directory, 'C:\\exports'); assert.ok(result.request.documentId);
    assert.deepEqual(result.request.imageOptions, { ratio:'4:5',width:1080,height:1350,cropFit:true });
    assert.deepEqual(result.fields, ['format','documentId','imageOptions.ratio']);
    assert.equal(result.taskDelta, 0); assert.equal(result.active, null);
    assert.equal(result.prints, 0); assert.equal(result.downloads, 0);
    assert.equal(result.frozen, true); assert.equal(result.scoped, true); assert.equal(result.progressVisible, false);
    await writeFile(join(artifactRoot, 'r14-02-request-validation.json'), JSON.stringify(result, null, 2));
  });

  await test('R14-01 actual long-document export records the missing dependency without accepting partial output', async () => {
    const count = fixture.longDocument.blocks;
    const source = '# Large export\n\n' + Array.from({ length: count }, (_, i) => `R14-block-${i} ` + 'x'.repeat(3000)).join('\n\n');
    assert.ok(source.length >= fixture.longDocument.largeCharacters);
    await loadMarkdown(source);
    const result = await evaluateExport(page, `(async () => {
      const host=applicationCapabilities;
      await host.markdownEditorPreviewCommandPort.update();
      const task = beginExportTask('R14 long-document public builder');
      const records=[],progress=[],model=documentModel,snapshot=model.createSnapshot;
      const descriptor=Object.getOwnPropertyDescriptor(model,'createSnapshot');
      Object.defineProperty(model,'createSnapshot',{configurable:true,value(...args){records.push('model.snapshot');return snapshot.apply(this,args);}});
      const unsubscribe=host.markdownEditorExportTaskPort.subscribe(value=>{if(value.activeTask?.phase==='building')progress.push(value.activeTask.message);});
      try {
        const root=await host.markdownEditorExportDocumentPort.build({task});
        return {paragraphs:Array.from(root.querySelectorAll('p')).map(x=>x.textContent.match(/^R14-block-(\\d+)/)?.[1]).filter(Boolean).map(Number),
          heading:root.querySelector('h1')?.textContent,records,progress,
          detached:!root.isConnected,retired:typeof previewWorkerClient==='undefined'&&typeof createPreviewNodesForBlock==='undefined',snapshotObserved:typeof snapshot==='function'};
      } finally {unsubscribe();if(descriptor)Object.defineProperty(model,'createSnapshot',descriptor);else delete model.createSnapshot;finishExportTask(task);}
    })()`);
    const workerRequests=applicationHost?.requests.filter(x=>/\/assets\/preview-worker-[^/]+\.js(?:\?|$)/.test(x.url)) || [];
    await writeFile(join(artifactRoot, 'r14-01-long-document.json'), JSON.stringify({ ...result, workerRequests, sourceCharacters:source.length, expectedParagraphs:count, mapping:'R14-06 public builder; original R14-F04 fixture preserved' }, null, 2));
    if (applicationHost) assert.ok(workerRequests.some(x=>x.status===200), 'The actual built Worker asset must load from the page origin.');
    assert.deepEqual(result.paragraphs, Array.from({length:count},(_,i)=>i));
    assert.equal(result.heading, 'Large export');assert.equal(result.detached, true);assert.equal(result.retired, true);assert.equal(result.snapshotObserved,true);
    assert.deepEqual(result.records, [], 'Synchronized Worker path cannot read the whole editor body.');
    const batches=result.progress.filter(x=>x.includes(' 块')).map(x=>Number(x.match(/ (\d+)\//)[1]));
    assert.equal(batches[0],48);assert.equal(batches[1],96);assert.ok(batches.at(-1)>=count);
  });

  await test('R14-06 actual long-document cancellation stops public body construction and next build remains usable', async () => {
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,port=host.markdownEditorExportTaskPort;
      const task=port.begin('cancel long builder');let batches=0;
      const dispose=port.subscribe(s=>{if(s.activeTask?.id===task.id&&s.activeTask.message.includes(' 块')&&!s.activeTask.cancelled){batches++;port.cancel();}});
      let error;
      try{await host.markdownEditorExportDocumentPort.build({task});throw new Error('Cancelled build returned a body');}
      catch(e){error={cancelled:port.isCancelled(e),reason:e.reason};}
      finally{dispose();port.finish(task);}
      const next=await host.markdownEditorExportDocumentPort.build();
      return {error,batches,released:port.getSnapshot().activeTask===null,paragraphs:next.querySelectorAll('p').length,detached:!next.isConnected};
    })()`);
    await writeFile(join(artifactRoot,'r14-06-builder-cancellation.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.error,{cancelled:true,reason:'cancelled'});assert.equal(result.batches,1);
    assert.equal(result.released,true);assert.equal(result.detached,true);assert.equal(result.paragraphs,fixture.longDocument.blocks);
  });

  await test('R14-01 locked offline renderer produces real math/Mermaid DOM and a decodable PNG independent of the broken exporter', async () => {
    await loadMarkdown(fixture.source);
    const result = await evaluateExport(page, `(async () => {
      const presentation=applicationCapabilities.markdownEditorPresentationPort;
      const root=document.createElement('div');
      root.style.cssText='width:320px;height:240px;background:white;color:black;padding:8px;box-sizing:border-box';
      const heading=document.createElement('h1');heading.textContent='Export baseline';root.append(heading);
      const formula=document.createElement('div');root.append(formula);
      const mathResult=presentation.math.renderFormula(formula, 'x^2', {displayMode:false});
      const diagram=document.createElement('div');root.append(diagram);
      await presentation.mermaid.renderDiagram(diagram, 'flowchart TD\\n A[Start] --> B[End]');
      document.body.append(root);
      try {
        const renderer=await presentation.loadDomToImage();
        const png=await renderer.toPng(root,{width:320,height:240,bgcolor:'#ffffff',cacheBust:true});
        const image=new Image();
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('PNG decode failed'));image.src=png;});
        return {mathOk:mathResult.ok,math:root.querySelectorAll('.katex').length,mermaid:root.querySelectorAll('svg.f-mermaid-svg').length,width:image.naturalWidth,height:image.naturalHeight,png};
      } finally {root.remove();}
    })()`);
    assert.equal(result.mathOk, true);
    assert.equal(result.math, 1);
    assert.equal(result.mermaid, 1);
    assert.equal(result.width, 320);
    assert.equal(result.height, 240);
    const png = Buffer.from(result.png.split(',')[1], 'base64');
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    await writeFile(join(artifactRoot, 'r14-01-renderer-baseline.png'), png);
    await writeFile(join(artifactRoot, 'r14-01-renderer-baseline.json'), JSON.stringify({ ...result, png:undefined, bytes:png.length, scope:'locked capability control, not successful PDF/Image export' }, null, 2));
  });

  await test('R14-07 actual PDF/Image retain R14-01 file-boundary and cleanup coverage with enhanced bodies', async () => {
    await loadMarkdown(fixture.source);
    const result = await evaluateExport(page, `(async () => {
      const error=console.error;
      const host=applicationCapabilities,port=host.markdownEditorPreviewCommandPort;
      const before=port.getViewMode();let prints=0,printed;const errors=[],phases=[];
      const unsubscribe=host.markdownEditorExportTaskPort.subscribe(s=>{if(s.activeTask)phases.push({phase:s.activeTask.phase,cancelable:s.activeTask.cancelable});});
      const observer=new MutationObserver(records=>{for(const record of records)for(const frame of record.addedNodes){if(frame.matches?.('iframe[data-export-print="pdf"]'))frame.contentWindow.print=()=>{
        const doc=frame.contentDocument;prints++;printed={format:doc.querySelector('.export-document')?.dataset.exportFormat,math:doc.querySelectorAll('.katex').length,diagrams:doc.querySelectorAll('svg.f-mermaid-svg').length,
          heading:doc.querySelector('h1')?.textContent};frame.contentWindow.dispatchEvent(new Event('afterprint'));};}});observer.observe(document.body,{childList:true});
      console.error=(...args)=>{errors.push(args.map(x=>String(x)).join(' '));error.apply(console,args);};
      try {
        await exportPDF();await new Promise(resolve=>setTimeout(resolve,160));
        await port.update();const afterPrint=port.getViewMode();
        await renderExportImagePreview();
        const png=document.getElementById('export-image-preview').getAttribute('src'),image=new Image();
        if(!png?.startsWith('data:image/png'))throw new Error('Actual image export produced no PNG: '+JSON.stringify(errors));
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Exported PNG decode failed'));image.src=png;});
        return {prints,printed,errors,before,afterPrint,after:port.getViewMode(),width:image.naturalWidth,height:image.naturalHeight,png,phases,
          progressVisible:document.getElementById('export-progress-modal').classList.contains('show'),stageChildren:document.getElementById('export-image-content').children.length,
          stageStylesCleared:document.getElementById('export-image-content').children.length===0&&!document.getElementById('export-image-stage').hasAttribute('data-export-image-layout'),
          retired:typeof styleTaskLists==='undefined'&&typeof renderMermaidBlocks==='undefined'&&typeof observedPreviewBody==='undefined'&&typeof enhanceFullPreviewForExport==='undefined'};
      } finally {unsubscribe();observer.disconnect();console.error=error;}
    })()`);
    const png=result.png?.startsWith('data:image/png')?Buffer.from(result.png.split(',')[1],'base64'):null;
    await writeFile(join(artifactRoot,'r14-07-pdf-image.json'),JSON.stringify({...result,png:undefined,pngBytes:png?.length,mapping:'R14-F04 receiving enhancer; original failure fixture retained'},null,2));
    if(png)await writeFile(join(artifactRoot,'r14-07-export.png'),png);
    assert.equal(result.prints,1);assert.equal(result.printed.format,'pdf');assert.ok(result.printed.math>=2);assert.equal(result.printed.diagrams,1);assert.equal(result.printed.heading,'Export baseline');
    assert.equal(result.errors.length,0);assert.equal(result.afterPrint,result.before);
    assert.equal(result.progressVisible,false);assert.equal(result.stageChildren,0);assert.equal(result.stageStylesCleared,true);assert.equal(result.retired,true);
    assert.equal(result.width,1080);assert.ok(result.height>=1920);
    assert.ok(result.phases.some(x=>x.phase==='encoding'&&x.cancelable===false));
    assert.deepEqual(Array.from(png.subarray(0,8)),[137,80,78,71,13,10,26,10]);
  });

  await test('R14-07 actual public enhancer cancels a long batch and independently enhances the next complete body', async () => {
    const source='# Enhancement batches\n\n'+Array.from({length:40},(_,i)=>'Enhance-'+i+' $x^2$').join('\n\n');
    await loadMarkdown(source);
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,tasks=host.markdownEditorExportTaskPort,
        builder=host.markdownEditorExportDocumentPort,enhancer=host.markdownEditorExportEnhancementPort;
      const task=tasks.begin('cancel enhancement'),root=await builder.build({task});let batches=0,error;
      const dispose=tasks.subscribe(s=>{if(s.activeTask?.id===task.id&&s.activeTask.phase==='enhancing'&&!s.activeTask.cancelled){batches++;tasks.cancel();}});
      try{await enhancer.enhance({root,task});throw new Error('Cancelled enhancement returned a body');}
      catch(e){error={cancelled:tasks.isCancelled(e),reason:e.reason};}
      finally{dispose();tasks.finish(task);}
      const next=await builder.build();await enhancer.enhance({root:next});
      return {error,batches,released:tasks.getSnapshot().activeTask===null,paragraphs:next.querySelectorAll('p').length,
        math:next.querySelectorAll('.katex').length,detached:!next.isConnected,source:builder.getSourceContext(next),frozen:Object.isFrozen(builder.getSourceContext(next))};
    })()`);
    await writeFile(join(artifactRoot,'r14-07-enhancement-cancellation.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.error,{cancelled:true,reason:'cancelled'});assert.equal(result.batches,1);assert.equal(result.released,true);
    assert.equal(result.paragraphs,40);assert.equal(result.math,40);assert.equal(result.detached,true);assert.equal(result.frozen,true);
  });

  await test('R14-07 actual model edits invalidate a previously built export body before enhancement', async () => {
    await loadMarkdown('# Previous export\n\n$x^2$');
    await evaluateExport(page, `(async()=>{const host=applicationCapabilities;host.__r1407Body=await host.markdownEditorExportDocumentPort.build();host.__r1407Html=host.__r1407Body.innerHTML;})()`);
    try {
      await loadMarkdown('# Edited export\n\n$y^2$');
      const result=await evaluateExport(page, `(async()=>{const host=applicationCapabilities;let error;
        try{await host.markdownEditorExportEnhancementPort.enhance({root:host.__r1407Body});throw new Error('Stale enhancement returned a body');}
        catch(e){error={cancelled:host.markdownEditorExportTaskPort.isCancelled(e),reason:e.reason};}
        return {error,unchanged:host.__r1407Body.innerHTML===host.__r1407Html};})()`);
      await writeFile(join(artifactRoot,'r14-07-stale-body.json'),JSON.stringify(result,null,2));
      assert.deepEqual(result.error,{cancelled:true,reason:'document-changed'});assert.equal(result.unchanged,true);
    } finally {await evaluateExport(page, `(()=>{const host=applicationCapabilities;delete host.__r1407Body;delete host.__r1407Html;})()`);}
  });

  await test('R14-07 actual canonical math renderer rejects inherited trust and retains safe rendering', async () => {
    const result=await evaluateExport(page, `(()=>{
      const math=applicationCapabilities.markdownEditorPresentationPort.math;
      const root=document.createElement('div'),options=Object.create({trust:true});
      const unsafe=String.fromCharCode(92)+'href{javascript:alert(1)}{click}';
      math.renderFormula(root,unsafe,options);const links=root.querySelectorAll('a,img').length;
      const normal=math.renderFormula(root,'x^2',{displayMode:true});
      return {links,normal:normal.ok,math:root.querySelectorAll('.katex').length,block:root.querySelectorAll('.katex-display').length};
    })()`);
    await writeFile(join(artifactRoot,'r14-07-math-security.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result,{links:0,normal:true,math:1,block:1});
  });

  await test('R14-04 irreversible lock retains R14-03 actual replacement, progress and cancel button coverage', async () => {
    const result = await evaluateExport(page, `(() => {
      const host=applicationCapabilities,port=host.markdownEditorExportTaskPort;
      const modal=document.getElementById('export-progress-modal'),button=document.getElementById('export-progress-cancel');
      const old=beginExportTask('old task'),current=beginExportTask('current task');
      let cancellable;
      try {
        current.update(40,'current progress','building');
        old.update(99,'stale');old.lockCancellation('encoding');finishExportTask(old);
        let cancelledError=false;try {old.token.throwIfCancelled();}catch(error){cancelledError=port.isCancelled(error);}
        const projected={title:document.getElementById('export-progress-title').textContent,
          message:document.getElementById('export-progress-status').textContent,
          width:document.getElementById('export-progress-value').style.width,disabled:button.disabled,visible:modal.classList.contains('show')};
        current.lockCancellation('encoding');const locked=port.getSnapshot();
        const blocked=beginExportTask('blocked');button.click();
        const afterBlocked=port.getSnapshot();
        // A locked task is terminal until finish; cancellation is exercised on new preparation.
        finishExportTask(current);cancellable=beginExportTask('cancellable task');button.click();
        const cancelled=port.getSnapshot();cancellable.update(100,'late');
        return {projected,locked,afterBlocked,cancelled,blocked:blocked===null,cancelledError,
          oldCancelled:old.cancelled,oldPhase:old.phase,oldUpdate:old.update(100,'late'),
          currentId:current.id,cancellableId:cancellable.id,afterLate:port.getSnapshot(),
          immutable:Object.isFrozen(current)&&Object.isFrozen(cancelled)&&Object.isFrozen(cancelled.activeTask),
          scoped:typeof window.markdownEditorExportTaskPort==='undefined',
          retired:typeof activeExportTask==='undefined'&&typeof exportTaskId==='undefined'&&typeof ExportCancelledError==='undefined'};
      } finally {finishExportTask(cancellable);finishExportTask(current);}
    })()`);
    assert.deepEqual(result.projected, { title:'current task',message:'current progress',width:'40%',disabled:false,visible:true });
    assert.equal(result.oldCancelled, true); assert.equal(result.oldPhase, 'replaced'); assert.equal(result.oldUpdate, false);
    assert.equal(result.cancelledError, true); assert.equal(result.blocked, true);
    assert.equal(result.locked.activeTask.cancelable, false); assert.equal(result.afterBlocked.lastTaskId, result.locked.lastTaskId);
    assert.equal(result.afterBlocked.activeTask.id, result.currentId); assert.equal(result.afterBlocked.activeTask.cancelled, false);
    assert.equal(result.cancelled.activeTask.id, result.cancellableId);
    assert.equal(result.cancelled.activeTask.phase, 'cancelled'); assert.equal(result.cancelled.activeTask.progress, 0);
    assert.deepEqual(result.afterLate, result.cancelled);
    assert.equal(result.immutable, true); assert.equal(result.scoped, true); assert.equal(result.retired, true);
    assert.equal(await evaluateExport(page, `document.getElementById('export-progress-modal').classList.contains('show')`), false);
    await writeFile(join(artifactRoot, 'r14-03-task-controller.json'), JSON.stringify(result, null, 2));
  });

  await test('R14-04 actual cancel button terminates a token wait and rejects late publication', async () => {
    const result = await evaluateExport(page, `(async () => {
      const port=applicationCapabilities.markdownEditorExportTaskPort;
      const task=beginExportTask('token wait');task.update(5,'等待图片模块','loading');
      const marker=document.createElement('div');marker.textContent='unchanged';document.body.append(marker);
      let resolve;const pending=new Promise(done=>{resolve=done;});const reasons=[];
      const dispose=task.token.onCancel(reason=>reasons.push(reason));
      const work=(async()=>{
        try {marker.textContent=await task.token.waitFor(pending);return {published:true};}
        catch(error){if(!port.isCancelled(error))throw error;return {published:false,reason:error.reason};}
        finally {finishExportTask(task);}
      })();
      try {
        document.getElementById('export-progress-cancel').click();const outcome=await work;
        const released=port.getSnapshot().activeTask===null;
        resolve('late result');await Promise.resolve();await Promise.resolve();
        return {outcome,released,reasons,content:marker.textContent,tokenId:task.token.taskId,taskId:task.id,
          frozen:Object.isFrozen(task.token),readOnly:!('cancel' in task.token)&&!('setCancelable' in task),
          progressVisible:document.getElementById('export-progress-modal').classList.contains('show')};
      } finally {dispose();finishExportTask(task);marker.remove();}
    })()`);
    assert.deepEqual(result.outcome, { published:false,reason:'cancelled' });
    assert.deepEqual(result.reasons, ['cancelled']); assert.equal(result.content, 'unchanged');
    assert.equal(result.tokenId, result.taskId); assert.equal(result.progressVisible, false);
    for (const field of ['released','frozen','readOnly']) assert.equal(result[field], true, field);
    await writeFile(join(artifactRoot, 'r14-04-cancellation.json'), JSON.stringify(result, null, 2));
  });

  await test('R14-05 actual progress view clears terminal content, preserves focus and owns cancel without inline events', async () => {
    const result = await evaluateExport(page, `(async () => {
      const port=applicationCapabilities.markdownEditorExportTaskPort;
      const root=document.getElementById('export-progress-modal'),button=document.getElementById('export-progress-cancel');
      const title=document.getElementById('export-progress-title'),status=document.getElementById('export-progress-status'),value=document.getElementById('export-progress-value');
      const source=document.createElement('button');document.body.append(source);source.focus();
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      let current;
      try {
        current=port.begin('<img src=x onerror=bad()>');current.update(52,'<script>literal message</script>','building');await frame();
        const opened={focused:document.activeElement===button,title:title.textContent,message:status.textContent,width:value.style.width,
          literal:title.children.length===0&&status.children.length===0,inline:button.hasAttribute('onclick'),retired:typeof cancelActiveExport==='undefined'};
        root.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close',{detail:{reason:'old bridge'}}));
        root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        root.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
        const protectedOpen=root.classList.contains('show');
        current.lockCancellation('encoding');button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        const locked={disabled:button.disabled,cancelled:current.cancelled,label:button.textContent};
        port.finish(current,'failed');await frame();
        const ended={visible:root.classList.contains('show'),title:title.textContent,message:status.textContent,width:value.style.width,
          disabled:button.disabled,focusRestored:document.activeElement===source};
        current=port.begin('next');button.click();const cancelled={disabled:button.disabled,label:button.textContent,cancelled:current.cancelled};
        port.finish(current);
        return {opened,protectedOpen,locked,ended,cancelled,unique:document.querySelectorAll('#export-progress-modal').length===1};
      } finally {port.finish(current);source.remove();}
    })()`);
    assert.deepEqual(result.opened, { focused:true,title:'<img src=x onerror=bad()>',message:'<script>literal message</script>',width:'52%',literal:true,inline:false,retired:true });
    assert.equal(result.protectedOpen, true); assert.equal(result.unique, true);
    assert.deepEqual(result.locked, { disabled:true,cancelled:false,label:'正在生成文件…' });
    assert.deepEqual(result.ended, { visible:false,title:'正在准备导出',message:'',width:'0%',disabled:true,focusRestored:true });
    assert.deepEqual(result.cancelled, { disabled:true,label:'正在取消…',cancelled:true });
    await writeFile(join(artifactRoot, 'r14-05-progress-view.json'), JSON.stringify(result, null, 2));
  });

  await test('R14-08 actual HTML/Word styles render in isolated documents without application CSS or scripts', async () => {
    await loadMarkdown(fixture.source);
    const result=await evaluateExport(page, `(async()=>{
      const captures=[],blobs=new Map(),create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
      const styles=applicationCapabilities.markdownEditorExportStylePort;
      URL.createObjectURL=blob=>{const url=create.call(URL,blob);blobs.set(url,blob);return url;};
      HTMLAnchorElement.prototype.click=function(){if(this.download)captures.push(blobs.get(this.href));else click.call(this);};
      const results=[];
      try {
        for(const [format,run] of [['html',exportHTML],['word',exportWord]]) {
          await run();const content=await captures.at(-1).text(),parsed=new DOMParser().parseFromString(content,'text/html');
          const shared=parsed.querySelector('style').textContent===styles.getCss(format);
          parsed.querySelectorAll('script,link').forEach(node=>node.remove());
          const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');
          frame.style.cssText='position:fixed;left:-99999px;top:0;width:900px;height:700px';
          const ready=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(new Error('Isolated export document failed'));});
          frame.srcdoc=parsed.documentElement.outerHTML;document.body.append(frame);
          try {
            await ready;const doc=frame.contentDocument,view=frame.contentWindow;
            const mathml=Array.from(doc.querySelectorAll('.katex-mathml')).map(node=>{const css=view.getComputedStyle(node);return {position:css.position,clip:css.clipPath,width:css.width,height:css.height,display:css.display};});
            results.push({format,shared,root:doc.body.dataset.exportFormat,font:view.getComputedStyle(doc.body).fontSize,
              mathml,math:doc.querySelectorAll('.katex').length,diagrams:doc.querySelectorAll('svg.f-mermaid-svg').length,
              row:view.getComputedStyle(doc.querySelector('.preview-code-row')).display,
              task:view.getComputedStyle(doc.querySelector('li.task-item')).listStyleType,
              table:view.getComputedStyle(doc.querySelector('table')).borderCollapse,scripts:doc.scripts.length});
          } finally {frame.remove();}
        }
        return results;
      } finally {URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
    })()`);
    await writeFile(join(artifactRoot,'r14-08-isolated-document-styles.json'),JSON.stringify(result,null,2));
    for(const row of result) {
      assert.equal(row.shared,true);assert.equal(row.root,row.format);assert.equal(row.scripts,0);
      assert.equal(row.font,'16px');assert.equal(row.math,2);assert.equal(row.diagrams,1);
      assert.equal(row.row,row.format==='word'?'block':'grid');assert.equal(row.task,'none');assert.equal(row.table,'collapse');
      assert.equal(row.mathml.length,2);
      for(const math of row.mathml){assert.equal(math.position,'absolute');assert.equal(math.clip,'inset(50%)');assert.equal(math.width,'1px');assert.equal(math.height,'1px');assert.notEqual(math.display,'none');}
    }
  });

  await test('R14-08 actual light/dark PNG equals a MathML-removed reference and detects visible duplicate-text control', async () => {
    await loadMarkdown(fixture.source);
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,styles=host.markdownEditorExportStylePort,
        presentation=host.markdownEditorPresentationPort,oldTheme=document.body.getAttribute('data-theme');
      const decode=async png=>{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('PNG reference decode failed'));image.src=png;});
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);
        return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data};};
      const difference=(a,b)=>{if(a.width!==b.width||a.height!==b.height)throw new Error('PNG reference dimensions differ');let pixels=0;
        for(let i=0;i<a.pixels.length;i+=4)if(a.pixels[i]!==b.pixels[i]||a.pixels[i+1]!==b.pixels[i+1]||a.pixels[i+2]!==b.pixels[i+2]||a.pixels[i+3]!==b.pixels[i+3])pixels++;
        return pixels;};
      const renderer=await presentation.loadDomToImage(),originalPng=renderer.toPng;let capturedRoot;
      renderer.toPng=(root,options)=>{capturedRoot=root;return originalPng.call(renderer,root,options);};
      const results=[];
      try {
        for(const theme of ['light','dark']) {
          document.body.setAttribute('data-theme',theme);await document.fonts.ready;await renderExportImagePreview();
          const png=document.getElementById('export-image-preview').src,actual=await decode(png),root=capturedRoot;
          const released=!root.isConnected&&document.getElementById('export-image-content').children.length===0&&!root.classList.contains('export-document')&&!root.hasAttribute('data-export-format');
          document.getElementById('export-image-content').append(root);
          const lease=styles.apply(root,'image'),previousHeight=root.style.height;
          const geometry=host.markdownEditorImageLayoutPort.mount({root,stage:document.getElementById('export-image-stage'),
            options:host.markdownEditorExportRequestPort.createRequest({format:'image',imageOptions:{ratio:'9:16',cropFit:false}}).imageOptions});
          geometry.measure();
          root.style.height=actual.height+'px';
          const mathml=Array.from(root.querySelectorAll('.katex-mathml')),hidden=mathml.every(node=>getComputedStyle(node).display==='none');
          const retained=mathml.map(node=>({node,parent:node.parentNode,next:node.nextSibling}));
          let control=null;
          try {
            const renderer=await presentation.loadDomToImage(),options={width:actual.width,height:actual.height,bgcolor:getComputedStyle(root).backgroundColor,cacheBust:true};
            mathml.forEach(node=>node.remove());const reference=await renderer.toPng(root,options),referenceDecoded=await decode(reference);
            const diff=difference(actual,referenceDecoded);
            if(theme==='light') {
              control=document.createElement('p');control.textContent='x2 21 VISIBLE MATHML CONTROL';root.prepend(control);
              const controlPng=await renderer.toPng(root,options);const controlDiff=difference(actual,await decode(controlPng));
              results.push({theme,width:actual.width,height:actual.height,hidden,mathml:mathml.length,released,diff,controlDiff,png,reference});
            } else results.push({theme,width:actual.width,height:actual.height,hidden,mathml:mathml.length,released,diff,png,reference});
          } finally {
            control?.remove();for(const item of retained)item.parent.insertBefore(item.node,item.next);
            root.style.height=previousHeight;geometry.release();lease.release();root.remove();
          }
        }
        return results;
      } finally {renderer.toPng=originalPng;capturedRoot?.remove();if(oldTheme===null)document.body.removeAttribute('data-theme');else document.body.setAttribute('data-theme',oldTheme);}
    })()`);
    await writeFile(join(artifactRoot,'r14-08-png-math-pixels.json'),JSON.stringify(result.map(({png,reference,...row})=>row),null,2));
    for(const row of result) {
      await writeFile(join(artifactRoot,`r14-08-export-${row.theme}.png`),Buffer.from(row.png.split(',')[1],'base64'));
      await writeFile(join(artifactRoot,`r14-08-reference-${row.theme}.png`),Buffer.from(row.reference.split(',')[1],'base64'));
      assert.equal(row.width,1080);assert.ok(row.height>=1920);assert.equal(row.mathml,2);assert.equal(row.hidden,true);assert.equal(row.released,true);
      assert.equal(row.diff,0,'Visible math and the complete PNG must be unchanged when auxiliary MathML is removed.');
      if(row.theme==='light')assert.ok(row.controlDiff>100,'A visible duplicate-text control must change actual PNG pixels.');
    }
  });

  await test('R14-08 Preview/Hybrid retain accessible math and unchanged nodes through export-style leases', async () => {
    await loadMarkdown('# Math styles\n\nInline $x^2$.\n\n$$\n\\frac{1}{2}\n$$');
    const result=[];
    try {for(const mode of ['both','hybrid']) {
      await evaluateExport(page, `window.__markdownEditorE2E.setLayout(${JSON.stringify(mode)})`);
      if(mode==='both')await evaluateExport(page, 'applicationCapabilities.markdownEditorPreviewCommandPort.update()');
      await page.waitFor(mode==='both'
        ?()=>document.querySelectorAll('#preview .katex').length===2
        :()=>document.querySelectorAll('#editor .katex').length===2,
      {timeoutMs:10000,description:`${mode} two rendered math nodes`});
      result.push(await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,styles=host.markdownEditorExportStylePort;
      await document.fonts.ready;
      const surface=${JSON.stringify(mode==='both'?'preview':'hybrid')},surfaceRoot=document.getElementById(${JSON.stringify(mode==='both'?'preview':'editor')}),
        nodes=Array.from(surfaceRoot.querySelectorAll('.katex'));
      const inspect=()=>({sameNodes:Array.from(surfaceRoot.querySelectorAll('.katex')).every((node,index)=>node===nodes[index])&&surfaceRoot.querySelectorAll('.katex').length===nodes.length,
        math:nodes.map(node=>{
        const math=node.querySelector('.katex-mathml'),visual=node.querySelector('.katex-html'),css=getComputedStyle(math);
        return {connected:node.isConnected,position:css.position,clip:css.clipPath,width:css.width,height:css.height,display:css.display,visual:getComputedStyle(visual).display};
      })});
      const before=inspect(),root=document.createElement('div');document.body.append(root);
      let lease;
      try{lease=styles.apply(root,'image');const during=inspect();lease.release();return {surface,before,during,after:inspect(),count:nodes.length,
        visible:surfaceRoot.getBoundingClientRect().width>0&&surfaceRoot.getBoundingClientRect().height>0,
        unscoped:!surfaceRoot.classList.contains('export-document')&&!surfaceRoot.hasAttribute('data-export-format')};}
      finally{lease?.release();root.remove();}
    })()`));
    }} finally {await evaluateExport(page, 'window.__markdownEditorE2E.setLayout("both")');}
    await writeFile(join(artifactRoot,'r14-08-preview-hybrid-math.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.map(row=>row.surface),['preview','hybrid']);
    for(const row of result){assert.equal(row.count,2);assert.equal(row.visible,true);assert.equal(row.unscoped,true);assert.equal(row.before.sameNodes,true);
      assert.deepEqual(row.during,row.before);assert.deepEqual(row.after,row.before);
      for(const math of row.before.math){assert.equal(math.connected,true);assert.equal(math.position,'absolute');assert.equal(math.clip,'inset(50%)');assert.equal(math.width,'1px');assert.equal(math.height,'1px');assert.notEqual(math.display,'none');assert.notEqual(math.visual,'none');}}
  });

  await test('R14-09 actual active Markdown exports preserve complete raw model bytes including empty and large documents', async () => {
    const results=[];
    for(const source of ['', '# Raw 😀\r\n\r\n$x^2$  \n```mermaid\nflowchart TD\n A-->B\n```\n<script>raw</script>\n', 'Markdown 原文 😀  \n'.repeat(30000)]) {
      await loadMarkdown(source);
      results.push(await evaluateExport(page, `(async()=>{
        const host=applicationCapabilities,model=window.__markdownEditorE2E;
        const expected=new TextEncoder().encode(model.getEditorValue()),captures=[],blobs=new Map(),revoked=[];
        const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
        const input=document.getElementById('filename'),name=input.value,preview=document.getElementById('preview'),nodes=Array.from(preview.childNodes);
        URL.createObjectURL=function(blob){const url=create.call(URL,blob);blobs.set(url,blob);return url;};
        URL.revokeObjectURL=function(url){revoked.push(url);return revoke.call(URL,url);};
        HTMLAnchorElement.prototype.click=function(){if(this.download)captures.push({name:this.download,url:this.href,blob:blobs.get(this.href)});else return click.call(this);};
        try {
          input.value='原文 report.docx';await exportFile();await exportContextDocument();
          const files=[];
          for(const capture of captures){const bytes=new Uint8Array(await capture.blob.arrayBuffer());files.push({name:capture.name,mime:capture.blob.type,bytes:bytes.length,
            exact:bytes.length===expected.length&&bytes.every((value,index)=>value===expected[index]),revoked:revoked.includes(capture.url)});}
          return {files,expectedBytes:expected.length,taskReleased:host.markdownEditorExportTaskPort.getSnapshot().activeTask===null,
            scoped:typeof window.markdownEditorMarkdownExportPort==='undefined'&&Object.isFrozen(host.markdownEditorMarkdownExportPort),
            samePreview:preview.childNodes.length===nodes.length&&nodes.every((node,index)=>preview.childNodes[index]===node),
            oldDownloadRetired:typeof exportMarkdownContent==='undefined'};
        } finally {input.value=name;URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
      })()`));
    }
    await writeFile(join(artifactRoot,'r14-09-raw-model-exports.json'),JSON.stringify(results,null,2));
    assert.equal(results[0].expectedBytes,0);assert.ok(results[2].expectedBytes>400000);
    for(const row of results){assert.equal(row.files.length,2);assert.equal(row.files[0].name,'原文 report.md');
      for(const file of row.files){assert.equal(file.exact,true);assert.equal(file.revoked,true);assert.equal(file.mime,'text/markdown;charset=utf-8');}
      for(const field of ['taskReleased','scoped','samePreview','oldDownloadRetired'])assert.equal(row[field],true,field);}
  });

  await test('R14-09 actual document context command exports an inactive source without changing the active model', async () => {
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,docs=host.markdownEditorDocumentControllerPort,ui=host.markdownEditorDocumentUiCommandPort;
      const initial=docs.activeId,create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
      const blobs=new Map(),captures=[],revoked=[];let selected,active;
      URL.createObjectURL=function(blob){const url=create.call(URL,blob);blobs.set(url,blob);return url;};
      URL.revokeObjectURL=function(url){revoked.push(url);return revoke.call(URL,url);};
      HTMLAnchorElement.prototype.click=function(){if(this.download)captures.push({name:this.download,url:this.href,blob:blobs.get(this.href)});else return click.call(this);};
      try {
        const inputTitle='selected source.docx';
        selected=await docs.newDocument({title:inputTitle,content:'Selected 原文 😀  \\n$x^2$\\n',fallbackTitle:'未命名文档'});
        await applyDocumentLifecycleUi(selected);
        active=await docs.newDocument({title:'active source.md',content:'Active body stays here',fallbackTitle:'未命名文档'});
        await applyDocumentLifecycleUi(active);
        const model=window.__markdownEditorE2E,before=model.getEditorValue(),version=model.snapshot().documentVersion;
        await ui.invoke('exportDocument',selected.record.id);
        if(captures.length!==1)throw new Error('Expected one selected-context Markdown file');
        const capture=captures[0];
        return {inputTitle,createdTitle:selected.record.title,storedTitle:docs.getRecord(selected.record.id).title,
          name:capture.name,content:await capture.blob.text(),mime:capture.blob.type,revoked:revoked.includes(capture.url),
          activeUnchanged:docs.activeId===active.record.id&&model.getEditorValue()===before&&model.snapshot().documentVersion===version,
          taskReleased:host.markdownEditorExportTaskPort.getSnapshot().activeTask===null};
      } finally {
        URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;
        if(initial){await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('openDocument',initial);if(selected)await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('closeDocument',selected.record.id);if(active)await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('closeDocument',active.record.id);}
      }
    })()`);
    await writeFile(join(artifactRoot,'r14-09-inactive-document-export.json'),JSON.stringify(result,null,2));
    assert.equal(result.inputTitle,'selected source.docx');
    assert.equal(result.createdTitle,'selected source.docx.md');assert.equal(result.storedTitle,'selected source.docx.md');
    assert.equal(result.name,'selected source.docx.md');assert.equal(result.content,'Selected 原文 😀  \n$x^2$\n');assert.equal(result.mime,'text/markdown;charset=utf-8');
    for(const field of ['revoked','activeUnchanged','taskReleased'])assert.equal(result[field],true,field);
  });

  await test('R14-09 actual pre-write source changes block publication and the next raw export succeeds', async () => {
    await loadMarkdown('# Original raw source');
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,tasks=host.markdownEditorExportTaskPort,editor=host.markdownEditorEditorControllerPort;
      const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click,blobs=new Map(),captures=[],revoked=[];
      URL.createObjectURL=function(blob){const url=create.call(URL,blob);blobs.set(url,blob);return url;};
      URL.revokeObjectURL=function(url){revoked.push(url);return revoke.call(URL,url);};
      HTMLAnchorElement.prototype.click=function(){if(this.download)captures.push({url:this.href,blob:blobs.get(this.href)});else return click.call(this);};
      let changed=false;
      const dispose=tasks.subscribe(s=>{if(!changed&&s.activeTask?.phase==='serializing'){changed=true;editor.setText('new raw line\\n'+window.__markdownEditorE2E.getEditorValue());}});
      try {
        await exportFile();const first=captures.length,releasedAfterStale=tasks.getSnapshot().activeTask===null;
        dispose();await exportFile();
        if(captures.length!==1)throw new Error('Expected only the next raw export');
        const capture=captures[0];return {changed,first,releasedAfterStale,second:captures.length,revoked:revoked.includes(capture.url),
          content:await capture.blob.text(),expected:window.__markdownEditorE2E.getEditorValue(),released:tasks.getSnapshot().activeTask===null};
      } finally {dispose();URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
    })()`);
    await writeFile(join(artifactRoot,'r14-09-stale-source-export.json'),JSON.stringify(result,null,2));
    assert.equal(result.changed,true);assert.equal(result.first,0);assert.equal(result.second,1);assert.equal(result.content,result.expected);
    assert.ok(result.content.startsWith('new raw line\n'));for(const field of ['releasedAfterStale','revoked','released'])assert.equal(result[field],true,field);
  });

  for (const {format,label,stage,prefix,command,extension,mimeType,portKey} of [
    {format:'html',label:'HTML',stage:'R14-10',prefix:'r14-10',command:'exportHTML',extension:'html',mimeType:'text/html;charset=utf-8',portKey:'markdownEditorHtmlExportPort'},
    {format:'word',label:'Word',stage:'R14-11',prefix:'r14-11',command:'exportWord',extension:'doc',mimeType:'application/msword;charset=utf-8',portKey:'markdownEditorWordExportPort'}
  ]) {
  await test(`${stage} unmodified standalone ${label} renders complete math/code/tasks/diagrams with networking disabled`, async () => {
    await loadMarkdown(fixture.source);
    const html=await evaluateExport(page, `(async()=>{
      const blobs=new Map(),captures=[],create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
      const input=document.getElementById('filename'),name=input.value;
      URL.createObjectURL=blob=>{const url=create.call(URL,blob);blobs.set(url,blob);return url;};
      HTMLAnchorElement.prototype.click=function(){if(this.download)captures.push(blobs.get(this.href));else click.call(this);};
      try {input.value="Standalone A&B' source.docx";await ${command}();if(captures.length!==1)throw new Error('Missing standalone HTML');return await captures[0].text();}
      finally {input.value=name;URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
    })()`);
    await writeFile(join(artifactRoot,`${prefix}-standalone.${extension}`),html);
    assert.doesNotMatch(html,/<script[\s>]|cdn\.jsdelivr|exportPresentationPort/i);
    const networkRequests=[],blockedRequests=[],networkErrors=[];
    const controlUrl=`https://${prefix}-offline.invalid/control`;
    const unsubscribe=page.connection.on('Fetch.requestPaused',event=>{
      blockedRequests.push(event.request.url);
      if(event.request.url!==controlUrl)networkRequests.push(event.request.url);
      void page.connection.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'}).catch(error=>networkErrors.push(String(error)));
    });
    let result;
    try {
      await page.connection.send('Fetch.enable',{patterns:[{urlPattern:'http://*',requestStage:'Request'},{urlPattern:'https://*',requestStage:'Request'}]});
      const controlBlocked=await evaluateExport(page, `fetch(${JSON.stringify(controlUrl)}).then(()=>false,()=>true)`);
      assert.equal(controlBlocked,true);assert.deepEqual(blockedRequests,[controlUrl]);
      result=await evaluateExport(page, `(async()=>{
        const html=${JSON.stringify(html)},frame=document.createElement('iframe');frame.id='${prefix}-standalone-frame';
        frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;background:white;border:0';
        const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));frame.dataset.exportUrl=url;
        const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(new Error('Standalone document failed'));});
        frame.src=url;document.body.append(frame);await loaded;
        const doc=frame.contentDocument,view=frame.contentWindow;
        await Promise.race([Promise.all(Array.from(doc.fonts,face=>face.load())),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Offline font loading timed out')),10000))]);
        await doc.fonts.ready;
        const fonts=Array.from(doc.fonts,face=>({family:face.family,style:face.style,weight:face.weight,status:face.status}));
        const math=Array.from(doc.querySelectorAll('.katex-html'),node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}));
        return {title:doc.title,scripts:doc.scripts.length,links:doc.querySelectorAll('link').length,
          privateGlobal:typeof view.exportPresentationPort,fonts,math,mathml:doc.querySelectorAll('.katex-mathml').length,
          diagrams:doc.querySelectorAll('svg.f-mermaid-svg').length,task:doc.querySelectorAll('li.task-item input[type="checkbox"]').length,
          code:doc.querySelectorAll('.markdown-code-token').length,styles:doc.querySelector('style').textContent,
          fontUrls:Array.from(doc.querySelector('style[data-export-fonts]').sheet.cssRules,rule=>rule.style.getPropertyValue('src'))};
      })()`);
      await page.screenshot(join(artifactRoot,`${prefix}-offline-${format}.png`));
    } finally {
      try {await evaluateExport(page, `(()=>{const frame=document.getElementById('${prefix}-standalone-frame');if(frame){URL.revokeObjectURL(frame.dataset.exportUrl);frame.remove();}})()`);}
      finally {try {await page.connection.send('Fetch.disable');}finally {unsubscribe();}}
    }
    await writeFile(join(artifactRoot,`${prefix}-offline-${format}.json`),JSON.stringify({...result,fontUrls:result.fontUrls.map(url=>({inline:/data:font\/woff2;base64,/.test(url)})),networkRequests,blockedRequests,networkErrors},null,2));
    assert.equal(result.title,"Standalone A&B' source");assert.equal(result.scripts,0);assert.equal(result.links,0);assert.equal(result.privateGlobal,'undefined');
    assert.equal(result.fonts.length,20);assert.ok(result.fonts.every(face=>face.status==='loaded'));
    assert.equal(result.fontUrls.length,20);assert.ok(result.fontUrls.every(url=>/data:font\/woff2;base64,/.test(url)));
    assert.ok(result.styles.includes('data-export-format=\"'+format+'\"'));
    if(format==='word')assert.match(result.styles,/font-size:\s*12pt/);
    assert.equal(result.math.length,2);assert.ok(result.math.every(rect=>rect.width>0&&rect.height>0));assert.equal(result.mathml,2);
    assert.equal(result.diagrams,1);assert.equal(result.task,1);assert.ok(result.code>0);assert.deepEqual(networkRequests,[]);assert.deepEqual(networkErrors,[]);assert.deepEqual(blockedRequests,[controlUrl]);
  });

  await test(`${stage} actual ${label} export preserves empty Unicode and complete large bodies without replacing Preview`, async () => {
    const results=[],setupTrace=[],setupTracePath=join(artifactRoot,`${prefix}-complete-${format}-setup.json`);
    for(const source of ['', '# Unicode 中文 😀\n\n完整正文', '# Large HTML\n\n'+'原文 😀'.repeat(90000)+'\n\nEND-HTML']) {
      await loadCompleteBodyFixture(page,source,setupTrace,setupTracePath);
      const exportRow={sourceLength:source.length,step:'export-and-readback',status:'started'},exportStarted=performance.now();
      setupTrace.push(exportRow);await writeFile(setupTracePath,JSON.stringify(setupTrace,null,2));
      try {
      results.push(await evaluateExport(page, `(async()=>{
        const host=applicationCapabilities,preview=document.getElementById('preview'),nodes=Array.from(preview.childNodes);
        const expected=window.__markdownEditorE2E.getEditorValue(),blobs=new Map(),captures=[],revoked=[];
        const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
        URL.createObjectURL=blob=>{const url=create.call(URL,blob);blobs.set(url,blob);return url;};
        URL.revokeObjectURL=url=>{revoked.push(url);return revoke.call(URL,url);};
        HTMLAnchorElement.prototype.click=function(){if(this.download)captures.push({name:this.download,url:this.href,blob:blobs.get(this.href)});else click.call(this);};
        try {
          await ${command}();if(captures.length!==1)throw new Error('Expected one complete HTML file');
          const capture=captures[0],html=await capture.blob.text(),doc=new DOMParser().parseFromString(html,'text/html'),body=doc.body;
          if(!body.matches('.export-document[data-export-format="${format}"]'))throw new Error('Missing standalone HTML body');
          const payload=expected.startsWith('# Large HTML')?expected.split('\\n\\n')[1]:expected?'完整正文':'';
          return {sourceLength:expected.length,bodyComplete:body.textContent.includes(payload)&&(!expected||body.textContent.includes(expected.startsWith('# Large HTML')?'END-HTML':'Unicode 中文 😀')),
            empty:expected.length===0&&body.textContent.trim()==='',mime:capture.blob.type,revoked:revoked.includes(capture.url),scripts:doc.scripts.length,
            embeddedFonts:doc.querySelector('style[data-export-fonts]').textContent.match(/@font-face/g).length,
            samePreview:preview.childNodes.length===nodes.length&&nodes.every((node,index)=>preview.childNodes[index]===node),
            released:host.markdownEditorExportTaskPort.getSnapshot().activeTask===null,scoped:typeof window['${portKey}']==='undefined'&&Object.isFrozen(host['${portKey}'])};
        } finally {URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
      })()`));
      exportRow.status='passed';
      } catch(error) {
        exportRow.status='failed';exportRow.error=String(error?.stack||error);
        throw error;
      } finally {
        exportRow.elapsedMs=Math.round(performance.now()-exportStarted);
        await writeFile(setupTracePath,JSON.stringify(setupTrace,null,2));
      }
    }
    await writeFile(join(artifactRoot,`${prefix}-complete-${format}-bodies.json`),JSON.stringify(results,null,2));
    assert.equal(results[0].empty,true);assert.ok(results[2].sourceLength>400000);
    for(const row of results){assert.equal(row.bodyComplete,true);assert.equal(row.mime,mimeType);assert.equal(row.scripts,0);assert.equal(row.embeddedFonts,20);
      for(const field of ['revoked','samePreview','released','scoped'])assert.equal(row[field],true,field);}
  });

  await test(`${stage} actual pre-write model changes block ${label} publication and the next export succeeds`, async () => {
    await loadMarkdown('# Original HTML\n\nOld body');
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,tasks=host.markdownEditorExportTaskPort,editor=host.markdownEditorEditorControllerPort;
      const blobs=new Map(),captures=[],create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
      URL.createObjectURL=blob=>{const url=create.call(URL,blob);blobs.set(url,blob);return url;};
      HTMLAnchorElement.prototype.click=function(){if(this.download)captures.push(blobs.get(this.href));else click.call(this);};
      let changed=false;const unsubscribe=tasks.subscribe(snapshot=>{if(!changed&&snapshot.activeTask?.phase==='serializing'){changed=true;editor.setText('# Current HTML\\n\\nNew body 原文 😀');}});
      try {
        await ${command}();const first=captures.length,releasedAfterStale=tasks.getSnapshot().activeTask===null;unsubscribe();
        await ${command}();if(captures.length!==1)throw new Error('Expected only the current HTML publication');
        const doc=new DOMParser().parseFromString(await captures[0].text(),'text/html'),body=doc.body;
        if(!body.matches('.export-document[data-export-format="${format}"]'))throw new Error('Missing standalone HTML body');
        return {changed,first,releasedAfterStale,second:captures.length,current:body.textContent.includes('New body 原文 😀'),released:tasks.getSnapshot().activeTask===null};
      } finally {unsubscribe();URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
    })()`);
    await writeFile(join(artifactRoot,`${prefix}-stale-${format}-source.json`),JSON.stringify(result,null,2));
    assert.equal(result.first,0);assert.equal(result.second,1);for(const field of ['changed','releasedAfterStale','current','released'])assert.equal(result[field],true,field);
  });

  }

  await test('R14-12 actual isolated print preserves edit preview hybrid and both identities with complete resources', async () => {
    await loadMarkdown(fixture.source);const rows=[];
    try {for(const mode of ['edit','preview','hybrid','both']) {
      await evaluateExport(page, `window.__markdownEditorE2E.setLayout(${JSON.stringify(mode)})`);
      rows.push(await evaluateExport(page, `(async()=>{
        const host=applicationCapabilities,tasks=host.markdownEditorExportTaskPort,port=host.markdownEditorPreviewCommandPort;
        const editor=document.getElementById('editor'),preview=document.getElementById('preview');
        const focus=document.querySelector('[data-menu-toggle="file-menu"]');
        if(!focus||focus.hidden||focus.disabled||!focus.getClientRects().length)throw new Error('Visible focus source is unavailable');
        focus.focus({preventScroll:true});
        if(document.activeElement!==focus)throw new Error('Focus source did not receive focus');
        if(!await window.__markdownEditorE2E.waitForIdle())throw new Error('Editor did not settle after focus change');
        if(document.activeElement!==focus)throw new Error('Focus source changed before PDF export');
        const describeFocus=()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id||null,exportTrigger:document.activeElement===focus});
        const focusBefore=describeFocus();
        const hybrid=editor.querySelector('.cm-content');if(!hybrid?.isConnected||!hybrid.childNodes.length)throw new Error('Mounted CodeMirror content is unavailable');
        const previewNodes=Array.from(preview.childNodes),hybridNodes=Array.from(hybrid.childNodes),view=port.getViewMode(),layout=host.markdownEditorLayoutStatePort.snapshot.mode;
        const before={previewScroll:preview.scrollTop,editorScroll:editorApi.getScrollMetrics().top,start:editorApi.getSelection().start,end:editorApi.getSelection().end};
        let printed,prints=0;const frames=[];
        const observer=new MutationObserver(records=>{for(const record of records)for(const frame of record.addedNodes)if(frame.matches?.('iframe[data-export-print="pdf"]')){
          frames.push(frame);frame.contentWindow.print=()=>{prints++;const doc=frame.contentDocument,root=doc.querySelector('.export-document'),css=frame.contentWindow.getComputedStyle(root);
            printed={format:root.dataset.exportFormat,heading:root.querySelector('h1')?.textContent,math:Array.from(doc.querySelectorAll('.katex'),node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})),
              mathml:doc.querySelectorAll('.katex-mathml').length,diagrams:doc.querySelectorAll('svg.f-mermaid-svg').length,task:doc.querySelectorAll('li.task-item input').length,code:doc.querySelectorAll('.markdown-code-token').length,
              fonts:Array.from(doc.fonts,face=>face.status),scripts:doc.scripts.length,privateGlobal:typeof frame.contentWindow.markdownEditorPresentationPort,
              color:css.color,paper:css.backgroundColor,locked:tasks.getSnapshot().activeTask?.phase==='printing'&&tasks.getSnapshot().activeTask?.cancelable===false,
              parentUnscoped:!preview.classList.contains('export-document')&&!hybrid.classList.contains('export-document'),focus:describeFocus()};
            frame.contentWindow.dispatchEvent(new Event('afterprint'));};}});observer.observe(document.body,{childList:true});
        try {await exportPDF();const focusAfterCommand=describeFocus();
          // ModalShell restores returnFocus in its scheduled close frame, after the export command resolves.
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return {mode:${JSON.stringify(mode)},layout,prints,printed,before,after:{previewScroll:preview.scrollTop,editorScroll:editorApi.getScrollMetrics().top,start:editorApi.getSelection().start,end:editorApi.getSelection().end},
          samePreview:preview.childNodes.length===previewNodes.length&&previewNodes.every((node,index)=>preview.childNodes[index]===node),
          sameHybrid:editor.querySelector('.cm-content')===hybrid&&hybrid.childNodes.length===hybridNodes.length&&hybridNodes.every((node,index)=>hybrid.childNodes[index]===node),sameView:port.getViewMode()===view,sameLayout:host.markdownEditorLayoutStatePort.snapshot.mode===layout,
          focusRestored:document.activeElement===focus,focusEvidence:{before:focusBefore,afterCommand:focusAfterCommand,afterModalFrame:describeFocus()},
          progressClosed:!document.getElementById('export-progress-modal').classList.contains('show'),removed:frames.length===1&&!frames[0].isConnected&&!document.querySelector('iframe[data-export-print="pdf"]'),released:tasks.getSnapshot().activeTask===null,
          scoped:typeof window.markdownEditorPdfExportPort==='undefined'&&Object.isFrozen(host.markdownEditorPdfExportPort)};
        }finally{observer.disconnect();}
      })()`));
    }} finally {await evaluateExport(page, 'window.__markdownEditorE2E.setLayout("both")');}
    await writeFile(join(artifactRoot,'r14-12-isolated-print.json'),JSON.stringify(rows,null,2));
    for(const row of rows){assert.equal(row.layout,row.mode);assert.equal(row.prints,1);assert.deepEqual(row.after,row.before);assert.equal(row.focusEvidence.before.exportTrigger,true);assert.deepEqual(row.focusEvidence.afterModalFrame,row.focusEvidence.before);for(const key of ['samePreview','sameHybrid','sameView','sameLayout','focusRestored','progressClosed','removed','released','scoped'])assert.equal(row[key],true,key);
      const out=row.printed;assert.equal(out.format,'pdf');assert.equal(out.heading,'Export baseline');assert.equal(out.math.length,2);assert.ok(out.math.every(x=>x.width>0&&x.height>0));assert.equal(out.mathml,2);assert.equal(out.diagrams,1);assert.equal(out.task,1);assert.ok(out.code>0);
      assert.equal(out.fonts.length,20);assert.ok(out.fonts.every(x=>x==='loaded'));assert.equal(out.scripts,0);assert.equal(out.privateGlobal,'undefined');assert.equal(out.color,'rgb(0, 0, 0)');assert.equal(out.paper,'rgb(255, 255, 255)');assert.equal(out.locked,true);assert.equal(out.parentUnscoped,true);}
  });

  await test('R14-12 actual print timeout and platform failure clean the surface and allow the next command', async () => {
    await loadMarkdown(fixture.source);
    const rows=await evaluateExport(page, `(async()=>{
      const tasks=applicationCapabilities.markdownEditorExportTaskPort,originalTimer=window.setTimeout,originalError=console.error;
      const rows=[];let mode='timeout',prints=0,errors=[],frames=[];
      window.setTimeout=(callback,delay,...args)=>originalTimer(callback,delay===1200?25:delay,...args);console.error=(...args)=>errors.push(args.map(String).join(' '));
      const observer=new MutationObserver(records=>{for(const record of records)for(const frame of record.addedNodes)if(frame.matches?.('iframe[data-export-print="pdf"]')){
        frames.push(frame);frame.contentWindow.print=()=>{prints++;if(mode==='failure')throw new Error('R14-12 injected print boundary failure');if(mode==='recovery')frame.contentWindow.dispatchEvent(new Event('afterprint'));};}});observer.observe(document.body,{childList:true});
      try {for(mode of ['timeout','failure','recovery']){const before=prints;errors=[];frames=[];await exportPDF();rows.push({mode,prints:prints-before,errors:[...errors],removed:frames.length===1&&!frames[0].isConnected&&!document.querySelector('iframe[data-export-print="pdf"]'),released:tasks.getSnapshot().activeTask===null,progressClosed:!document.getElementById('export-progress-modal').classList.contains('show')});}return rows;
      }finally{observer.disconnect();window.setTimeout=originalTimer;console.error=originalError;}
    })()`);
    await writeFile(join(artifactRoot,'r14-12-print-recovery.json'),JSON.stringify(rows,null,2));
    for(const row of rows){assert.equal(row.prints,1);for(const key of ['removed','released','progressClosed'])assert.equal(row[key],true,key);if(row.mode==='failure'){assert.equal(row.errors.length,1);assert.match(row.errors[0],/injected print boundary failure/);}else assert.deepEqual(row.errors,[]);}
  });

  await test('R14-12 actual cancellation and source change during the print delay give zero prints before recovery', async () => {
    await loadMarkdown(fixture.source);
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,tasks=host.markdownEditorExportTaskPort,editor=host.markdownEditorEditorControllerPort;
      const originalTimer=window.setTimeout;let queued,prints=0,body;const rows=[];
      window.setTimeout=(callback,delay,...args)=>{if(delay===80){queued=callback;return -1412;}return originalTimer(callback,delay,...args);};
      const observer=new MutationObserver(records=>{for(const record of records)for(const frame of record.addedNodes)if(frame.matches?.('iframe[data-export-print="pdf"]'))frame.contentWindow.print=()=>{prints++;body=frame.contentDocument.body.textContent;frame.contentWindow.dispatchEvent(new Event('afterprint'));};});observer.observe(document.body,{childList:true});
      try {for(const action of ['cancel','changed','recovery']){
        queued=null;const before=prints,work=exportPDF();for(let i=0;i<1000&&!queued;i++)await new Promise(resolve=>originalTimer(resolve,5));if(!queued)throw new Error('PDF did not reach its real print delay');
        let cancelled=null;if(action==='cancel')cancelled=tasks.cancel();if(action==='changed')editor.setText('# Current print\\n\\nCurrent PDF 原文 😀');
        await queued();await work;rows.push({action,prints:prints-before,cancelled,released:tasks.getSnapshot().activeTask===null,removed:!document.querySelector('iframe[data-export-print="pdf"]')});
      }return {rows,body,current:body?.includes('Current PDF 原文 😀')===true};}finally{observer.disconnect();window.setTimeout=originalTimer;}
    })()`);
    await writeFile(join(artifactRoot,'r14-12-stale-print.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.rows.map(x=>x.prints),[0,0,1]);assert.equal(result.rows[0].cancelled,true);assert.equal(result.current,true);for(const row of result.rows){assert.equal(row.released,true);assert.equal(row.removed,true);}
  });

  await test('R14-13 actual five ratio buttons produce exact PNG pixels with scoped geometry and unchanged Preview', async () => {
    await loadMarkdown('# Layout pixels\n\nKEEP FULL BODY 原文 😀');
    const rows=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,tasks=host.markdownEditorExportTaskPort,stage=document.getElementById('export-image-stage'),preview=document.getElementById('export-image-preview');
      const appPreview=document.getElementById('preview'),originalNodes=Array.from(appPreview.childNodes),renderer=await host.markdownEditorPresentationPort.loadDomToImage(),originalPng=renderer.toPng;
      const checkbox=document.getElementById('image-crop-fit'),oldCrop=checkbox.checked,oldRatio=document.querySelector('.ratio-btn.active')?.dataset.ratio||'9:16';const rows=[];let capture,encodes=0;
      renderer.toPng=async(root,input)=>{encodes++;const css=getComputedStyle(root);capture={width:input.width,height:input.height,mode:root.getAttribute('data-export-image-layout'),cssWidth:css.width,cssHeight:css.height,boxSizing:css.boxSizing,paddingBlock:css.paddingTop,paddingInline:css.paddingLeft,fontSize:css.fontSize,stageWidth:getComputedStyle(stage).width,stageHeight:getComputedStyle(stage).height,
        complete:root.textContent.includes('KEEP FULL BODY 原文 😀'),locked:tasks.getSnapshot().activeTask?.phase==='encoding'&&tasks.getSnapshot().activeTask?.cancelable===false};const png=await originalPng.call(renderer,root,input);capture.png=png;return png;};
      const run=async ratio=>{capture=null;const prior=tasks.getSnapshot().lastTaskId;document.querySelector('.ratio-btn[data-ratio="'+ratio+'"]').click();if(tasks.getSnapshot().lastTaskId===prior)throw new Error('Ratio button did not start the real image task');
        const started=performance.now();while(tasks.getSnapshot().activeTask){if(performance.now()-started>15000)throw new Error('Image ratio task did not finish');await new Promise(resolve=>requestAnimationFrame(resolve));}
        if(!capture?.png||preview.src!==capture.png)throw new Error('Ratio command did not publish its actual encoded PNG');const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Ratio PNG decode failed'));image.src=capture.png;});
        const root=document.getElementById('export-image-content').firstElementChild;return {ratio,...capture,pixelWidth:image.naturalWidth,pixelHeight:image.naturalHeight,released:root===null&&!stage.hasAttribute('data-export-image-layout')&&stage.style.getPropertyValue('--export-image-height')==='',
          samePreview:appPreview.childNodes.length===originalNodes.length&&originalNodes.every((node,index)=>appPreview.childNodes[index]===node),scoped:typeof window.markdownEditorImageLayoutPort==='undefined'&&Object.isFrozen(host.markdownEditorImageLayoutPort)};};
      try {checkbox.checked=false;for(const ratio of ['9:16','4:5','3:4','1:1','16:9'])rows.push(await run(ratio));
        let replaced=false;const beforeEncodes=encodes,unsubscribe=tasks.subscribe(snapshot=>{if(!replaced&&snapshot.activeTask?.phase==='enhancing'&&document.getElementById('export-image-content').firstElementChild?.hasAttribute('data-export-image-layout')){replaced=true;document.querySelector('.ratio-btn[data-ratio="1:1"]').click();}});
        try{const rapid=await run('4:5');rows.push({...rapid,ratio:'1:1',rapidReplaced:replaced,rapidEncodes:encodes-beforeEncodes,activeRatio:document.querySelector('.ratio-btn.active')?.dataset.ratio});}finally{unsubscribe();}return rows;
      }finally{checkbox.checked=oldCrop;renderer.toPng=originalPng;selectImageRatio(oldRatio);const started=performance.now();while(tasks.getSnapshot().activeTask){if(performance.now()-started>15000)throw new Error('Image ratio restore did not finish');await new Promise(resolve=>requestAnimationFrame(resolve));}}
    })()`);
    await writeFile(join(artifactRoot,'r14-13-ratio-pixels.json'),JSON.stringify(rows.map(({png,...row})=>row),null,2));
    const sizes={'9:16':[1080,1920],'4:5':[1080,1350],'3:4':[1080,1440],'1:1':[1080,1080],'16:9':[1920,1080]};
    for(const row of rows){await writeFile(join(artifactRoot,'r14-13-ratio-'+(row.rapidReplaced?'rapid-':'')+row.ratio.replace(':','_')+'.png'),Buffer.from(row.png.split(',')[1],'base64'));
      const [width,height]=sizes[row.ratio];assert.equal(row.width,width);assert.equal(row.pixelWidth,width);assert.equal(row.height,height);assert.equal(row.pixelHeight,height);assert.equal(row.mode,'pad');assert.equal(row.boxSizing,'border-box');
      assert.equal(row.cssWidth,width+'px');assert.equal(row.cssHeight,height+'px');assert.equal(row.stageWidth,width+'px');assert.equal(row.stageHeight,height+'px');assert.equal(row.paddingBlock,Math.round(width*0.04)+'px');assert.equal(row.paddingInline,Math.round(width*0.045)+'px');assert.equal(row.fontSize,Math.round(width/36)+'px');
      for(const field of ['complete','locked','released','samePreview','scoped'])assert.equal(row[field],true,field);}
    const rapid=rows.at(-1);assert.equal(rapid.rapidReplaced,true);assert.equal(rapid.rapidEncodes,1);assert.equal(rapid.activeRatio,'1:1');
  });

  await test('R14-13 actual natural long PNG and cropped PNG retain full DOM and identical visible prefix', async () => {
    await loadMarkdown('# Long geometry\n\n'+Array.from({length:50},(_,index)=>'Geometry paragraph '+index+(index===49?' KEEP LAST 原文 😀':' — readable content')).join('\n\n'));
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,tasks=host.markdownEditorExportTaskPort,renderer=await host.markdownEditorPresentationPort.loadDomToImage(),originalPng=renderer.toPng;
      const checkbox=document.getElementById('image-crop-fit'),oldCrop=checkbox.checked,oldRatio=document.querySelector('.ratio-btn.active')?.dataset.ratio||'9:16';let captured;const rows=[];
      renderer.toPng=async(root,input)=>{const css=getComputedStyle(root),tail=root.querySelector('.markdown-body')?.lastElementChild,rect=root.getBoundingClientRect();captured={width:input.width,height:input.height,mode:root.getAttribute('data-export-image-layout'),overflow:css.overflow,bodyComplete:root.textContent.includes('KEEP LAST 原文 😀'),paragraphs:root.querySelectorAll('p').length,tailBottom:tail?tail.getBoundingClientRect().bottom-rect.top:null};
        const png=await originalPng.call(renderer,root,input);captured.png=png;return png;};
      const decode=async png=>{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Long/crop PNG decode failed'));image.src=png;});const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,context};};
      try {for(const cropFit of [false,true]){captured=null;checkbox.checked=cropFit;document.querySelector('.ratio-btn[data-ratio="9:16"]').click();const started=performance.now();while(tasks.getSnapshot().activeTask){if(performance.now()-started>15000)throw new Error('Long/crop task did not finish');await new Promise(resolve=>requestAnimationFrame(resolve));}
          if(!captured?.png||document.getElementById('export-image-preview').src!==captured.png)throw new Error('Long/crop image did not publish the real PNG');const decoded=await decode(captured.png),root=document.getElementById('export-image-content').firstElementChild;
          rows.push({cropFit,...captured,pixelWidth:decoded.width,pixelHeight:decoded.height,released:tasks.getSnapshot().activeTask===null&&root===null&&!document.getElementById('export-image-stage').hasAttribute('data-export-image-layout')});}
        const long=await decode(rows[0].png),crop=await decode(rows[1].png),a=long.context.getImageData(0,0,crop.width,crop.height).data,b=crop.context.getImageData(0,0,crop.width,crop.height).data;let differentPixels=0;
        for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])differentPixels++;return {rows,differentPixels};
      }finally{checkbox.checked=oldCrop;renderer.toPng=originalPng;selectImageRatio(oldRatio);const started=performance.now();while(tasks.getSnapshot().activeTask){if(performance.now()-started>15000)throw new Error('Long/crop restore did not finish');await new Promise(resolve=>requestAnimationFrame(resolve));}}
    })()`);
    await writeFile(join(artifactRoot,'r14-13-long-crop.json'),JSON.stringify({...result,rows:result.rows.map(({png,...row})=>row)},null,2));
    for(const row of result.rows){await writeFile(join(artifactRoot,'r14-13-'+(row.cropFit?'crop':'long')+'.png'),Buffer.from(row.png.split(',')[1],'base64'));assert.equal(row.width,1080);assert.equal(row.pixelWidth,1080);assert.equal(row.height,row.pixelHeight);assert.equal(row.bodyComplete,true);assert.equal(row.paragraphs,50);assert.equal(row.released,true);}
    const [long,crop]=result.rows;assert.equal(long.mode,'long');assert.equal(long.overflow,'visible');assert.ok(long.height>1920);assert.ok(long.tailBottom<=long.height);assert.equal(crop.mode,'crop');assert.equal(crop.overflow,'hidden');assert.equal(crop.height,1920);assert.ok(crop.tailBottom>crop.height);assert.equal(result.differentPixels,0,'Crop must keep the real long PNG visible prefix byte-for-byte.');
  });

  await test('R14-14 actual anonymous resources inline pixels while CORS errors, missing and stalled assets still produce PNG', async () => {
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><view id="logo" viewBox="0 0 80 40"/><rect width="80" height="40" fill="#1183d3"/></svg>';
    const inline='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAYAAABpYH0BAAAAX0lEQVR4nO3QMQ0AIADAMCygGYkIAg88ZEmP/UvHXPvovfF7oB5AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgH+7euX8tAdMvQMAAAAASUVORK5CYII=',requests=[];
    const server=createServer((request,response)=>{
      requests.push({url:request.url,origin:request.headers.origin||null,cookie:request.headers.cookie||null});
      const path=new URL(request.url,'http://127.0.0.1').pathname;
      if(path==='/stall.svg')return;
      const headers={'Content-Type':'image/svg+xml','Cache-Control':'no-store'};
      if(path!=='/no-cors.svg')headers['Access-Control-Allow-Origin']='*';
      response.writeHead(path==='/missing.svg'?404:200,headers);response.end(path==='/missing.svg'?'missing':svg);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;
    let result;
    try {
      await loadMarkdown('# Asset preparation\n\n![inline]('+inline+')\n\n![good]('+origin+'/good.svg?keep=1#logo)\n\n![no-cors]('+origin+'/no-cors.svg)\n\n![missing]('+origin+'/missing.svg)\n\n![stall]('+origin+'/stall.svg)\n\nKEEP TAIL 原文 😀');
      result=await evaluateExport(page, `(async()=>{
        const host=applicationCapabilities,assets=host.markdownEditorImageAssetPort,tasks=host.markdownEditorExportTaskPort;
        const renderer=await host.markdownEditorPresentationPort.loadDomToImage(),original=renderer.toPng,preview=document.getElementById('preview');
        const previewNodes=Array.from(preview.childNodes),progress=[];let captured;
        const oldRatio=currentImageRatio,oldCrop=document.getElementById('image-crop-fit').checked;currentImageRatio='9:16';document.getElementById('image-crop-fit').checked=false;
        const unsubscribe=tasks.subscribe(snapshot=>{if(snapshot.activeTask?.phase==='images')progress.push(snapshot.activeTask.progress);});
        renderer.toPng=async(root,input)=>{
          const rect=root.getBoundingClientRect();captured={images:Array.from(root.querySelectorAll('img'),image=>{const r=image.getBoundingClientRect();return {alt:image.alt,src:image.src,ready:image.complete&&image.naturalWidth>0,srcset:image.getAttribute('srcset'),x:Math.round(r.left-rect.left+5),y:Math.round(r.top-rect.top+5)};}),
            width:input.width,height:input.height,complete:root.textContent.includes('KEEP TAIL'),locked:tasks.getSnapshot().activeTask?.cancelable===false};
          captured.png=await original.call(renderer,root,input);return captured.png;
        };
        try {
          const start=performance.now();await renderExportImagePreview();
          if(!captured?.png)throw new Error('Mixed assets did not reach actual PNG encoding');
          const image=new Image();image.src=captured.png;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          const context=canvas.getContext('2d');context.drawImage(image,0,0);for(const asset of captured.images)asset.pixel=Array.from(context.getImageData(asset.x,asset.y,1,1).data);
          return {...captured,pixelWidth:image.naturalWidth,pixelHeight:image.naturalHeight,duration:performance.now()-start,inlineUnchanged:captured.images[0].src===${JSON.stringify(inline)},
            placeholderCount:captured.images.filter(item=>item.src===assets.placeholder).length,progress,taskEnded:tasks.getSnapshot().activeTask===null,
            previewPreserved:previewNodes.length===preview.childNodes.length&&previewNodes.every((node,index)=>preview.childNodes[index]===node),
            layoutReleased:!document.getElementById('export-image-stage').hasAttribute('data-export-image-layout'),published:document.getElementById('export-image-preview').src===captured.png};
        }finally{unsubscribe();renderer.toPng=original;currentImageRatio=oldRatio;document.getElementById('image-crop-fit').checked=oldCrop;}
      })()`);
    } finally {await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}
    await writeFile(join(artifactRoot,'r14-14-mixed-assets.json'),JSON.stringify({...result,png:undefined,images:result.images.map(({src,...item})=>({...item,sourceKind:src.startsWith('data:image/png')?'png':'svg'})),requests},null,2));
    await writeFile(join(artifactRoot,'r14-14-mixed-assets.png'),Buffer.from(result.png.split(',')[1],'base64'));
    assert.equal(result.images.length,5);assert.equal(result.placeholderCount,3);assert.equal(result.inlineUnchanged,true);
    for(const field of ['complete','locked','taskEnded','previewPreserved','layoutReleased','published'])assert.equal(result[field],true,field);
    assert.equal(result.pixelWidth,1080);assert.equal(result.pixelHeight,1920);
    for(const item of result.images){assert.equal(item.ready,true);assert.equal(item.srcset,null);assert.deepEqual(item.pixel,item.alt==='inline'||item.alt==='good'?[17,131,211,255]:[233,236,239,255]);}
    assert.deepEqual(result.progress,[90,91,92,93,94,95]);assert.ok(result.duration>=9000&&result.duration<25000);
    const corsRequests=requests.filter(item=>new URL(item.url,origin).searchParams.has('_cors'));
    assert.equal(corsRequests.length,4,'Already inlined assets must not cause another remote request in PNG encoding.');
    assert.equal(corsRequests.every(item=>item.origin===applicationHost.origin&&item.cookie===null),true);
    assert.equal(new URL(corsRequests.find(item=>item.url.startsWith('/good.svg')).url,origin).searchParams.get('keep'),'1');
  });

  await test('R14-14 actual public preloader rejects cancelled and stale decode without late projection and recovers', async () => {
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,assets=host.markdownEditorImageAssetPort,tasks=host.markdownEditorExportTaskPort;
      const source=assets.placeholder,rows=[];
      for(const action of ['cancel','replace','stale']){
        const root=document.createElement('div'),image=document.createElement('img');image.src=source;root.append(image);document.body.append(root);
        let late,entered=false,current=true;image.decode=()=>{entered=true;return new Promise(resolve=>{late=resolve;});};
        const task=tasks.begin('asset '+action),work=assets.prepare({root,task,isCurrent:()=>current}).then(()=>({unexpected:true}),error=>({cancelled:tasks.isCancelled(error),reason:error.reason}));
        const started=performance.now();while(!entered){if(performance.now()-started>5000)throw new Error('Asset decode not entered');await new Promise(resolve=>setTimeout(resolve,5));}
        let replacementTask=null;if(action==='cancel')tasks.cancel();else if(action==='replace')replacementTask=tasks.begin('new assets');else current=false;
        image.src='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');const replacement=image.src;late();
        const status=await work;rows.push({action,...status,preserved:image.src===replacement});root.remove();
        if(tasks.getSnapshot().activeTask)tasks.finish(replacementTask||task);
      }
      const root=document.createElement('div'),image=document.createElement('img');image.src=source;root.append(image);document.body.append(root);
      const recoveryTask=tasks.begin('asset recovery'),recovery=await assets.prepare({root,task:recoveryTask});tasks.finish(recoveryTask);root.remove();
      return {rows,recovery,ended:tasks.getSnapshot().activeTask===null,retired:typeof prepareExportImages==='undefined'};
    })()`);
    await writeFile(join(artifactRoot,'r14-14-assets-recovery.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.rows.map(row=>row.reason),['cancelled','replaced','document-changed']);
    for(const row of result.rows){assert.equal(row.cancelled,true);assert.equal(row.preserved,true);}
    assert.deepEqual(result.recovery,{total:1,inline:1,loaded:0,failed:0});assert.equal(result.ended,true);assert.equal(result.retired,true);
  });

  // Final app probe: exercise the production pagehide owner after all other export probes.
  await test('R14-15 actual PNG bytes reach browser Blob downloads with exact bytes and URL cleanup', async () => {
    await loadMarkdown('# R14-15 编码😀\n\nActual PNG binary download.');
    const result = await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,encoder=host.markdownEditorImageDataPort;
      const input=document.getElementById('filename'),oldName=input.value;
      const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
      const blobs=new Map(),captures=[],revoked=[];
      URL.createObjectURL=function(blob){const url=create.call(URL,blob);blobs.set(url,blob);return url;};
      URL.revokeObjectURL=function(url){revoked.push(url);return revoke.call(URL,url);};
      HTMLAnchorElement.prototype.click=function(){if(this.download){captures.push({name:this.download,url:this.href,blob:blobs.get(this.href)});return;}return click.call(this);};
      try{
        input.value='编码😀.md';await renderExportImagePreview();
        const png=host.markdownEditorImageExportPort.getPreview()?.dataUrl;if(!png.startsWith('data:image/png;base64,'))throw new Error('Missing actual PNG.');
        const raw=atob(png.split(',')[1]),expected=Uint8Array.from(raw,c=>c.charCodeAt(0)),encoded=encoder.encode(png);
        if(encoded.length!==expected.length||!encoded.every((v,i)=>v===expected[i]))throw new Error('Encoder altered PNG bytes.');
        await downloadExportImage();if(captures.length!==1||!captures[0].blob)throw new Error('Missing actual Blob output.');
        const capture=captures[0],bytes=new Uint8Array(await capture.blob.arrayBuffer());
        if(bytes.length!==expected.length||!bytes.every((v,i)=>v===expected[i]))throw new Error('Binary download altered PNG bytes.');
        const decoded=await createImageBitmap(capture.blob);const dimensions={width:decoded.width,height:decoded.height};decoded.close();
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
        return {name:capture.name,mime:capture.blob.type,bytes:bytes.length,digest,dimensions,exactBytes:true,revoked:revoked.includes(capture.url),signature:Array.from(bytes.slice(0,8)),retired:typeof dataUrlToBytes==='undefined'};
      }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;input.value=oldName;}
    })()`);
    assert.equal(result.name,'编码😀.png');assert.equal(result.mime,'image/png');assert.ok(result.bytes>100);
    assert.deepEqual(result.signature,[137,80,78,71,13,10,26,10]);
    for(const key of ['exactBytes','revoked','retired'])assert.equal(result[key],true,key);
    assert.ok(result.dimensions.width>0&&result.dimensions.height>0);assert.match(result.digest,/^[0-9a-f]{64}$/);
    await writeFile(join(artifactRoot,'r14-15-browser-image-data.json'),JSON.stringify(result,null,2));
  });

  await test('R14-15 actual Unicode and binary decoding reject malformed input and failed download releases URL before recovery', async () => {
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,encoder=host.markdownEditorImageDataPort;
      const platform=host.markdownEditorPlatformPort,create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
      const urls=[],revoked=[],captures=[],blobs=new Map();
      URL.createObjectURL=function(blob){const url=create.call(URL,blob);urls.push(url);blobs.set(url,blob);return url;};
      URL.revokeObjectURL=function(url){revoked.push(url);return revoke.call(URL,url);};
      try{
        const unicode=Array.from(encoder.encode('data:,汉😀'+String.fromCharCode(0xD800)));
        const binary=Array.from(encoder.encode('data:,%00%80%FF'));
        let rejected=false;try{encoder.encode('data:;base64,!');}catch(error){rejected=error.name==='ImageDataEncodingError';}
        try{await platform.files.writeBinary('invalid.png',encoder.encode('data:;base64,!'),{extension:'png',mimeType:'image/png',reason:'export'});}catch{}const invalidCreates=urls.length;
        const bytesToSave=encoder.encode('data:;base64,AP8=');
        HTMLAnchorElement.prototype.click=function(){throw new Error('R14-15 owned download fault');};
        try{await platform.files.writeBinary('binary-recovery.png',bytesToSave,{extension:'png',mimeType:'image/png',reason:'export'});}catch{}const failedRevoked=urls.length===1&&revoked.includes(urls[0]);
        HTMLAnchorElement.prototype.click=function(){captures.push({url:this.href,blob:blobs.get(this.href)});};
        await platform.files.writeBinary('binary-recovery.png',bytesToSave,{extension:'png',mimeType:'image/png',reason:'export'});const bytes=Array.from(new Uint8Array(await captures[0].blob.arrayBuffer()));
        return {unicode,binary,rejected,invalidCreates,failedRevoked,recovered:captures.length===1,recoveryBytes:bytes,recoveryRevoked:revoked.includes(captures[0].url),legacyHostAbsent:!document.getElementById('compatibility-business-ports')};
      }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
    })()`);
    assert.deepEqual(result.unicode,[230,177,137,240,159,152,128,239,191,189]);assert.deepEqual(result.binary,[0,128,255]);
    assert.equal(result.invalidCreates,0);assert.deepEqual(result.recoveryBytes,[0,255]);
    for(const key of ['rejected','failedRevoked','recovered','recoveryRevoked','legacyHostAbsent'])assert.equal(result[key],true,key);
    await writeFile(join(artifactRoot,'r14-15-data-recovery.json'),JSON.stringify(result,null,2));
  });

  await test('R14-16 actual PNG encoding stays locked, discards edited-source output and recovers complete enhanced bytes', async () => {
    await loadMarkdown(fixture.source);
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,images=host.markdownEditorImageExportPort,tasks=host.markdownEditorExportTaskPort;
      const renderer=await host.markdownEditorPresentationPort.loadDomToImage(),original=renderer.toPng,editor=host.markdownEditorEditorControllerPort;
      const requests=host.markdownEditorExportRequestPort,request=()=>requests.createRequest({format:'image',imageOptions:{ratio:'9:16',cropFit:false}});
      let entered=false,release,capture,stalePng;const gate=new Promise(resolve=>release=resolve);
      renderer.toPng=async(root,options)=>{capture={root,math:root.querySelectorAll('.katex').length,diagrams:root.querySelectorAll('svg.f-mermaid-svg').length,
        hidden:Array.from(root.querySelectorAll('.katex-mathml')).every(node=>getComputedStyle(node).display==='none')};entered=true;
        stalePng=await original.call(renderer,root,options);await gate;return stalePng;};
      const work=images.render({request:request()}).then(()=>({unexpected:true}),error=>({cancelled:tasks.isCancelled(error),reason:error.reason}));
      try{
        const started=performance.now();while(!entered){if(performance.now()-started>10000)throw new Error('Actual PNG phase was not reached');await new Promise(resolve=>requestAnimationFrame(resolve));}
        const locked=tasks.getSnapshot().activeTask?.phase==='encoding'&&tasks.getSnapshot().activeTask?.cancelable===false;
        const cancelRejected=tasks.cancel()===false,replacementBusy=(await images.render({request:request()})).status==='busy';
        const retained=capture.root.isConnected&&capture.root.getAttribute('data-export-format')==='image';
        const current=window.__markdownEditorE2E.getEditorValue().replace('Export baseline','R14-16 Current 原文😀');editor.setText(current);
        release();const stale=await work;
        const blocked=images.getPreview()===null&&!document.getElementById('export-image-preview').hasAttribute('src');
        const released=!capture.root.isConnected&&document.getElementById('export-image-content').children.length===0&&tasks.getSnapshot().activeTask===null;
        renderer.toPng=original;await window.__markdownEditorE2E.waitForIdle();let recoveryBody;
        renderer.toPng=(root,options)=>{recoveryBody={heading:root.querySelector('h1')?.textContent,math:root.querySelectorAll('.katex').length,diagrams:root.querySelectorAll('svg.f-mermaid-svg').length,complete:root.textContent.includes('R14-16 Current 原文😀')&&root.textContent.includes('answer = 42')};return original.call(renderer,root,options);};
        const preview=document.getElementById('preview'),nodes=Array.from(preview.childNodes);
        const recovered=await images.render({request:request()}),png=images.getPreview().dataUrl;
        const image=new Image();image.src=png;await image.decode();
        return {locked,cancelRejected,replacementBusy,retained,stale,blocked,released,math:capture.math,diagrams:capture.diagrams,hidden:capture.hidden,
          recoveryBody,recovered:recovered.status==='ready',currentVersion:images.getPreview().documentVersion===window.__markdownEditorE2E.snapshot().documentVersion,
          samePreview:nodes.length===preview.childNodes.length&&nodes.every((node,index)=>preview.childNodes[index]===node),
          width:image.naturalWidth,height:image.naturalHeight,stalePng,png,retired:typeof currentImageDataUrl==='undefined',scoped:typeof window.markdownEditorImageExportPort==='undefined'&&Object.isFrozen(images)};
      }finally{release();renderer.toPng=original;await work;}
    })()`);
    await writeFile(join(artifactRoot,'r14-16-stale-encoding.json'),JSON.stringify({...result,png:undefined,stalePng:undefined},null,2));
    for(const [name,png] of [['discarded',result.stalePng],['recovered',result.png]])await writeFile(join(artifactRoot,'r14-16-'+name+'.png'),Buffer.from(png.split(',')[1],'base64'));
    for(const field of ['locked','cancelRejected','replacementBusy','retained','blocked','released','hidden','recovered','currentVersion','samePreview','retired','scoped'])assert.equal(result[field],true,field);
    assert.deepEqual(result.stale,{cancelled:true,reason:'document-changed'});assert.ok(result.math>=2);assert.equal(result.diagrams,1);
    assert.equal(result.recoveryBody.heading,'R14-16 Current 原文😀');assert.equal(result.recoveryBody.complete,true);assert.ok(result.recoveryBody.math>=2);assert.equal(result.recoveryBody.diagrams,1);
    assert.equal(result.width,1080);assert.ok(result.height>=1920);
  });

  await test('R14-16 actual encoder and browser write failures clean owned DOM and URLs before the next complete PNG download', async () => {
    await loadMarkdown('# R14-16 recovery 原文😀\n\nInline $x^2$ and complete tail.');
    const result=await evaluateExport(page, `(async()=>{
      const host=applicationCapabilities,images=host.markdownEditorImageExportPort,tasks=host.markdownEditorExportTaskPort;
      const renderer=await host.markdownEditorPresentationPort.loadDomToImage(),original=renderer.toPng;
      const request=host.markdownEditorExportRequestPort.createRequest({format:'image',name:'完整恢复😀.png',imageOptions:{ratio:'9:16',cropFit:false}});
      const preview=document.getElementById('preview'),nodes=Array.from(preview.childNodes);let failedRoot;
      renderer.toPng=async root=>{failedRoot=root;throw new Error('R14-16 injected encoder failure');};
      let encoderRejected=false;try{await images.render({request});}catch(error){encoderRejected=error.message==='R14-16 injected encoder failure';}finally{renderer.toPng=original;}
      const encoderClean=images.getPreview()===null&&!failedRoot.isConnected&&document.getElementById('export-image-content').children.length===0&&tasks.getSnapshot().activeTask===null;
      await images.render({request});const png=images.getPreview().dataUrl,expected=host.markdownEditorImageDataPort.encode(png);
      const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click,urls=[],revoked=[],blobs=new Map(),captures=[];
      URL.createObjectURL=blob=>{const url=create.call(URL,blob);urls.push(url);blobs.set(url,blob);return url;};
      URL.revokeObjectURL=url=>{revoked.push(url);return revoke.call(URL,url);};
      try{
        HTMLAnchorElement.prototype.click=function(){if(this.download)throw new Error('R14-16 injected browser write failure');return click.call(this);};
        let writeRejected=false;try{await images.save({request});}catch(error){writeRejected=error.message==='R14-16 injected browser write failure';}
        const failedRevoked=urls.length===1&&revoked.includes(urls[0]),failedTaskReleased=tasks.getSnapshot().activeTask===null;
        HTMLAnchorElement.prototype.click=function(){if(this.download){captures.push({name:this.download,url:this.href,blob:blobs.get(this.href)});return;}return click.call(this);};
        const saved=await images.save({request});if(captures.length!==1)throw new Error('Expected one recovered actual PNG Blob');
        const capture=captures[0],bytes=new Uint8Array(await capture.blob.arrayBuffer());
        const exactBytes=bytes.length===expected.length&&bytes.every((value,index)=>value===expected[index]);const decoded=await createImageBitmap(capture.blob);
        const width=decoded.width,height=decoded.height;decoded.close();
        return {encoderRejected,encoderClean,writeRejected,failedRevoked,failedTaskReleased,status:saved.status,name:capture.name,mime:capture.blob.type,
          bytes:bytes.length,exactBytes,width,height,revoked:revoked.includes(capture.url),taskReleased:tasks.getSnapshot().activeTask===null,
          captureReleased:document.getElementById('export-image-content').children.length===0,samePreview:nodes.length===preview.childNodes.length&&nodes.every((node,index)=>preview.childNodes[index]===node),png};
      }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;renderer.toPng=original;}
    })()`);
    await writeFile(join(artifactRoot,'r14-16-output-recovery.json'),JSON.stringify({...result,png:undefined},null,2));
    await writeFile(join(artifactRoot,'r14-16-downloaded.png'),Buffer.from(result.png.split(',')[1],'base64'));
    for(const field of ['encoderRejected','encoderClean','writeRejected','failedRevoked','failedTaskReleased','exactBytes','revoked','taskReleased','captureReleased','samePreview'])assert.equal(result[field],true,field);
    assert.equal(result.status,'downloaded');assert.equal(result.name,'完整恢复😀.png');assert.equal(result.mime,'image/png');assert.ok(result.bytes>100);assert.equal(result.width,1080);assert.ok(result.height>=1920);
  });

  await test('R14-17 all four actual file formats recover from anchor failure with exact Blob payload and cleanup', async () => {
    await loadMarkdown('# R14-17 原文😀\n\n公式 $x^2$\n\nKEEP WRITER TAIL');
    const result = await evaluateExport(page, `(async () => {
      const blobs = new Map(), revoked = [], outputs = [], oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
      const oldClick = HTMLAnchorElement.prototype.click, oldError = console.error;
      let deny = false, sequence = 0;
      URL.createObjectURL = blob => { const url = 'blob:r14-17-' + ++sequence; blobs.set(url, blob); return url; };
      URL.revokeObjectURL = url => revoked.push(url);
      HTMLAnchorElement.prototype.click = function () { if (deny) throw new Error('R14-17 anchor denied'); outputs.push({name:this.download,url:this.href}); };
      console.error = () => {};
      try {
        filenameInput.value = '共享Writer😀.md';
        await renderExportImagePreview();
        const rows = [];
        for (const [format, command, mime] of [['markdown',exportFile,'text/markdown;charset=utf-8'],['html',exportHTML,'text/html;charset=utf-8'],['word',exportWord,'application/msword;charset=utf-8'],['image',downloadExportImage,'image/png']]) {
          const before = sequence; deny = true; await command();
          const failedClean = outputs.length === rows.length && revoked.includes('blob:r14-17-' + (before+1)) && !document.querySelector('a[download][href^="blob:r14-17-"]');
          deny = false; await command(); const output = outputs.at(-1), blob = blobs.get(output.url);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const decoded = format === 'image' ? applicationCapabilities.markdownEditorImageDataPort.encode(applicationCapabilities.markdownEditorImageExportPort.getPreview().dataUrl) : null;
          const text = format === 'image' ? '' : await blob.text();
          rows.push({format,name:output.name,mime:blob.type,expectedMime:mime,failedClean,revoked:revoked.includes(output.url),bytes:bytes.length,
            complete:format==='image'?decoded.length===bytes.length&&decoded.every((v,i)=>v===bytes[i]):text.includes('KEEP WRITER TAIL')&&text.includes('R14-17 原文'),
            taskReleased:applicationCapabilities.markdownEditorExportTaskPort.getSnapshot().activeTask===null});
        }
        return rows;
      } finally {URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;HTMLAnchorElement.prototype.click=oldClick;console.error=oldError;}
    })()`);
    assert.equal(result.length,4);
    for (const row of result) {assert.equal(row.mime,row.expectedMime);assert.ok(row.bytes>0);for(const key of ['failedClean','revoked','complete','taskReleased'])assert.equal(row[key],true,row.format+':'+key);}
    await writeFile(join(artifactRoot,'r14-17-shared-writer-browser.json'),JSON.stringify(result,null,2));
  });

  await test('R14-18 actual Menu opens the sole image dialog, real controls render/save PNG and return focus without retired globals', async () => {
    await loadMarkdown('# R14-18 UI 原文😀\n\n公式 $x^2$\n\nKEEP UI TAIL');
    const result = await evaluateExport(page, `(async () => {
      const host=applicationCapabilities,commands=host.markdownEditorExportCommandPort,tasks=host.markdownEditorExportTaskPort;
      const root=document.getElementById('export-image-modal'),launcher=document.querySelector('#file-menu-dropdown > .menu-trigger');
      if(!launcher)throw new Error('Real File menu launcher unavailable');launcher.focus();launcher.click();
      document.getElementById('filename').value='菜单点击😀.md';
      const menu=document.querySelector('[data-menu-command="export.image"]');if(!menu)throw new Error('Real Image menu command unavailable');menu.click();
      const wait=async check=>{const deadline=Date.now()+12000;while(!check()){if(Date.now()>deadline)throw new Error('Real image UI did not settle');await new Promise(resolve=>requestAnimationFrame(resolve));}};
      await wait(()=>host.markdownEditorImageExportPort.getPreview()&&tasks.getSnapshot().activeTask===null);
      const locale=host.markdownEditorI18nPort,previousLocale=locale.locale;
      const translated=()=>Array.from(root.querySelectorAll('[data-i18n],[data-i18n-alt]')).every(node=>node.hasAttribute('data-i18n-alt')?node.getAttribute('alt')===locale.t(node.dataset.i18nAlt):node.textContent===locale.t(node.dataset.i18n));
      const translationCount=root.querySelectorAll('[data-i18n],[data-i18n-alt]').length,initialTranslations=translated();let englishTranslations=false,englishBindingRows=[];
      try {locale.setLocale('en');await new Promise(resolve=>requestAnimationFrame(resolve));englishTranslations=translated();englishBindingRows=Array.from(root.querySelectorAll('[data-i18n],[data-i18n-alt]')).map(node=>({key:node.dataset.i18n||node.dataset.i18nAlt,actual:node.hasAttribute('data-i18n-alt')?node.getAttribute('alt'):node.textContent,expected:locale.t(node.dataset.i18n||node.dataset.i18nAlt)}));}
      finally {locale.setLocale(previousLocale);await new Promise(resolve=>requestAnimationFrame(resolve));}
      const iconHrefs=Array.from(root.querySelectorAll('use')).map(node=>node.getAttribute('href'));
      const first=host.markdownEditorImageExportPort.getPreview(),button=root.querySelector('[data-ratio="1:1"]');button.click();
      await wait(()=>host.markdownEditorImageExportPort.getPreview()?.imageOptions.ratio==='1:1'&&tasks.getSnapshot().activeTask===null);
      const crop=document.getElementById('image-crop-fit');crop.checked=true;crop.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>host.markdownEditorImageExportPort.getPreview()?.imageOptions.cropFit===true&&tasks.getSnapshot().activeTask===null);
      const cached=host.markdownEditorImageExportPort.getPreview(),oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=HTMLAnchorElement.prototype.click;
      let blob=null,name='',url='',revoked=false;
      URL.createObjectURL=value=>{blob=value;return 'blob:r14-18-ui';};URL.revokeObjectURL=value=>{if(value==='blob:r14-18-ui')revoked=true;};HTMLAnchorElement.prototype.click=function(){name=this.download;url=this.href;};
      try {root.querySelector('[data-export-action="saveImage"]').click();await wait(()=>blob!==null&&tasks.getSnapshot().activeTask===null);}
      finally {URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;HTMLAnchorElement.prototype.click=oldClick;}
      const bytes=new Uint8Array(await blob.arrayBuffer()),expected=host.markdownEditorImageDataPort.encode(cached.dataUrl);
      root.querySelector('[data-export-action="closeImage"]').click();await new Promise(resolve=>requestAnimationFrame(resolve));
      return {dataUrl:cached.dataUrl,firstRatio:first.imageOptions.ratio,ratio:cached.imageOptions.ratio,crop:cached.imageOptions.cropFit,modalCount:document.querySelectorAll('#export-image-modal').length,
        translationCount,initialTranslations,englishTranslations,englishBindingRows,iconHrefs,commandAvailable:commands.has('openImage'),closed:!root.classList.contains('show'),focusRestored:document.activeElement===launcher,inlineHandlers:root.querySelectorAll('[onclick],[onchange]').length,
        globalsAbsent:['exportFile','exportHTML','exportWord','exportPDF','openExportImageModal','selectImageRatio','downloadExportImage','renderExportImagePreview'].every(key=>typeof window[key]==='undefined'),
        oldScriptAbsent:!document.querySelector('script[src*="/app/export.js"]'),name,mime:blob.type,revoked,exactBytes:expected.length===bytes.length&&expected.every((value,index)=>value===bytes[index]),taskReleased:tasks.getSnapshot().activeTask===null};
    })()`);
    const {dataUrl,...observations}=result;
    // Preserve observations/PNG even when a semantic assertion rejects this scene.
    await writeFile(join(artifactRoot,'r14-18-image-ui.json'),JSON.stringify(observations,null,2));await writeFile(join(artifactRoot,'r14-18-image-ui.png'),Buffer.from(dataUrl.split(',')[1],'base64'));
    assert.equal(result.modalCount,1);assert.equal(result.inlineHandlers,0);assert.equal(result.translationCount,14);assert.deepEqual(result.iconHrefs,['/assets/icons.svg#icon-image','/assets/icons.svg#icon-close']);assert.equal(result.ratio,'1:1');assert.equal(result.crop,true);assert.equal(result.mime,'image/png');assert.equal(result.name,'菜单点击😀.png');
    for(const key of ['initialTranslations','englishTranslations','commandAvailable','closed','focusRestored','globalsAbsent','oldScriptAbsent','revoked','exactBytes','taskReleased'])assert.equal(result[key],true,key);
  });

  await test('R14-03 actual pagehide disposes a locked task, closes progress and removes scoped ports', async () => {
    const result = await evaluateExport(page, `(async () => {
      const host=applicationCapabilities,port=host.markdownEditorExportTaskPort,encoder=host.markdownEditorImageDataPort,imageExporter=host.markdownEditorImageExportPort;
      const progressRoot=document.getElementById('export-progress-modal');
      const builder=host.markdownEditorExportDocumentPort;
      const enhancer=host.markdownEditorExportEnhancementPort;
      const markdown=host.markdownEditorMarkdownExportPort,html=host.markdownEditorHtmlExportPort,word=host.markdownEditorWordExportPort,pdf=host.markdownEditorPdfExportPort;
      const styles=host.markdownEditorExportStylePort,styleRoot=document.createElement('div');document.body.append(styleRoot);styles.apply(styleRoot,'image');
      const layout=host.markdownEditorImageLayoutPort,layoutStage=document.getElementById('export-image-stage'),layoutRoot=document.createElement('div');layoutRoot.className='preview-content';layoutStage.append(layoutRoot);
      const layoutLease=layout.mount({root:layoutRoot,stage:layoutStage,options:host.markdownEditorExportRequestPort.createRequest({format:'image'}).imageOptions});layoutLease.measure();
      const assets=host.markdownEditorImageAssetPort,assetRoot=document.createElement('div'),assetImage=document.createElement('img');
      assetImage.src=assets.placeholder;assetRoot.append(assetImage);document.body.append(assetRoot);let assetLate,assetEntered=false;
      assetImage.decode=()=>{assetEntered=true;return new Promise(resolve=>{assetLate=resolve;});};
      const assetWait=assets.prepare({root:assetRoot}).then(()=>({unexpected:true}),error=>({cancelled:port.isCancelled(error),reason:error.reason}));
      const assetStarted=performance.now();while(!assetEntered){if(performance.now()-assetStarted>5000)throw new Error('Pagehide asset decode not entered');await new Promise(resolve=>setTimeout(resolve,5));}
      const enhancementBody=await builder.build();
      enhancementBody.replaceChildren(...Array.from({length:25},()=>{const node=document.createElement('p');node.textContent='dispose enhancement';return node;}));
      const raf=window.requestAnimationFrame;let interceptedFrames=0;
      window.requestAnimationFrame=()=>{interceptedFrames++;return 999999;};
      const enhancementWait=enhancer.enhance({root:enhancementBody}).then(()=>({unexpected:true}),error=>({cancelled:port.isCancelled(error),reason:error.reason}));
      window.requestAnimationFrame=raf;
      const nativeTimer=window.setTimeout;let pendingPrint,printCount=0;
      window.setTimeout=(callback,delay,...args)=>{if(delay===80){pendingPrint=callback;return -1412;}return nativeTimer(callback,delay,...args);};
      const pdfWork=exportPDF();for(let i=0;i<1000&&!pendingPrint;i++)await new Promise(resolve=>nativeTimer(resolve,5));
      if(!pendingPrint)throw new Error('Pending PDF frame was not prepared before pagehide');
      const pendingFrame=document.querySelector('iframe[data-export-print="pdf"]');pendingFrame.contentWindow.print=()=>{printCount++;};
      await host.markdownEditorPreviewCommandPort.reset();
      const buildWait=builder.build().then(()=>({unexpected:true}),error=>({cancelled:port.isCancelled(error),reason:error.reason}));
      const task=beginExportTask('dispose locked task');task.update(96,'encoding','encoding');task.lockCancellation('encoding');
      const seen=[];port.subscribe(s=>seen.push(s));
      let rejectLate;const operation=new Promise((resolve,reject)=>{rejectLate=reject;});
      const wait=task.token.waitFor(operation).then(()=>({unexpected:true}),error=>({cancelled:port.isCancelled(error),reason:error.reason}));
      window.dispatchEvent(new Event('pagehide'));
      window.setTimeout=nativeTimer;await pdfWork;await pendingPrint();
      let imageRejected=false;try{imageExporter.getPreview();}catch(error){imageRejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      const pureDataUsable=encoder.encode('data:,a')[0]===97;
      const assetResult=await assetWait;const assetBefore=assetImage.src;assetLate();await Promise.resolve();const assetPreserved=assetImage.src===assetBefore;assetRoot.remove();
      const building=await buildWait;const enhancing=await enhancementWait;const waiting=await wait;rejectLate(new Error('late encoder failure'));await Promise.resolve();
      let rejected=false;try {port.begin('late');}catch(error){rejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      let cancelledError=false;try {task.token.throwIfCancelled();}catch(error){cancelledError=port.isCancelled(error);}
      let markdownRejected=false;try {await markdown.export({});}catch(error){markdownRejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      let htmlRejected=false;try {await html.export({});}catch(error){htmlRejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      let wordRejected=false;try {await word.export({});}catch(error){wordRejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      let pdfRejected=false;try {await pdf.export({});}catch(error){pdfRejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      let layoutRejected=false;try {layout.mount({});}catch(error){layoutRejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      let assetRejected=false;try{await assets.prepare({});}catch(error){assetRejected=error.reason==='destroyed'||/destroyed/.test(error.message);}
      return {exportCommandsRemoved:!document.getElementById('compatibility-business-ports'),imageRejected,imageRemoved:!document.getElementById('compatibility-business-ports'),imageNodesRemoved:!document.getElementById('export-image-content')&&!document.getElementById('export-image-preview')&&!document.getElementById('export-image-modal'),pureDataUsable,dataRemoved:!document.getElementById('compatibility-business-ports'),assetResult,assetPreserved,assetRejected,assetRemoved:!document.getElementById('compatibility-business-ports'),layoutRejected,layoutReleased:!layoutRoot.hasAttribute('data-export-image-layout')&&!layoutStage.hasAttribute('data-export-image-layout')&&layoutRoot.style.getPropertyValue('--export-image-width')===''&&!document.getElementById('compatibility-business-ports'),pdfRejected,printCount,printRemoved:!pendingFrame.isConnected&&!document.querySelector('iframe[data-export-print="pdf"]'),snapshot:port.getSnapshot(),lastSeen:seen.at(-1),cancelled:task.cancelled,phase:task.phase,waiting,building,enhancing,interceptedFrames,
        lateUpdate:task.update(100,'late'),lateLock:task.lockCancellation('encoding'),lateFinish:finishExportTask(task),
        stylesRemoved:!document.querySelector('style[data-export-style-sheet="document"]')&&!styleRoot.classList.contains('export-document')&&!styleRoot.hasAttribute('data-export-format'),
        rejected,cancelledError,markdownRejected,htmlRejected,wordRejected,removed:!document.getElementById('compatibility-business-ports'),
        progressVisible:progressRoot.classList.contains('show'),progressRemoved:!document.getElementById('export-progress-modal')};
    })()`);
    await writeFile(join(artifactRoot, 'r14-03-task-disposal.json'), JSON.stringify(result, null, 2));
    assert.equal(result.exportCommandsRemoved,true);assert.equal(result.imageRejected,true);assert.equal(result.imageRemoved,true);assert.equal(result.imageNodesRemoved,true);
    assert.equal(result.pureDataUsable,true);assert.equal(result.dataRemoved,true);
    assert.deepEqual(result.assetResult,{cancelled:true,reason:'destroyed'});assert.equal(result.assetPreserved,true);assert.equal(result.assetRejected,true);assert.equal(result.assetRemoved,true);
    assert.equal(result.printCount,0);
    assert.equal(result.progressRemoved, true);
    assert.equal(result.stylesRemoved, true);
    assert.equal(result.snapshot.destroyed, true); assert.equal(result.snapshot.activeTask, null);
    assert.deepEqual(result.lastSeen, result.snapshot); assert.equal(result.cancelled, true); assert.equal(result.phase, 'destroyed');
    assert.deepEqual(result.waiting, {cancelled:true,reason:'destroyed'});
    assert.deepEqual(result.building, {cancelled:true,reason:'destroyed'});
    assert.deepEqual(result.enhancing, {cancelled:true,reason:'destroyed'});assert.equal(result.interceptedFrames,1);
    for (const field of ['lateUpdate','lateLock','lateFinish','progressVisible']) assert.equal(result[field], false, field);
    for (const field of ['layoutRejected','layoutReleased','pdfRejected','printRemoved','rejected','cancelledError','markdownRejected','htmlRejected','wordRejected','removed']) assert.equal(result[field], true, field);
    await writeFile(join(artifactRoot, 'r14-03-task-disposal.json'), JSON.stringify(result, null, 2));
  });
}
