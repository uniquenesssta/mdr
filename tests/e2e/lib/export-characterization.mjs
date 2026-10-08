// Exercise the actual built application and locked renderers. Capture file/print
// boundaries only; detached exported HTML is never executed or loaded from a CDN.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function runExportCharacterization({ page, test, loadMarkdown, artifactRoot }) {
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/stage-14-export/contracts.json', import.meta.url), 'utf8'));

  await test('R14-01 built app preserves Markdown bytes and records the actual HTML/Word missing-preview dependency', async () => {
    await loadMarkdown(fixture.source);
    const result = await page.evaluate(`(async () => {
      const names = ${JSON.stringify(fixture.names)};
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
              if(captures.length !== start)throw new Error('Unexpected repaired output: update R14-F04 with a new verified mapping');
              failures.push({format,input:row.input,error:errors.at(-1),progressVisible:document.getElementById('export-progress-modal').classList.contains('show')});
              continue;
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
    assert.equal(result.captures.length, fixture.names.length);
    for (const capture of result.captures) {
      const row = fixture.names.find(x => x.input === capture.input);
      assert.equal(capture.name, row.markdown);
      assert.equal(capture.revoked, true);
      assert.equal(capture.content, fixture.source);
      assert.equal(capture.mime, 'text/markdown;charset=utf-8');
    }
    assert.equal(result.failures.length, fixture.names.length * 2);
    for (const failure of result.failures) {
      assert.match(failure.error, /previewWorkerClient is not defined/);
      assert.equal(failure.progressVisible, false);
    }
    await writeFile(join(artifactRoot, 'r14-01-text-exports.json'), JSON.stringify(result, null, 2));
  });

  await test('R14-01 actual long-document export records the missing dependency without accepting partial output', async () => {
    const count = fixture.longDocument.blocks;
    const source = '# Large export\n\n' + Array.from({ length: count }, (_, i) => `R14-block-${i} ` + 'x'.repeat(3000)).join('\n\n');
    assert.ok(source.length >= fixture.longDocument.largeCharacters);
    await loadMarkdown(source);
    const result = await page.evaluate(`(async () => {
      const task = beginExportTask('R14 long-document baseline');
      try {
        const root = await createFullPreviewBodyForExport(task);
        return {unexpectedOutput:root.textContent};
      } catch(error) {return {name:error.name,message:error.message};}
      finally { finishExportTask(task); }
    })()`);
    assert.deepEqual(result, {name:'ReferenceError',message:'previewWorkerClient is not defined'});
    await writeFile(join(artifactRoot, 'r14-01-long-document.json'), JSON.stringify({ ...result, sourceCharacters:source.length, expectedParagraphs:count, finding:'R14-F04' }, null, 2));
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
    assert.equal(result.errors.filter(x=>x.includes('previewWorkerClient is not defined')).length, 2);
    assert.equal(result.image, result.oldImage);
    assert.equal(result.after, result.before);
    assert.equal(result.progressVisible, false);
    await writeFile(join(artifactRoot, 'r14-01-pdf-image-failure.json'), JSON.stringify({ ...result, finding:'R14-F04' }, null, 2));
  });
}
