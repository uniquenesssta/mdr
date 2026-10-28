import assert from 'node:assert/strict';

async function point(page, selector, text, offset) {
  return page.evaluate(`(()=>{const root=Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
    .find(node=>node.textContent.includes(${JSON.stringify(text)}));if(!root)throw Error('Selection row missing');
    let remaining=root.textContent.indexOf(${JSON.stringify(text)})+${offset};
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()){if(remaining<node.length){const range=document.createRange();range.setStart(node,remaining);
      range.setEnd(node,remaining+1);const rect=range.getBoundingClientRect();return {x:rect.left+1,y:rect.top+rect.height/2};}
      remaining-=node.length;}throw Error('Selection boundary missing');})()`);
}

export async function runPreviewSelectionVisibilityCheck(page, app) {
  const source = '# Selection\n\npreview alpha beta gamma\n\nnext paragraph';
  await app.loadMarkdown(source, { layout: 'both', selection: 0 });
  const start = await point(page, '.f-preview-pane p', 'preview alpha beta gamma', 8);
  const end = await point(page, '.f-preview-pane p', 'preview alpha beta gamma', 18);
  await page.drag(start, end, { steps: 16 });
  await app.waitForIdle();
  const result = await page.evaluate(`(()=>{const preview=document.querySelector('.f-preview-pane'),selection=getSelection();
    return {text:selection?.toString(),nativeSelection:preview.contains(selection?.anchorNode)&&preview.contains(selection?.focusNode),
      highlights:CSS.highlights.get('preview-selection-sync')?.size||0,
      background:getComputedStyle(preview,'::selection').backgroundColor};})()`);
  assert.equal((await app.snapshot()).selectedText, 'alpha beta');
  assert.equal(result.text, 'alpha beta');
  assert.equal(result.nativeSelection, true, 'Preview selection must retain its native visible selection after source synchronization');
  assert.notEqual(result.background, 'rgba(0, 0, 0, 0)');
  return result;
}

export async function runHybridSourceDragCheck(page, app) {
  for (const text of ['源码 **粗体** 后续文字', '## 标题 **粗体** 后续文字', '> 引用 **粗体** 后续文字']) {
    const source = 'before\n\n' + text + '\n\nafter';
    await app.loadMarkdown(source, { layout: 'hybrid', selection: 0 });
    const word = text.includes('源码') ? '源码' : text.includes('标题') ? '标题' : '引用';
    const caret = await point(page, '#editor .cm-line', word, 0);
    await page.clickAt(caret.x, caret.y);
    await app.waitForIdle();
    const start = await point(page, '#editor .cm-line', text, text.indexOf('**'));
    const end = await point(page, '#editor .cm-line', text, text.lastIndexOf('**') + 2);
    await page.drag(start, end, { steps: 16 });
    await app.waitForIdle();
    const rendered = await page.evaluate(`Array.from(document.querySelectorAll('#editor .cm-line')).some(row=>row.textContent===${JSON.stringify(text)})`);
    assert.equal(rendered, true, 'An activated source row must not hide its Markdown markers when dragging a selection');
    assert.equal((await app.snapshot()).selectedText, '**粗体**');
    assert.equal(await app.getEditorValue(), source);
  }
  return { sourceRows: 3 };
}

export function createLargeSelectionFixture() {
  return '# Large selection regression\n\nscroll origin selection\n\n'
    + Array.from({ length: 6500 }, (_, i) => (i % 1000 === 0 ? `## Section ${i}\n\n` : '')
      + `paragraph ${i} ` + '大文档滚动同步与选区稳定性。'.repeat(14) + '\n\n').join('');
}

export async function runLargeSelectionScrollCheck(page, app, source = createLargeSelectionFixture()) {
  await app.loadMarkdown(source, { layout: 'both', selection: 0, timeoutMs: 30000 });
  const start = await point(page, '#editor .cm-line', 'scroll origin selection', 7);
  const end = await point(page, '#editor .cm-line', 'scroll origin selection', 13);
  await page.drag(start, end, { steps: 12 });
  await app.waitForIdle();
  const immediate = await page.evaluate(`(()=>{const r=document.querySelector('#editor .cm-scroller').getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2,previewTop:document.querySelector('.f-preview-surface').scrollTop};})()`);
  await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: immediate.x, y: immediate.y, deltaX: 0, deltaY: 1800 });
  await page.evaluate('new Promise(resolve=>{let frames=6;const tick=()=>--frames?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick);})');
  const immediatePreviewTop = await page.evaluate("document.querySelector('.f-preview-surface').scrollTop");
  assert.ok(immediatePreviewTop > immediate.previewTop + 200, 'A fresh Editor wheel must override the earlier selection alignment within six frames');
  const before = await page.evaluate(`(()=>{const root=document.querySelector('.f-preview-surface');return {top:root.scrollTop,
    rect:(()=>{const r=root.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()};})()`);
  for (let i = 0; i < 6; i += 1) {
    await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: before.rect.x, y: before.rect.y,
      deltaX: 0, deltaY: 1300 });
    await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  const frames = await page.evaluate(`new Promise(resolve=>{const frames=[];let remaining=30;
    const sample=()=>{const root=document.querySelector('.f-preview-surface'),rect=root.getBoundingClientRect();
      const visible=Array.from(root.querySelectorAll('.preview-virtual-block')).filter(node=>{const r=node.getBoundingClientRect();return r.bottom>rect.top&&r.top<rect.bottom});
      frames.push({top:root.scrollTop,visible:visible.length,lines:visible.map(node=>Number(node.dataset.sourceLine))});
      if(--remaining)requestAnimationFrame(sample);else resolve(frames);};requestAnimationFrame(sample);})`);
  assert.ok(frames.at(-1).top > before.top + 1000, 'Preview must keep following the current wheel gesture');
  assert.ok(frames.every(frame => frame.visible > 0), JSON.stringify(frames));
  assert.ok(Math.min(...frames.at(-1).lines) > 3, 'An old editor selection must not remount the document beginning over the scrolled viewport');
  const editorWheel = await page.evaluate(`(()=>{const r=document.querySelector('#editor .cm-scroller').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const previewBeforeReverse = frames.at(-1).top;
  for (let i = 0; i < 4; i += 1) {
    await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...editorWheel, deltaX: 0, deltaY: -900 });
    await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  }
  await app.waitForIdle();
  const previewAfterReverse = await page.evaluate("document.querySelector('.f-preview-surface').scrollTop");
  assert.ok(previewAfterReverse < previewBeforeReverse - 300, 'Switching the wheel to Editor must immediately resume the reverse synchronization');
  assert.equal(await app.getEditorValue(), source);
  return { characters: source.length, frames, immediatePreviewTop, previewAfterReverse };
}

export async function runCrossChapterSelectionCheck(page, app,
  source = createLargeSelectionFixture().replace('# Large selection regression', '## Large selection regression').slice(0, 1020000), requestedLines = null) {
  const normalized = source.replace(/\r\n?/g, '\n'), lines = normalized.split('\n');
  const offsets = []; let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const targets = requestedLines || [0.25, 0.6, 0.9].map(fraction => Math.floor(lines.length * fraction));
  let seed = lines.findIndex((line, index) => index > 0 && /^#{1,6} /.test(line)) + 1;
  while (seed < lines.length && (!lines[seed].trim() || lines[seed].startsWith('#'))) seed += 1;
  assert.ok(seed < lines.length, 'fixture needs an initial child chapter');
  if (await app.getEditorValue() !== normalized) {
    await app.loadMarkdown(normalized, { layout: 'both', selection: 0, timeoutMs: 30000 });
  } else await app.setLayout('both');
  const measurements = [];
  const geometry = `(()=>{const editor=document.querySelector('#editor .cm-scroller'),preview=document.querySelector('.f-preview-surface');
    const selection=getSelection(),ranges=Array.from(CSS.highlights.get('preview-selection-sync')||[]);
    if(!selection?.rangeCount||!editor.contains(selection.anchorNode)||!ranges.length)return null;
    const source=selection.getRangeAt(0).getBoundingClientRect(),target=ranges[0].getBoundingClientRect();
    const sourceRatio=((source.top+source.bottom)/2-editor.getBoundingClientRect().top)/editor.clientHeight;
    const targetRatio=((target.top+target.bottom)/2-preview.getBoundingClientRect().top)/preview.clientHeight;
    const viewport=preview.getBoundingClientRect();
    return {sourceRatio,targetRatio,visibilityErrorPx:Math.max(0,viewport.top-target.top,target.bottom-viewport.bottom),previewTop:preview.scrollTop,selectionLength:selection.toString().length,
      highlightedLength:ranges.reduce((length,range)=>length+range.toString().length,0)};})()`;
  for (let line of targets) {
    while (line < lines.length && (!lines[line].trim() || lines[line].startsWith('#') || lines[line].length < 16)) line += 1;
    assert.ok(line < lines.length);
    await app.revealPosition(offsets[seed], { quietMs: 220 });
    await app.revealPosition(offsets[line], { preserveSelection: true });
    const scope = await app.getPreviewStats();
    assert.ok(line + 1 < scope.scopeStartLine || line + 1 > scope.scopeEndLine,
      'fixture must exercise a first selection outside the mounted chapter: ' + JSON.stringify({ seed: seed + 1, target: line + 1, scope }));
    const start = await point(page, '#editor .cm-line', lines[line], 0);
    const end = await point(page, '#editor .cm-line', lines[line], 12);
    const started = Date.now();
    await page.drag(start, end, { steps: 6, stepDelayMs: 3 });
    // No follow-up click or selection API is allowed between this drag and the
    // geometry assertion: it must complete the original navigation by itself.
    try {
      await page.evaluate(`new Promise((resolve,reject)=>{let stable=0;const started=performance.now();
        let previous=null;const sample=()=>{const value=${geometry};stable=value?.selectionLength===12&&value.highlightedLength===12&&value.visibilityErrorPx<=1&&previous!==null&&Math.abs(value.previewTop-previous)<=1?stable+1:0;previous=value?.previewTop??null;
          if(stable>=8)resolve(true);else if(performance.now()-started>5000)reject(Error('Timed out waiting for a visible and stable first cross-chapter word selection'));
          else requestAnimationFrame(sample);};requestAnimationFrame(sample);})`);
    } catch (error) {
      throw new Error(error.message + ': ' + JSON.stringify({ line: line + 1, geometry: await page.evaluate(geometry),
        snapshot: await app.snapshot(), preview: await app.getPreviewStats() }));
    }
    const alignedMs = Date.now() - started;
    assert.equal((await app.snapshot()).selectedText, lines[line].slice(0, 12));
    const samples = [];
    for (let i = 0; i < 12; i += 1) {
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
      samples.push(await page.evaluate(geometry));
    }
    assert.ok(samples.every(sample => sample?.visibilityErrorPx <= 1), JSON.stringify(samples));
    const driftPx=Math.max(...samples.map(sample=>sample.previewTop))-Math.min(...samples.map(sample=>sample.previewTop));
    assert.ok(driftPx<=1,'A completed chapter reveal must not keep moving: '+JSON.stringify(samples));
    measurements.push({ line: line + 1, visibleMs:alignedMs, maxVisibilityErrorPx:Math.max(...samples.map(sample=>sample.visibilityErrorPx)),driftPx });
  }
  assert.equal(await app.getEditorValue(), normalized);
  return { characters: normalized.length, measurements };
}
