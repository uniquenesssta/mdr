// Exercise the actual built application and locked renderers. Capture file/print
// boundaries only; detached exported HTML is never executed or loaded from a CDN.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function runExportCharacterization({ page, test, loadMarkdown, artifactRoot }) {
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/stage-14-export/contracts.json', import.meta.url), 'utf8'));
  const requests = JSON.parse(await readFile(new URL('../../fixtures/stage-14-export/requests.json', import.meta.url), 'utf8'));

  await test('R14-02 built app normalizes Markdown names and retains R14-01 bytes and HTML/Word missing-preview evidence', async () => {
    await loadMarkdown(fixture.source);
    const result = await page.evaluate(`(async () => {
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
            if(captures.length !== start+1) throw new Error('Expected one actual '+format+' download: '+row.input);
            const capture = captures.at(-1), content = await capture.blob.text();
            capture.format = format; capture.input = row.input; capture.content = content; capture.mime = capture.blob.type;
            capture.revoked = revoked.includes(capture.url);

          }
        }
        return {captures:captures.map(({blob,url,...capture})=>capture),failures};
      } finally {
        URL.createObjectURL=create; URL.revokeObjectURL=revoke; HTMLAnchorElement.prototype.click=click;
        input.value=originalName;console.error=error;
      }
    })()`);
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
        assert.ok(capture.content.includes('$x^2$'));
        assert.ok(capture.content.includes('flowchart TD'));
        assert.equal(capture.content.includes('f-mermaid-svg'), false);
        if (capture.format === 'html') {
          assert.ok(capture.content.includes('https://cdn.jsdelivr.net/npm/katex@0.16.9/'));
          assert.ok(capture.content.includes('exportPresentationPort.math?.renderTree'));
        }
      }
    }
    assert.equal(result.failures.length, fixture.names.length * 2);
    for (const failure of result.failures) {
      assert.equal(failure.error, null, 'R14-06 repairs the builder; original defect fixture stays immutable.');
      assert.equal(failure.progressVisible, false);
    }
    await writeFile(join(artifactRoot, 'r14-02-text-exports.json'), JSON.stringify(result, null, 2));
  });

  await test('R14-02 actual request rejects bad inputs before any export task and remains scoped and immutable', async () => {
    await loadMarkdown(fixture.source);
    const result = await page.evaluate(`(async () => {
      const host=document.getElementById('compatibility-business-ports'),port=host.markdownEditorExportRequestPort;
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
    const result = await page.evaluate(`(async () => {
      const host=document.getElementById('compatibility-business-ports');
      await host.markdownEditorPreviewCommandPort.update();
      const task = beginExportTask('R14 long-document public builder');
      const records=[],progress=[],model=window.markdownEditorDocumentModel,snapshot=model.createSnapshot;
      const descriptor=Object.getOwnPropertyDescriptor(model,'createSnapshot');
      Object.defineProperty(model,'createSnapshot',{configurable:true,writable:true,value:function(reason){records.push(reason);return snapshot.call(this,reason);}});
      const unsubscribe=host.markdownEditorExportTaskPort.subscribe(value=>{if(value.activeTask?.phase==='building')progress.push(value.activeTask.message);});
      try {
        const root=await host.markdownEditorExportDocumentPort.build({task});
        return {paragraphs:Array.from(root.querySelectorAll('p')).map(x=>x.textContent.match(/^R14-block-(\\d+)/)?.[1]).filter(Boolean).map(Number),
          heading:root.querySelector('h1')?.textContent,records,progress,
          detached:!root.isConnected,retired:typeof previewWorkerClient==='undefined'&&typeof createPreviewNodesForBlock==='undefined',snapshotObserved:typeof snapshot==='function'};
      } finally {unsubscribe();if(descriptor)Object.defineProperty(model,'createSnapshot',descriptor);else delete model.createSnapshot;finishExportTask(task);}
    })()`);
    assert.deepEqual(result.paragraphs, Array.from({length:count},(_,i)=>i));
    assert.equal(result.heading, 'Large export');assert.equal(result.detached, true);assert.equal(result.retired, true);assert.equal(result.snapshotObserved,true);
    assert.equal(result.records.includes('full-preview-export'), false, 'Synchronized Worker path cannot snapshot the whole document.');
    const batches=result.progress.filter(x=>x.includes(' 块')).map(x=>Number(x.match(/ (\d+)\//)[1]));
    assert.equal(batches[0],48);assert.equal(batches[1],96);assert.ok(batches.at(-1)>=count);
    await writeFile(join(artifactRoot, 'r14-01-long-document.json'), JSON.stringify({ ...result, sourceCharacters:source.length, expectedParagraphs:count, mapping:'R14-06 public builder; original R14-F04 fixture preserved' }, null, 2));
  });

  await test('R14-06 actual long-document cancellation stops public body construction and next build remains usable', async () => {
    const result=await page.evaluate(`(async()=>{
      const host=document.getElementById('compatibility-business-ports'),port=host.markdownEditorExportTaskPort;
      const task=port.begin('cancel long builder');let batches=0;
      const dispose=port.subscribe(s=>{if(s.activeTask?.id===task.id&&s.activeTask.message.includes(' 块')&&!s.activeTask.cancelled){batches++;port.cancel();}});
      let error;
      try{await host.markdownEditorExportDocumentPort.build({task});throw new Error('Cancelled build returned a body');}
      catch(e){error={cancelled:port.isCancelled(e),reason:e.reason};}
      finally{dispose();port.finish(task);}
      const next=await host.markdownEditorExportDocumentPort.build();
      return {error,batches,released:port.getSnapshot().activeTask===null,paragraphs:next.querySelectorAll('p').length,detached:!next.isConnected};
    })()`);
    assert.deepEqual(result.error,{cancelled:true,reason:'cancelled'});assert.equal(result.batches,1);
    assert.equal(result.released,true);assert.equal(result.detached,true);assert.equal(result.paragraphs,fixture.longDocument.blocks);
    await writeFile(join(artifactRoot,'r14-06-builder-cancellation.json'),JSON.stringify(result,null,2));
  });

  await test('R14-01 locked offline renderer produces real math/Mermaid DOM and a decodable PNG independent of the broken exporter', async () => {
    await loadMarkdown(fixture.source);
    const result = await page.evaluate(`(async () => {
      const presentation=document.getElementById('compatibility-business-ports').markdownEditorPresentationPort;
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

  await test('R14-01 actual PDF/Image fail before print or file creation and release the progress dialog', async () => {
    await loadMarkdown(fixture.source);
    const result = await page.evaluate(`(async () => {
      const print=window.print,error=console.error;
      const port=document.getElementById('compatibility-business-ports').markdownEditorPreviewCommandPort;
      const before=port.getViewMode(), oldImage=document.getElementById('export-image-preview').getAttribute('src');
      let prints=0;const errors=[];
      window.print=()=>{prints++;};
      console.error=(...args)=>{errors.push(args.map(x=>String(x)).join(' '));error.apply(console,args);};
      try {
        await exportPDF();await renderExportImagePreview();
        await new Promise(resolve=>setTimeout(resolve,100));
        return {prints,errors,before,after:port.getViewMode(),oldImage,image:document.getElementById('export-image-preview').getAttribute('src'),progressVisible:document.getElementById('export-progress-modal').classList.contains('show')};
      } finally {window.print=print;console.error=error;}
    })()`);
    assert.equal(result.prints, 0);
    assert.equal(result.errors.filter(x=>/styleTaskLists is not defined|observedPreviewBody is not defined/.test(x)).length, 2);
    assert.equal(result.image, result.oldImage);
    assert.equal(result.after, result.before);
    assert.equal(result.progressVisible, false);
    await writeFile(join(artifactRoot, 'r14-01-pdf-image-failure.json'), JSON.stringify({ ...result, finding:'R14-F04' }, null, 2));
  });

  await test('R14-04 irreversible lock retains R14-03 actual replacement, progress and cancel button coverage', async () => {
    const result = await page.evaluate(`(() => {
      const host=document.getElementById('compatibility-business-ports'),port=host.markdownEditorExportTaskPort;
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
    assert.equal(await page.evaluate(`document.getElementById('export-progress-modal').classList.contains('show')`), false);
    await writeFile(join(artifactRoot, 'r14-03-task-controller.json'), JSON.stringify(result, null, 2));
  });

  await test('R14-04 actual cancel button terminates a token wait and rejects late publication', async () => {
    const result = await page.evaluate(`(async () => {
      const port=document.getElementById('compatibility-business-ports').markdownEditorExportTaskPort;
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
    const result = await page.evaluate(`(async () => {
      const port=document.getElementById('compatibility-business-ports').markdownEditorExportTaskPort;
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

  // Final app probe: exercise the production pagehide owner after all other export probes.
  await test('R14-03 actual pagehide disposes a locked task, closes progress and removes scoped ports', async () => {
    const result = await page.evaluate(`(async () => {
      const host=document.getElementById('compatibility-business-ports'),port=host.markdownEditorExportTaskPort;
      const progressRoot=document.getElementById('export-progress-modal');
      const builder=host.markdownEditorExportDocumentPort;
      await host.markdownEditorPreviewCommandPort.reset();
      const buildWait=builder.build().then(()=>({unexpected:true}),error=>({cancelled:port.isCancelled(error),reason:error.reason}));
      const task=beginExportTask('dispose locked task');task.update(96,'encoding','encoding');task.lockCancellation('encoding');
      const seen=[];port.subscribe(s=>seen.push(s));
      let rejectLate;const operation=new Promise((resolve,reject)=>{rejectLate=reject;});
      const wait=task.token.waitFor(operation).then(()=>({unexpected:true}),error=>({cancelled:port.isCancelled(error),reason:error.reason}));
      window.dispatchEvent(new Event('pagehide'));
      const building=await buildWait;const waiting=await wait;rejectLate(new Error('late encoder failure'));await Promise.resolve();
      let rejected=false;try {port.begin('late');}catch(error){rejected=/destroyed/.test(error.message);}
      let cancelledError=false;try {task.token.throwIfCancelled();}catch(error){cancelledError=port.isCancelled(error);}
      return {snapshot:port.getSnapshot(),lastSeen:seen.at(-1),cancelled:task.cancelled,phase:task.phase,waiting,building,
        lateUpdate:task.update(100,'late'),lateLock:task.lockCancellation('encoding'),lateFinish:finishExportTask(task),
        rejected,cancelledError,removed:!Object.hasOwn(host,'markdownEditorExportTaskPort')&&!Object.hasOwn(host,'markdownEditorExportRequestPort')&&!Object.hasOwn(host,'markdownEditorExportDocumentPort'),
        progressVisible:progressRoot.classList.contains('show'),progressRemoved:!document.getElementById('export-progress-modal')};
    })()`);
    assert.equal(result.progressRemoved, true);
    assert.equal(result.snapshot.destroyed, true); assert.equal(result.snapshot.activeTask, null);
    assert.deepEqual(result.lastSeen, result.snapshot); assert.equal(result.cancelled, true); assert.equal(result.phase, 'destroyed');
    assert.deepEqual(result.waiting, {cancelled:true,reason:'destroyed'});
    assert.deepEqual(result.building, {cancelled:true,reason:'destroyed'});
    for (const field of ['lateUpdate','lateLock','lateFinish','progressVisible']) assert.equal(result[field], false, field);
    for (const field of ['rejected','cancelledError','removed']) assert.equal(result[field], true, field);
    await writeFile(join(artifactRoot, 'r14-03-task-disposal.json'), JSON.stringify(result, null, 2));
  });
}
