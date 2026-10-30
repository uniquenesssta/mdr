// Verify the actual Windows/WebView2 frame using a separately identified test binary.
// User app profiles and document namespaces must never be used by this runner.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { CdpConnection, CdpPage } from '../lib/cdp-browser.mjs';
import { createApplicationDriver } from '../lib/application-driver.mjs';
import { runPreviewSelectionChecks } from '../lib/preview-selection-checks.mjs';
import { runSelectionRevealChecks } from '../lib/selection-reveal-checks.mjs';
import { runCrossChapterSelectionCheck } from '../lib/selection-stability-checks.mjs';
import { runMinimalHeaderChecks, inspectMinimalHeader } from '../lib/minimal-header-checks.mjs';
import { runDiagramSelectionChecks } from '../lib/diagram-selection-checks.mjs';
import { runSidebarResizeSelectionChecks } from '../lib/sidebar-resize-selection-checks.mjs';
import { runLargeDocumentInteractionChecks } from '../lib/large-document-interaction-checks.mjs';
import { runOutlineWindowChecks } from '../lib/outline-window-checks.mjs';
import { runSelectionContinuationChecks } from '../lib/selection-continuation-checks.mjs';

const binary = resolve(process.argv[2]);
const artifacts = resolve(process.argv[3]);
const expected = process.argv.includes('--refined');
assert.equal(process.platform, 'win32');
assert.ok((await readFile(binary)).includes(Buffer.from('com.markdowneditor.ui-frame-check')), 'Use the separately identified test binary.');
await mkdir(artifacts, { recursive: true });
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const processHandle = spawn(binary, [], { windowsHide: true, stdio: ['ignore','pipe','pipe'],
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(artifacts,'webview-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`, MARKDOWN_EDITOR_LOG_DIR: join(artifacts,'logs') } });
let stderr = '';
processHandle.stderr.on('data', value => { stderr += value; });
let connection, page;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const geometry = (reveal, capture=true, size=null) => JSON.parse(execFileSync('pwsh.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File',
  resolve('tests/e2e/windows/native-frame-geometry.ps1'), '-AppProcessId', String(processHandle.pid),
  ...(reveal ? ['-Reveal'] : []), ...(size?.burst ? ['-ResizeBurst'] : size ? ['-WindowWidth',String(size.width),'-WindowHeight',String(size.height)] : []), ...(capture ? ['-ScreenshotPath', join(artifacts, reveal ? 'native-window.png' : 'native-window-final.png')] : [])],
  { windowsHide: true, encoding: 'utf8', timeout: 20000 }).trim());
try {
  let target;
  for (let attempt=0; attempt<100; attempt++) {
    if (processHandle.exitCode !== null) throw new Error('Owned test application exited: '+stderr);
    try { target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(x=>x.type==='page'); } catch {}
    if (target?.webSocketDebuggerUrl && target.url && target.url !== 'about:blank') { await pause(1500);break; }
    await pause(100);
  }
  assert.ok(target?.webSocketDebuggerUrl, 'WebView2 debug target available');
  await writeFile(join(artifacts,'native-target.json'),JSON.stringify(target,null,2));
  connection = await new CdpConnection(target.webSocketDebuggerUrl).open();
  page = await new CdpPage(connection).initialize();
  await page.addInitScript("localStorage.setItem('md_editor_help_shown','true');");
  const frame = geometry(true);
  const appOrigin = process.argv.includes('--packaged') ? await page.evaluate('location.origin')
    : (process.argv.find(arg=>arg.startsWith('--url='))?.slice(6)||'http://127.0.0.1:16663');
  await page.navigate(appOrigin+'/?e2e=1');
  await page.waitFor(()=>document.documentElement.classList.contains('app-ready'), { timeoutMs:20000 });
  if(process.argv.includes('--selection-continuation')) {
    const sourcePath=process.argv.find(arg=>arg.startsWith('--resize-source='))?.slice(16);
    assert.ok(sourcePath,'Provide the original read-only large-document path.');
    await runSelectionContinuationChecks({page,app:createApplicationDriver(page),artifacts,source:await readFile(sourcePath,'utf8'),
      resizeBurst:async()=>{geometry(false,false,{burst:true});await page.waitFor('innerWidth===1120&&innerHeight===910');},
      resizeViewport:async size=>{geometry(false,false,size);await page.waitFor(`innerWidth===${size.width}&&innerHeight===${size.height}`);}});
  }
  if (process.argv.includes('--large-document-interactions')) {
    const sourcePath=process.argv.find(arg=>arg.startsWith('--resize-source='))?.slice(16);
    assert.ok(sourcePath,'Provide the original read-only large-document path.');
    await runLargeDocumentInteractionChecks({page,app:createApplicationDriver(page),artifacts,source:await readFile(sourcePath,'utf8'),enforce:process.argv.includes('--check-performance')});
    if (process.argv.includes('--outline-window')) await runOutlineWindowChecks({page,app:createApplicationDriver(page),artifacts});
  }
  if (process.argv.includes('--empty-document-modes')) {
    const modeState = () => page.evaluate(`({mode:document.querySelector('.writing-modes button.active').dataset.mode,
      locked:[...document.querySelectorAll('.writing-modes button')].every(button=>button.disabled),
      empty:!document.querySelector('.document-empty').hidden,
      readOnly:document.querySelector('#editor .cm-content').contentEditable==='false'})`);
    assert.deepEqual(await modeState(),{mode:'hybrid',locked:true,empty:true,readOnly:true});
    await page.click('.writing-modes [data-mode="both"]');
    assert.equal((await modeState()).mode,'hybrid');
    await page.click('.document-empty button');
    await page.waitFor(()=>document.querySelector('.document-empty').hidden);
    for(const mode of ['both','preview','hybrid']) {
      await page.click(`.writing-modes [data-mode="${mode}"]`);
      await page.waitFor(`document.querySelector('.writing-modes button.active').dataset.mode==='${mode}'`);
      assert.deepEqual(await modeState(),{mode,locked:false,empty:false,readOnly:mode==='preview'});
    }
    await page.click('.writing-modes [data-mode="both"]');
    await page.evaluate("document.querySelector('.document-item .document-close').click()");
    await page.waitFor(()=>!document.querySelector('.document-empty').hidden);
    assert.deepEqual(await modeState(),{mode:'hybrid',locked:true,empty:true,readOnly:true});
    await page.screenshot(join(artifacts,'native-empty-after-close.png'));
    await writeFile(join(artifacts,'native-empty-modes.json'),JSON.stringify({passed:true,createdMode:'hybrid',availableModes:['both','preview','hybrid'],afterLastClose:await modeState()},null,2));
  }
  if (process.argv.includes('--minimal-header')) {
    const checks=await runMinimalHeaderChecks({page,app:createApplicationDriver(page)});
    await writeFile(join(artifacts,'native-minimal-header.json'),JSON.stringify({passed:true,checks,geometry:await inspectMinimalHeader(page)},null,2));
  }
  if (process.argv.includes('--preview-selection')) {
    const checks=await runPreviewSelectionChecks({page,app:createApplicationDriver(page),artifacts});
    await writeFile(join(artifacts,'native-preview-selection.json'),JSON.stringify({passed:true,checks},null,2));
  }
  if (process.argv.includes('--diagram-selection')) {
    const sourcePath=process.argv.find(arg=>arg.startsWith('--diagram-source='))?.slice(17);
    const source=sourcePath?await readFile(sourcePath,'utf8'):undefined;
    const checks=await runDiagramSelectionChecks({page,app:createApplicationDriver(page),artifacts,source});
    await writeFile(join(artifacts,'native-diagram-selection.json'),JSON.stringify({passed:true,checks,originalReadOnly:sourcePath||null},null,2));
  }
  if (process.argv.includes('--sidebar-resize-selection')) {
    const sourcePath=process.argv.find(arg=>arg.startsWith('--resize-source='))?.slice(16);
    assert.ok(sourcePath,'Provide the original read-only large-document path.');
    await runSidebarResizeSelectionChecks({page,app:createApplicationDriver(page),artifacts,source:await readFile(sourcePath,'utf8'),
      resizeViewport:async size=>{geometry(false,false,size);await page.waitFor(`innerWidth===${size.width}&&innerHeight===${size.height}`);}});
  }
  if (process.argv.includes('--selection-reveal')) {
    const app=createApplicationDriver(page);
    const checks=await runSelectionRevealChecks({page,app,artifacts});
    const sourcePath=process.argv.find(arg=>arg.startsWith('--selection-source='))?.slice(19);
    const source=sourcePath?await readFile(sourcePath,'utf8'):undefined;
    const chapters=await runCrossChapterSelectionCheck(page,app,source);
    await writeFile(join(artifacts,'native-selection-reveal.json'),JSON.stringify({passed:true,checks,chapters,originalFileReadOnly:sourcePath||null},null,2));
  }
  await page.click('.writing-modes [data-mode="both"]');
  await page.screenshot(join(artifacts,'native-webview.png'));
  const ui = await page.evaluate(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const b=r('.l-status-bar'),m=r('.statusbar-format');const shell=getComputedStyle(document.querySelector('.l-app-shell'));return {native:document.documentElement.classList.contains('tauri-shell'),statusHeight:b.height,markdown:{right:innerWidth-m.right,bottom:innerHeight-m.bottom,top:m.top-b.top,height:m.height,border:getComputedStyle(document.querySelector('.statusbar-format')).borderWidth},border:[shell.borderTopWidth,shell.borderRightWidth,shell.borderBottomWidth,shell.borderLeftWidth],devicePixelRatio,controlsVisible:!document.getElementById('window-controls').hidden};})()`);
  assert.equal(ui.native,true); assert.equal(ui.controlsVisible,true);
  if(expected) {
    assert.deepEqual(frame.nonclient,{left:0,top:0,right:0,bottom:0});
    assert.equal(ui.statusHeight,40); assert.ok(ui.markdown.right>=24); assert.ok(ui.markdown.bottom>=10);
    assert.equal(ui.markdown.border,'0px'); assert.deepEqual(ui.border,['1px','1px','1px','1px']);
  }
  // Capture the painted normal window before changing its compositor state.
  // A successful PrintWindow call alone can still return an occluded black image.
  const normalFrame=geometry(false);
  assert.equal(normalFrame.nativeScreenshotCaptured,true);
  assert.ok(normalFrame.visiblePixelSamples>0,'Native screenshot contains visible window pixels');
  let maximizedFrame, restoredFrame;
  if(expected) {
    await page.click('#window-maximize-btn');
    await page.waitFor(()=>document.documentElement.classList.contains('window-maximized'));
    maximizedFrame=geometry(false,false);
    assert.equal(maximizedFrame.maximized,true);
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.l-app-shell')).borderWidth"),'0px');
    await page.click('#window-maximize-btn');
    await page.waitFor(()=>!document.documentElement.classList.contains('window-maximized'));
    restoredFrame=geometry(false,false);
    assert.equal(restoredFrame.maximized,false);
    assert.equal(restoredFrame.width,frame.width);assert.equal(restoredFrame.height,frame.height);
  }
  const narrow=[];
  if(expected) {
    const app=createApplicationDriver(page);
    await app.loadMarkdown('# 最窄窗口验证\n\n> 这是一份面向当前版本的综合展示与回归测试文档。\n> 建议分别在混合模式、仅编辑模式和编辑加预览模式中查看，并测试滚动同步、双向划选、源码切换、复制、导出和主题切换。\n> > 嵌套引用保留内缩。\n\n'+('正文滚动验证。\n\n'.repeat(45))+'原生文末标记',{layout:'hybrid',selection:0});
    for(const height of [860,480]) {
      geometry(false,false,{width:600,height});
      await page.waitFor(`innerWidth===600&&innerHeight===${height}`);await app.waitForIdle();
      await app.revealPosition(0);
      const result=await page.evaluate(`(()=>{const controls=document.getElementById('window-controls').getBoundingClientRect();return {width:innerWidth,height:innerHeight,controls:{left:controls.left,right:controls.right},quotes:[...document.querySelectorAll('.cm-hybrid-blockquote')].map(e=>{const s=getComputedStyle(e),depth=Number(s.getPropertyValue('--hybrid-quote-depth'))||1;return {padding:parseFloat(s.paddingLeft),lastBar:parseFloat(s.getPropertyValue('--hybrid-line-inline-padding'))+(depth-1)*24};})};})()`);
      await writeFile(join(artifacts,`narrow-${height}.json`),JSON.stringify(result,null,2));
      await page.screenshot(join(artifacts,`native-600-${height}.png`));
      assert.ok(result.controls.right>=590&&result.controls.right<=600);
      assert.ok(result.controls.left>450);
      assert.ok(result.quotes.length>=2&&result.quotes.every(q=>q.padding-q.lastBar>=8));
      if(process.argv.includes('--minimal-header')){const h=await inspectMinimalHeader(page);assert.equal(h.height,76);assert.equal(h.width,208);assert.ok(h.centerX<=1&&h.centerY<=1);}
      await page.screenshot(join(artifacts,`native-600-${height}.png`));narrow.push(result);
    }
  }
  const finalFrame=geometry(false,false);
  assert.equal(page.exceptions.length,0,JSON.stringify(page.exceptions));
  await writeFile(join(artifacts,'native-frame.json'),JSON.stringify({frame,ui,normalFrame,maximizedFrame,restoredFrame,narrow,finalFrame,version:await connection.send('Browser.getVersion'),stderr},null,2));
  console.log(JSON.stringify({frame,ui}));
} catch(error) {
  await page?.screenshot(join(artifacts,'native-failure.png')).catch(()=>{});
  if(page)await writeFile(join(artifacts,'native-failure-selection.json'),JSON.stringify(await page.evaluate(`(()=>{const s=getSelection(),p=document.querySelector('#preview'),e=document.querySelector('#editor');return {selection:s?.toString(),anchorInPreview:p?.contains(s?.anchorNode),anchorInEditor:e?.contains(s?.anchorNode),toolbar:getComputedStyle(document.querySelector('.format-group')).display,previewSize:{width:p?.clientWidth,height:p?.clientHeight},highlights:[...CSS.highlights?.get('preview-selection-sync')||[]].map(r=>r.toString())};})()`).catch(()=>null),null,2));
  await writeFile(join(artifacts,'native-failure.json'),JSON.stringify({error:error.stack,stderr,pid:processHandle.pid,exitCode:processHandle.exitCode,exceptions:page?.exceptions,console:page?.consoleMessages,dom:await page?.evaluate("({url:location.href,state:document.readyState,text:document.body.innerText.slice(0,4000),classes:document.documentElement.className})").catch(()=>null)},null,2));
  throw error;
} finally {
  await writeFile(join(artifacts,'native-process.log'),stderr);
  if(page && processHandle.exitCode===null) await connection.send('Runtime.evaluate',{expression:"setTimeout(()=>document.getElementById('window-close-btn').click(),100)"}).catch(()=>{});
  for(let i=0;i<50&&processHandle.exitCode===null;i++)await pause(100);
  if(processHandle.exitCode===null)processHandle.kill();
  connection?.close();
}
