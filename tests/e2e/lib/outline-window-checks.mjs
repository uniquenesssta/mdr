import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateApplication } from './application-inspector.mjs';

/** Real Windows scroll, keyboard and navigation checks against the complete heading index. */
export async function runOutlineWindowChecks({ page, app, artifacts }) {
  const headings = await evaluateApplication(page, 'applicationCapabilities.markdownEditorOutlineControllerPort.snapshot.headings.map(({id,line})=>({id,line}))');
  assert.ok(headings.length > 3000);
  const last = headings.at(-1);
  const panel = await page.elementRect('#sidebar-outline-panel');
  await page.connection.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:panel.x+panel.width/2,y:panel.y+panel.height/2,deltaX:0,deltaY:200000});
  await page.waitFor(`Boolean(document.querySelector('#outline-list [data-outline-id="${last.id}"]'))`);
  assert.ok(await page.evaluate("document.querySelectorAll('#outline-list .outline-row').length<80"));
  await page.click(`#outline-list [data-outline-action="navigate"][data-outline-id="${last.id}"]`);
  await app.waitForIdle();
  assert.equal(await evaluateApplication(page,'editorApi.getLineNumberAtPosition(editorApi.getSelection().start)'),last.line);
  await page.connection.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:panel.x+panel.width/2,y:panel.y+panel.height/2,deltaX:0,deltaY:-200000});
  await page.waitFor(`Boolean(document.querySelector('#outline-list [data-outline-id="${headings[0].id}"]'))`);
  const toggle = await page.evaluate("(()=>{const e=document.querySelector('#outline-list [data-outline-action=toggle]');return e?e.dataset.outlineId:null;})()");
  assert.ok(toggle);
  const toggleSelector=`#outline-list [data-outline-action="toggle"][data-outline-id="${toggle}"]`;
  const expanded=()=>page.evaluate(`document.querySelector(${JSON.stringify(toggleSelector)}).getAttribute('aria-expanded')`);
  // Earlier scenarios exercise persisted collapse state; verify the transition from that actual state.
  const initiallyExpanded=await expanded();
  assert.ok(['true','false'].includes(initiallyExpanded));
  await page.click(toggleSelector);
  assert.equal(await expanded(),initiallyExpanded==='true'?'false':'true');
  assert.equal(await evaluateApplication(page,'applicationCapabilities.markdownEditorOutlineControllerPort.snapshot.headings.length'),headings.length);
  await page.click(toggleSelector);
  assert.equal(await expanded(),initiallyExpanded);
  const start = await page.evaluate("(()=>{const links=[...document.querySelectorAll('#outline-list [data-outline-action=navigate]')];const e=links.at(-1);e.focus();return e.dataset.outlineId;})()");
  const next = headings[headings.findIndex(h=>h.id===start)+1];assert.ok(next);
  await page.pressKey('Tab');
  assert.equal(await page.evaluate('document.activeElement.dataset.outlineId'),next.id);
  await page.pressKey('Tab',{modifiers:8});
  assert.equal(await page.evaluate('document.activeElement.dataset.outlineId'),start);
  await writeFile(join(artifacts,'outline-window.json'),JSON.stringify({passed:true,completeHeadings:headings.length,lastHeadingNavigable:true,collapsePreservesIndex:true,tabAcrossWindowBoundary:true,reverseTab:true},null,2));
}
