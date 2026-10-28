import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { evaluateApplication } from './application-inspector.mjs';

export const diagramSelectionSample = '# 图表选区\n\n前面的普通文字。\n\n```mermaid\nflowchart LR\n A[打开 Markdown] --> B{选择视图}\n B --> C[双栏同步]\n```\n\n后面的普通文字。';

export async function runDiagramSelectionChecks({ page, app, artifacts, source = diagramSelectionSample }) {
  const checks = [];
  await app.loadMarkdown(source, { layout: 'both', selection: 0 }); await app.waitForIdle();
  await page.waitFor(() => Boolean(document.querySelector('#preview .mermaid svg')), { timeoutMs: 20000 });
  const from = source.indexOf('flowchart LR'); assert.ok(from >= 0);
  await app.revealPosition(from);
  const line = await page.evaluate(`(()=>{const el=[...document.querySelectorAll('#editor .cm-line')].find(n=>n.textContent.includes('flowchart LR'));if(!el)throw Error('Source line not mounted');const r=el.getBoundingClientRect();return {x:r.left+40,y:(r.top+r.bottom)/2};})()`);
  await page.clickAt(line.x, line.y); await page.pressKey('Home', { code: 'Home' });
  await page.pressKey('End', { modifiers: 8, code: 'End' });
  await writeFile(join(artifacts, 'mapping-debug.json'), JSON.stringify(await evaluateApplication(page, `({selection:editorApi.getSelection(),anchors:selectionSync.getPreviewMapper().getAnchors().filter(a=>Number(a.dataset.sourceStartIndex)<=${from}&&Number(a.dataset.sourceEndIndex)>${from}).map(a=>({data:{...a.dataset},connected:a.isConnected,classes:a.className})),model:documentModel.sliceText(${from}-11,${from}+12)})`), null, 2));
  await page.waitFor(() => Boolean(document.querySelector('#preview .mermaid.preview-atomic-selection-highlight')), { timeoutMs: 3000 });
  const forward = await evaluateApplication(page, "selectionSync.runEditor(false, 'editor-pointerup', true, 0)");
  assert.equal(forward.status, 'mapped'); assert.equal(forward.mappingMode, 'source-component'); assert.equal(forward.exactMapping, false);
  checks.push('Mermaid source syntax maps to the complete rendered diagram');
  const range = await page.evaluate(`(()=>{const el=document.querySelector('#preview .mermaid.preview-atomic-selection-highlight');return {from:Number(el.dataset.sourceStartIndex),to:Number(el.dataset.sourceEndIndex)};})()`);
  assert.equal(source.slice(range.from, range.to).trimStart().startsWith('```mermaid'), true);
  const points = await page.evaluate(`(()=>{const root=document.querySelector('#preview .mermaid');root.scrollIntoView({block:'center'});const labels=[...root.querySelectorAll('.nodeLabel')];const label=labels.find(el=>el.textContent.includes('打开 Markdown'));if(!label)throw Error('Rendered node label missing');const walk=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);let node;while((node=walk.nextNode()))if(node.nodeValue.includes('打开 Markdown'))break;const a=document.createRange(),b=document.createRange();a.setStart(node,0);a.setEnd(node,1);b.setStart(node,5);b.setEnd(node,6);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {start:{x:x.left+1,y:(x.top+x.bottom)/2},end:{x:y.right-1,y:(y.top+y.bottom)/2}};})()`);
  await page.drag(points.start, points.end, { steps: 10 });
  await page.waitFor(`getSelection().toString().length>0`);
  let selected;
  for (let attempt = 0; attempt < 50; attempt++) {
    selected = await evaluateApplication(page, 'editorApi.getSelection()');
    if (selected.start === range.from && selected.end === range.to) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.deepEqual({ from: selected.start, to: selected.end }, range, 'SVG label selection corresponds to the complete source fence');
  assert.ok(await page.evaluate("getSelection().toString().length>0"));
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.format-group')).display"), 'none');
  checks.push('SVG labels retain native selection while locating their complete source component');
  checks.push('rendered diagrams never show the formatting toolbar');
  const result = await evaluateApplication(page, "selectionSync.runPreview('preview-pointerup', true)");
  assert.equal(result.mappingMode, 'component-source'); assert.equal(result.exactMapping, false);
  checks.push('diagnostics distinguish whole-component correspondence from exact character mapping');
  await app.setLayout('preview'); await app.waitForIdle();
  // In pure reading the diagram moves horizontally; select its label using the new geometry.
  const current = await page.evaluate(`(()=>{const label=[...document.querySelectorAll('#preview .mermaid .nodeLabel')].find(e=>e.textContent.includes('打开 Markdown'));label.scrollIntoView({block:'center'});const r=label.getBoundingClientRect();return {start:{x:r.left+2,y:(r.top+r.bottom)/2},end:{x:r.right-2,y:(r.top+r.bottom)/2}};})()`);
  await page.drag(current.start, current.end, { steps: 10 });
  await page.waitFor(() => getSelection().toString().length > 0 && getComputedStyle(document.querySelector('.format-group')).display === 'none');
  assert.equal((await evaluateApplication(page, "selectionSync.runPreview('preview-pointerup', true)")).mappingMode, 'component-source');
  checks.push('pure reading retains graph label selection and component correspondence without formatting controls');
  assert.equal(await app.getEditorValue(), source);
  await page.screenshot(join(artifacts, 'diagram-selection.png'));
  return checks;
}
