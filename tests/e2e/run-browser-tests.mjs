import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';
import { prepareBuiltApplicationDocument } from './lib/built-application-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const argumentsSet = new Set(process.argv.slice(2));
const runContract = argumentsSet.has('--contract') || !argumentsSet.has('--app');
const runApp = argumentsSet.has('--app') || !argumentsSet.has('--contract');
const externalUrlArgument = process.argv.find(value => value.startsWith('--url='));
const externalUrl = externalUrlArgument?.slice('--url='.length) || process.env.E2E_BASE_URL || '';
const artifactRoot = process.env.E2E_ARTIFACT_DIR
  ? resolve(process.env.E2E_ARTIFACT_DIR)
  : await mkdtemp(join(tmpdir(), 'markdown-editor-e2e-artifacts-'));
await mkdir(artifactRoot, { recursive: true });

const RESPONSIVE_SHELL_VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'desktop-1280', width: 1280, height: 800, compact: false }),
  Object.freeze({ name: 'desktop-900', width: 900, height: 700, compact: false }),
  Object.freeze({ name: 'compact-720', width: 720, height: 700, compact: true }),
  Object.freeze({ name: 'compact-600', width: 600, height: 700, compact: true }),
  Object.freeze({ name: 'short-900x480', width: 900, height: 480, compact: false }),
  Object.freeze({ name: 'short-600x480', width: 600, height: 480, compact: true })
]);

const results = [];
let activePage = null;

async function test(name, callback) {
  const started = performance.now();
  try {
    await callback();
    const duration = Math.round(performance.now() - started);
    results.push({ name, ok: true, duration });
    console.log(`ok - ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Math.round(performance.now() - started);
    results.push({ name, ok: false, duration, error });
    console.error(`not ok - ${name} (${duration}ms)`);
    console.error(error?.stack || error);
    if (activePage) {
      const fileName = `${String(results.length).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.png`;
      try {
        await activePage.screenshot(join(artifactRoot, fileName));
        console.error(`  screenshot: ${join(artifactRoot, fileName)}`);
      } catch (_) {}
    }
  }
}

async function getTextBoundary(page, selector, search, edge = 'start', contains = '') {
  const payload = JSON.stringify({ selector, search, edge, contains });
  const point = await page.evaluate(`(() => {
    const {selector, search, edge, contains} = ${payload};
    const root = contains
      ? Array.from(document.querySelectorAll(selector)).find(element => String(element.textContent || '').includes(contains))
      : document.querySelector(selector);
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    while (walker.nextNode()) { nodes.push({node: walker.currentNode, start: text.length}); text += walker.currentNode.nodeValue || ''; }
    const index = text.indexOf(search);
    if (index < 0) return null;
    const absolute = edge === 'end' ? index + search.length : index;
    let entry = nodes.at(-1);
    for (const candidate of nodes) {
      const length = candidate.node.nodeValue?.length || 0;
      if (absolute <= candidate.start + length) { entry = candidate; break; }
    }
    if (!entry) return null;
    const offset = Math.max(0, Math.min(entry.node.nodeValue?.length || 0, absolute - entry.start));
    const range = document.createRange();
    range.setStart(entry.node, offset); range.collapse(true);
    let rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height && offset > 0) {
      range.setStart(entry.node, offset - 1); range.setEnd(entry.node, offset); rect = range.getBoundingClientRect();
      return {x: rect.right, y: rect.top + rect.height / 2};
    }
    return {x: rect.left, y: rect.top + Math.max(1, rect.height) / 2};
  })()`);
  if (!point) throw new Error(`Unable to resolve text boundary ${search} in ${selector}`);
  return point;
}

async function centerByText(page, rootSelector, text) {
  const payload = JSON.stringify({ rootSelector, text });
  const point = await page.evaluate(`(() => {
    const {rootSelector,text}=${payload};
    const root=document.querySelector(rootSelector); if(!root)return null;
    const element=Array.from(root.querySelectorAll('button,[role="button"]')).find(item=>item.textContent.trim()===text);
    if(!element)return null; const rect=element.getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
  })()`);
  if (!point) throw new Error(`Button not found: ${rootSelector} / ${text}`);
  return point;
}

async function runContractSuite() {
  const browser = await launchChromium();
  const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });
  activePage = browser.page;
  try {
    let harnessHtml = await readFile(resolve(projectRoot, 'tests/e2e/fixtures/interaction-harness.html'), 'utf8');
    harnessHtml = harnessHtml
      .replace('<head>', `<head><base href="${virtualHost.origin}/tests/e2e/fixtures/">`)
      .replace(/<script type="module" src="\.\/interaction-harness\.js"><\/script>/, '');
    await browser.page.setDocumentContent(harnessHtml);
    await browser.page.evaluate(`import('${virtualHost.origin}/tests/e2e/fixtures/interaction-harness.js').then(()=>true)`);
    await browser.page.waitFor(() => window.__interactionHarness?.ready === true, { description: 'interaction harness' });

    await test('single click keeps a component presented', async () => {
      await browser.page.evaluate('window.__interactionHarness.reset()');
      await browser.page.click('[data-component="code"] .component-body');
      const mode = await browser.page.evaluate('document.querySelector("[data-component=code]").dataset.mode');
      assert.equal(mode, 'presented');
    });

    await test('strict double click opens direct editing on the same logical target', async () => {
      await browser.page.evaluate('window.__interactionHarness.reset()');
      await browser.page.click('[data-component="code"] .component-body', { count: 2, intervalMs: 90 });
      await browser.page.waitFor(() => document.querySelector('[data-component="code"]')?.dataset.mode === 'direct', { description: 'code direct mode' });
      const snapshot = await browser.page.evaluate('window.__interactionHarness.snapshot()');
      assert.equal(snapshot.active.type, 'code');
      assert.equal(snapshot.active.mode, 'direct');
    });

    await test('fast clicks across components never count as a double click', async () => {
      await browser.page.evaluate('window.__interactionHarness.reset()');
      await browser.page.click('[data-component="code"] .component-body');
      await browser.page.click('[data-component="table"] .component-body');
      const modes = await browser.page.evaluate(`Array.from(document.querySelectorAll('[data-component]')).map(item=>item.dataset.mode)`);
      assert.deepEqual(modes, ['presented', 'presented', 'presented']);
    });

    await test('opening another component closes the previous interactive component', async () => {
      await browser.page.evaluate('window.__interactionHarness.reset()');
      await browser.page.click('[data-component="code"] .component-body', { count: 2 });
      await browser.page.click('[data-component="table"] .component-body', { count: 2 });
      await browser.page.waitFor(() => document.querySelector('[data-component="table"]')?.dataset.mode === 'direct');
      const modes = await browser.page.evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('[data-component]')).map(item=>[item.dataset.component,item.dataset.mode]))`);
      assert.equal(modes.code, 'presented');
      assert.equal(modes.table, 'direct');
    });

    await test('source editing closes on an outside pointer action', async () => {
      await browser.page.evaluate('window.__interactionHarness.reset()');
      await browser.page.click('[data-component="math"] [data-source]');
      await browser.page.waitFor(() => document.querySelector('[data-component="math"]')?.dataset.mode === 'source');
      await browser.page.click('.outside');
      await browser.page.waitFor(() => document.querySelector('[data-component="math"]')?.dataset.mode === 'presented');
      const snapshot = await browser.page.evaluate('window.__interactionHarness.snapshot()');
      assert.equal(snapshot.active, null);
    });

    await test('layout switching closes active component editing', async () => {
      await browser.page.evaluate('window.__interactionHarness.reset()');
      await browser.page.click('[data-component="code"] .component-body', { count: 2 });
      await browser.page.click('[data-view="both"]');
      const snapshot = await browser.page.evaluate('window.__interactionHarness.snapshot()');
      assert.equal(snapshot.layout, 'both');
      assert.equal(snapshot.active, null);
      assert.ok(snapshot.states.every(item => item.mode === 'presented'));
    });

    await test('real pointer drag selects only the intended characters', async () => {
      await browser.page.evaluate('window.__interactionHarness.reset()');
      const start = await getTextBoundary(browser.page, '[data-selection-line]', 'alpha', 'start');
      const end = await getTextBoundary(browser.page, '[data-selection-line]', 'beta', 'end');
      await browser.page.drag({ x: start.x + 1, y: start.y }, { x: end.x - 1, y: end.y }, { steps: 16 });
      const selected = await browser.page.evaluate('String(getSelection()?.toString() || "")');
      assert.equal(selected.trim(), 'alpha beta');
    });

    await test('shared Mermaid renderer keeps hybrid and preview SVG normalization identical', async () => {
      const result = await browser.page.evaluate('window.__interactionHarness.renderMermaidParity("dark")');
      for (const surface of [result.hybrid, result.preview]) {
        assert.equal(surface.role, 'img');
        assert.equal(surface.label, 'Mermaid 图表');
        assert.match(surface.className, /(?:^|\s)f-mermaid-svg(?:\s|$)/);
        assert.equal(surface.heightAttribute, null);
        assert.equal(surface.inlineStyle, null);
        assert.equal(surface.theme, 'dark');
      }
      assert.equal(result.hybridResult.status, 'rendered');
      assert.equal(result.previewResult.status, 'rendered');
      assert.equal(result.calls.filter(item => item.type === 'initialize').length, 1);
      assert.equal(result.calls.filter(item => item.type === 'render').length, 2);
    });

    await test('folder file tree renders nested readable files, preserves expansion, opens paths, and destroys listeners', async () => {
      await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${virtualHost.origin}/"></head><body>
        <section id="sidebar-files-panel">
          <strong id="folder-file-tree-root"></strong><small id="folder-file-tree-summary"></small>
          <button id="folder-file-tree-refresh"></button><div id="folder-file-tree"></div>
        </section>
      </body></html>`);
      const moduleUrl = `${virtualHost.origin}/src/features/sidebar/index.js`;
      await browser.page.evaluate(`(async()=>{
        const {createFolderTreeState,createFolderTreeView,createFolderTreeController}=await import(${JSON.stringify(moduleUrl)});
        window.__folderTreeOpened=[];
        window.__folderTreeReads=0;
        const state=createFolderTreeState();
        const view=createFolderTreeView({
          documentRef:document,
          panel:document.getElementById('sidebar-files-panel'),
          list:document.getElementById('folder-file-tree'),
          rootLabel:document.getElementById('folder-file-tree-root'),
          summary:document.getElementById('folder-file-tree-summary'),
          refreshButton:document.getElementById('folder-file-tree-refresh'),
          available:true
        });
        window.__folderTreeController=createFolderTreeController({
          state,view,
          files:{async listTextTree(){window.__folderTreeReads++;return {
            rootPath:'F:/Notes',rootName:'Notes',fileCount:3,directoryCount:1,skippedCount:0,truncated:false,
            nodes:[
              {kind:'directory',name:'Archive',path:'F:/Notes/Archive',children:[{kind:'file',name:'old.md',path:'F:/Notes/Archive/old.md'}]},
              {kind:'file',name:'current.md',path:'F:/Notes/current.md'},
              {kind:'file',name:'next.txt',path:'F:/Notes/next.txt'}
            ]
          }}},
          available:true,
          getCurrentContext:()=>({filePath:'F:/Notes/current.md'}),
          openFile:async path=>{window.__folderTreeOpened.push(path);return true;}
        });
        window.__folderTreeController.start();
        await window.__folderTreeController.activate();
      })()`);
      await browser.page.waitFor(() => document.querySelectorAll('.folder-tree-file-row').length === 3, { description: 'folder tree rows' });
      const snapshot = await browser.page.evaluate(`(()=>({
        root:document.getElementById('folder-file-tree-root').textContent,
        summary:document.getElementById('folder-file-tree-summary').textContent,
        names:Array.from(document.querySelectorAll('.folder-tree-file-row')).map(row=>row.textContent.trim()),
        active:document.querySelector('.folder-tree-file-row.active')?.textContent.trim()||'',
        expanded:document.querySelector('.folder-tree-directory-row')?.getAttribute('aria-expanded'),
        iconHrefs:Array.from(document.querySelectorAll('.folder-tree-row use')).map(use=>use.getAttribute('href'))
      }))()`);
      assert.equal(snapshot.root, 'Notes');
      assert.match(snapshot.summary, /3 个文件/);
      assert.deepEqual(snapshot.names, ['old.md', 'current.md', 'next.txt']);
      assert.equal(snapshot.active, 'current.md');
      assert.equal(snapshot.expanded, 'true');
      assert.ok(snapshot.iconHrefs.length >= 4);
      assert.ok(snapshot.iconHrefs.every(href => /^\/assets\/icons\.svg#icon-[a-z0-9-]+$/.test(href)));
      await browser.page.evaluate(`document.querySelector('.folder-tree-directory-row').click()`);
      assert.equal(await browser.page.evaluate(`document.querySelector('.folder-tree-directory-row').getAttribute('aria-expanded')`), 'false');
      await browser.page.evaluate(`Array.from(document.querySelectorAll('.folder-tree-file-row')).find(row=>row.textContent.includes('next.txt')).click()`);
      await browser.page.waitFor(() => window.__folderTreeOpened?.length === 1, { description: 'folder tree open callback' });
      assert.equal(await browser.page.evaluate('window.__folderTreeOpened[0]'), 'F:/Notes/next.txt');
      const readsBeforeDestroy = await browser.page.evaluate('window.__folderTreeReads');
      await browser.page.evaluate(`window.__folderTreeController.destroy();document.getElementById('folder-file-tree-refresh').click()`);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(await browser.page.evaluate('window.__folderTreeReads'), readsBeforeDestroy);
    });


    await test('temporary compatibility business port mounts and destroys without owning the App Shell', async () => {
      await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${virtualHost.origin}/"></head><body>
        <div id="app-root" hidden><span id="pre-shell-node">before</span></div>
      </body></html>`);
      const result = await browser.page.evaluate(`(async()=>{
        const [{createUI},{createCompatibilityBusinessContentPort}]=await Promise.all([
          import('${virtualHost.origin}/src/ui/create-ui.js'),
          import('${virtualHost.origin}/src/ui/compatibility/index.js')
        ]);
        const markup=await fetch('${virtualHost.origin}/public/compatibility/business-content.html').then(response=>response.text());
        const root=document.getElementById('app-root');
        const ui=createUI(root);
        let foreignSlotError='';
        try{createCompatibilityBusinessContentPort(root,{...ui,menu:document.createElement('nav')});}
        catch(error){foreignSlotError=error.message;}
        const port=createCompatibilityBusinessContentPort(root,ui);
        let invalidMarkupError='';
        try{port.mount('<template data-compat-slot=\"menu\"></template>');}
        catch(error){invalidMarkupError=error.message;}
        const cleanAfterInvalid={
          shellCount:root.querySelectorAll('[data-ui-shell=\"app\"]').length,
          portHostPresent:Boolean(document.getElementById('compatibility-business-ports')),
          menuChildren:ui.menu.childNodes.length
        };
        const firstMount=port.mount(markup);
        const secondMount=port.mount(markup);
        const mounted={
          firstMount,secondMount,
          rootChildren:Array.from(root.children).map(node=>node.id||node.getAttribute('data-ui-shell')||''),
          shellCount:root.querySelectorAll('[data-ui-shell="app"]').length,
          portHostParent:document.getElementById('compatibility-business-ports')?.parentElement?.id||'',
          filePortParent:document.getElementById('filename')?.parentElement?.id||'',
          settingsParent:document.getElementById('settings-modal')?.parentElement?.id||'',
          previousPresent:Boolean(document.getElementById('pre-shell-node'))
        };
        port.destroy();
        port.destroy();
        let remountError='';
        try{port.mount(markup);}catch(error){remountError=error.message;}
        const afterPort={
          shellCount:root.querySelectorAll('[data-ui-shell="app"]').length,
          settingsPresent:Boolean(document.getElementById('settings-modal')),
          filePortPresent:Boolean(document.getElementById('filename')),
          portHostPresent:Boolean(document.getElementById('compatibility-business-ports')),
          remountError
        };
        ui.destroy();
        const afterUI={
          hidden:root.hidden,
          children:Array.from(root.children).map(node=>node.id),
          shellCount:root.querySelectorAll('[data-ui-shell="app"]').length
        };
        return {foreignSlotError,invalidMarkupError,cleanAfterInvalid,mounted,afterPort,afterUI};
      })()`);
      assert.match(result.foreignSlotError, /outside the current application root/);
      assert.match(result.invalidMarkupError, /Missing compatibility templates/);
      assert.deepEqual(result.cleanAfterInvalid, { shellCount: 1, portHostPresent: false, menuChildren: 0 });
      assert.deepEqual(result.mounted.rootChildren, ['app', 'overlay-root']);
      assert.equal(result.mounted.firstMount, true);
      assert.equal(result.mounted.secondMount, false);
      assert.equal(result.mounted.shellCount, 1);
      assert.equal(result.mounted.portHostParent, 'overlay-root');
      assert.equal(result.mounted.filePortParent, 'compatibility-business-ports');
      assert.equal(result.mounted.settingsParent, '');
      assert.equal(result.mounted.previousPresent, false);
      assert.equal(result.afterPort.shellCount, 1);
      assert.equal(result.afterPort.settingsPresent, false);
      assert.equal(result.afterPort.filePortPresent, false);
      assert.equal(result.afterPort.portHostPresent, false);
      assert.match(result.afterPort.remountError, /destroyed/);
      assert.deepEqual(result.afterUI, { hidden: true, children: ['pre-shell-node'], shellCount: 0 });
    });
  } finally {
    activePage = null;
    await virtualHost.close();
    await browser.close();
  }
}

const APP_FIXTURE = await readFile(resolve(projectRoot, 'tests/fixtures/hybrid-regression.md'), 'utf8');

async function loadAppFixture(page) {
  const fixture = JSON.stringify(APP_FIXTURE);
  return page.evaluate(`(async()=>{
    const source=${fixture};
    if(window.__markdownEditorE2E){
      await window.__markdownEditorE2E.loadMarkdown(source,{layout:'hybrid',codeVisualEditing:true,tableVisualEditing:true});
      return window.__markdownEditorE2E.snapshot();
    }
    const editor=document.getElementById('editor');
    editor.virtualEditor.loadDocument(source,{selection:0});
    editor.virtualEditor.setHybridCodeVisualEditing(true);
    editor.virtualEditor.setHybridTableVisualEditing(true);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
    setLayoutMode('hybrid',false);
    await new Promise(resolve=>setTimeout(resolve,700));
    return {layout:document.body.classList.contains('hybrid-view-mode')?'hybrid':'unknown'};
  })()`);
}

async function setAppLayout(page, mode) {
  const encoded = JSON.stringify(mode);
  await page.evaluate(`(async()=>{
    if(window.__markdownEditorE2E) return window.__markdownEditorE2E.setLayout(${encoded});
    setLayoutMode(${encoded},false); await new Promise(resolve=>setTimeout(resolve,250)); return ${encoded};
  })()`);
}

async function appSnapshot(page) {
  return page.evaluate(`window.__markdownEditorE2E?.snapshot?.() || (()=>{
    const editor=document.getElementById('editor');
    return {layout:document.body.classList.contains('hybrid-view-mode')?'hybrid':'other',selectionStart:editor.selectionStart,selectionEnd:editor.selectionEnd,selectedText:editor.value.slice(editor.selectionStart,editor.selectionEnd),presentationStats:editor.virtualEditor.getPresentationStats(),components:Array.from(document.querySelectorAll('[data-hybrid-block-type]')).map(item=>({type:item.dataset.hybridBlockType,directEditing:Boolean(item.querySelector('[data-hybrid-code-editor],[data-hybrid-table-cell-input]'))}))};
  })()`);
}

async function applyResponsiveViewport(page, viewport) {
  await page.setViewport({ width: 1200, height: 720 });
  await page.waitFor(() => window.innerWidth === 1200 && window.innerHeight === 720, {
    description: 'responsive viewport reset'
  });
  await page.setViewport(viewport);
  await page.waitFor(`(()=>window.innerWidth===${viewport.width}&&window.innerHeight===${viewport.height})()`, {
    description: `responsive viewport ${viewport.name}`
  });
  await page.evaluate(`new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),180))`);
}

async function inspectResponsiveShell(page, viewport) {
  const payload = JSON.stringify(viewport);
  return page.evaluate(`(async()=>{
    const viewport=${payload};
    scrollTo(0,0);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const shell=document.querySelector('.l-app-shell');
    const selectors={
      shell:'.l-app-shell',
      menu:'.l-menu-bar',
      toolbar:'.l-toolbar-shell',
      workspace:'.l-workspace',
      main:'.l-split-pane',
      status:'.l-status-bar'
    };
    const round=value=>Math.round(Number(value||0)*1000)/1000;
    const toRect=element=>{
      if(!element)return null;
      const rect=element.getBoundingClientRect();
      return {left:round(rect.left),top:round(rect.top),right:round(rect.right),bottom:round(rect.bottom),width:round(rect.width),height:round(rect.height)};
    };
    const regions=Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{
      const element=document.querySelector(selector);
      const style=element?getComputedStyle(element):null;
      return [name,element?{
        rect:toRect(element),
        clientWidth:element.clientWidth,
        clientHeight:element.clientHeight,
        scrollWidth:element.scrollWidth,
        scrollHeight:element.scrollHeight,
        overflowX:style?.overflowX||'',
        overflowY:style?.overflowY||'',
        display:style?.display||'',
        flexDirection:style?.flexDirection||''
      }:null];
    }));
    const viewportIssues=[];
    for(const [name,region] of Object.entries(regions)){
      const rect=region?.rect;
      if(!rect){viewportIssues.push({name,reason:'missing'});continue;}
      if(rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1){
        viewportIssues.push({name,reason:'outside-viewport',rect});
      }
      if(region.scrollWidth > region.clientWidth + 1){
        viewportIssues.push({name,reason:'horizontal-overflow',clientWidth:region.clientWidth,scrollWidth:region.scrollWidth,overflowX:region.overflowX});
      }
    }
    const focusSelector=[
      '.l-menu-bar button:not([disabled])',
      '.l-toolbar-shell button:not([disabled])',
      '.l-toolbar-shell input:not([disabled])',
      '.l-toolbar-shell select:not([disabled])',
      '.l-split-pane .collapse-btn:not([disabled])'
    ].join(',');
    const focusables=Array.from(document.querySelectorAll(focusSelector)).filter(element=>{
      const style=getComputedStyle(element);
      const rect=element.getBoundingClientRect();
      return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
    });
    const focusIssues=[];
    for(const [index,element] of focusables.entries()){
      element.focus({preventScroll:true});
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const rect=element.getBoundingClientRect();
      const clippedBy=[];
      let ancestor=element.parentElement;
      while(ancestor&&ancestor!==shell?.parentElement){
        const style=getComputedStyle(ancestor);
        if(/hidden|clip|auto|scroll/.test(String(style.overflowX)+' '+String(style.overflowY))){
          const boundary=ancestor.getBoundingClientRect();
          if(rect.left < boundary.left - 1 || rect.right > boundary.right + 1 || rect.top < boundary.top - 1 || rect.bottom > boundary.bottom + 1){
            clippedBy.push(ancestor.id||ancestor.className||ancestor.tagName);
          }
        }
        ancestor=ancestor.parentElement;
      }
      const active=document.activeElement===element;
      const outside=rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
      if(!active||outside||clippedBy.length){
        focusIssues.push({
          index,
          target:element.id||element.getAttribute('aria-label')||element.getAttribute('title')||String(element.textContent||'').trim().slice(0,48),
          active,
          outside,
          clippedBy,
          rect:toRect(element)
        });
      }
    }
    const pageScroll={x:round(scrollX),y:round(scrollY)};
    if(pageScroll.x!==0||pageScroll.y!==0){
      viewportIssues.push({name:'document',reason:'page-scroll',pageScroll});
    }
    return {
      viewport,
      pageScroll,
      actualViewport:{width:innerWidth,height:innerHeight},
      document:{
        clientWidth:document.documentElement.clientWidth,
        clientHeight:document.documentElement.clientHeight,
        scrollWidth:document.documentElement.scrollWidth,
        scrollHeight:document.documentElement.scrollHeight,
        bodyScrollWidth:document.body.scrollWidth,
        bodyScrollHeight:document.body.scrollHeight
      },
      states:{
        compact:document.documentElement.classList.contains('is-compact-shell'),
        toolbarWrapped:document.querySelector('.l-toolbar-shell')?.classList.contains('toolbar-boundary-wrap')||false,
        sidebarHidden:document.querySelector('.l-sidebar')?.classList.contains('is-hidden')||false,
        compactSplit:document.querySelector('.l-split-pane')?.classList.contains('is-compact-split')||false
      },
      regions,
      focusableCount:focusables.length,
      viewportIssues,
      focusIssues
    };
  })()`);
}

async function runAppSuite() {
  const browser = await launchChromium({ width: 1440, height: 1000 });
  const virtualHost = externalUrl ? null : await installVirtualFileHost(browser.page, {
    root: resolve(projectRoot, 'dist'),
    origin: 'https://markdown-editor-app.test'
  });
  const baseUrl = externalUrl || virtualHost.origin;
  activePage = browser.page;
  try {
    if (externalUrl) {
      await browser.page.navigate(`${baseUrl.replace(/\/$/, '')}/?e2e=1`);
    } else {
      let appHtml = await readFile(resolve(projectRoot, 'dist/index.html'), 'utf8');
      const preparedApplication = prepareBuiltApplicationDocument(appHtml, virtualHost.origin);
      const { moduleUrl, stylesheetUrl } = preparedApplication;
      appHtml = preparedApplication.html;
      await browser.page.setDocumentContent(appHtml);
      await browser.page.evaluate(`(()=>{
        const values=new Map();
        const storage={getItem:key=>values.has(String(key))?values.get(String(key)):null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear(),key:index=>Array.from(values.keys())[index]??null,get length(){return values.size;}};
        Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
        window.__MARKDOWN_EDITOR_E2E__=true;
        localStorage.setItem('md_editor_help_shown','true');
        localStorage.setItem('md_editor_sidebar_visible','false');
      })()`);
      if (stylesheetUrl) {
        await browser.page.evaluate(`new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href=${JSON.stringify(stylesheetUrl)};link.onload=resolve;link.onerror=()=>reject(new Error('stylesheet failed'));document.head.appendChild(link);})`);
      }
      await browser.page.evaluate(`import(${JSON.stringify(moduleUrl)}).then(()=>true)`);
    }
    await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 20000, description: 'application ready' });
    const bridgeAvailable = await browser.page.evaluate('Boolean(window.__markdownEditorE2E)');
    if (!externalUrl && !bridgeAvailable) {
      throw new Error('Built dist is stale or was not produced from the current source. Run npm run build before npm run test:browser.');
    }
    await test('application mounts one App Shell with strict named slots', async () => {
      const snapshot = await browser.page.evaluate(`(()=>{
        const root=document.getElementById('app-root');
        const shell=root?.querySelector('[data-ui-shell="app"]');
        const slotNames=['menu','toolbar','sidebar','editor','preview','status','overlay'];
        const counts=Object.fromEntries(slotNames.map(name=>[name,document.querySelectorAll('[data-ui-slot="'+name+'"]').length]));
        const ids=Array.from(document.querySelectorAll('[id]')).map(element=>element.id);
        return {
          shellCount:document.querySelectorAll('[data-ui-shell="app"]').length,
          appCount:document.querySelectorAll('.l-app-shell').length,
          legacyAppHookCount:document.querySelectorAll('.app').length,
          counts,
          appChildren:Array.from(shell?.children||[]).map(element=>element.className),
          workspaceChildren:Array.from(shell?.querySelector('.l-workspace')?.children||[]).map(element=>element.id||element.className),
          mainChildren:Array.from(shell?.querySelector('.l-split-pane')?.children||[]).map(element=>element.id||element.className),
          overlayParent:document.getElementById('overlay-root')?.parentElement?.id||'',
          settingsParent:document.getElementById('settings-modal')?.parentElement?.id||'',
          compatibilityPortHostParent:document.getElementById('compatibility-business-ports')?.parentElement?.id||'',
          filePortParents:['filename','importFile'].map(id=>document.getElementById(id)?.parentElement?.id||''),
          duplicateIds:ids.filter((id,index)=>ids.indexOf(id)!==index)
        };
      })()`);
      assert.equal(snapshot.shellCount, 1);
      assert.equal(snapshot.appCount, 1);
      assert.equal(snapshot.legacyAppHookCount, 1);
      assert.deepEqual(snapshot.counts, {menu:1,toolbar:1,sidebar:1,editor:1,preview:1,status:1,overlay:1});
      assert.deepEqual(snapshot.appChildren, ['l-menu-bar menu-bar','l-toolbar-shell editor-toolbar','l-workspace workspace','l-status-bar statusbar']);
      assert.deepEqual(snapshot.workspaceChildren, ['sidebar','sidebar-resizer','l-split-pane main']);
      assert.deepEqual(snapshot.mainChildren, ['l-pane f-editor-pane pane editor-pane','resizer','l-pane f-preview-pane pane preview-pane']);
      assert.equal(snapshot.overlayParent, 'app-root');
      assert.equal(snapshot.settingsParent, 'overlay-root');
      assert.equal(snapshot.compatibilityPortHostParent, 'overlay-root');
      assert.deepEqual(snapshot.filePortParents, ['compatibility-business-ports','compatibility-business-ports']);
      assert.deepEqual(snapshot.duplicateIds, []);
    });

    await test('application Help feature owns first-run visibility, navigation and scoped lifecycle', async () => {
      const initial = await browser.page.evaluate(`(()=>{
        localStorage.removeItem('md_editor_help_shown');
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorHelpPort;
        if(!port)return null;
        return {
          opened:port.openFirstRun(),
          isOpen:port.isOpen(),
          activePage:port.activePage,
          globals:{
            openHelp:typeof window.openHelp,
            closeHelp:typeof window.closeHelp,
            switchHelpPage:typeof window.switchHelpPage
          },
          shown:localStorage.getItem('md_editor_help_shown')
        };
      })()`);
      assert.ok(initial);
      assert.equal(initial.opened, true);
      assert.equal(initial.isOpen, true);
      assert.equal(initial.activePage, 'start');
      assert.deepEqual(initial.globals, {openHelp:'undefined',closeHelp:'undefined',switchHelpPage:'undefined'});
      assert.equal(initial.shown, null);
      await browser.page.waitFor(() => document.getElementById('help-modal')?.classList.contains('show'), { description: 'Help first-run modal open' });
      await browser.page.click('#help-modal [data-help-page="files"]');
      await browser.page.waitFor(() => document.querySelector('#help-modal [data-help-page-panel="files"]'), { description: 'Help files page' });
      const navigated = await browser.page.evaluate(`(()=>{
        const port=document.getElementById('compatibility-business-ports')?.markdownEditorHelpPort;
        return {activePage:port?.activePage,selected:document.querySelector('#help-modal [data-help-page="files"]')?.getAttribute('aria-selected')};
      })()`);
      assert.deepEqual(navigated, {activePage:'files',selected:'true'});
      await browser.page.click('#help-modal .modal-footer button');
      await browser.page.waitFor(() => !document.getElementById('help-modal')?.classList.contains('show'), { description: 'Help modal close' });
      const closed = await browser.page.evaluate(`(()=>{
        const port=document.getElementById('compatibility-business-ports')?.markdownEditorHelpPort;
        return {shown:localStorage.getItem('md_editor_help_shown'),firstRunAgain:port?.openFirstRun(),isOpen:port?.isOpen()};
      })()`);
      assert.deepEqual(closed, {shown:'true',firstRunAgain:false,isOpen:false});
    });

    await test('application Settings Store cancels draft without persisting changes', async () => {
      const result = await browser.page.evaluate(`(()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorSettingsStorePort;
        if(!port)throw new Error('Settings Store port unavailable');
        const before={stored:localStorage.getItem('md_editor_theme'),committed:port.get('theme'),body:document.body.getAttribute('data-theme')};
        const open=()=>document.querySelector('[data-settings-open]')?.click();

        open();
        document.getElementById('setting-theme').value='dark';
        document.getElementById('setting-theme').dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('#settings-modal .modal-footer button:not(.primary)')?.click();
        const afterButton={stored:localStorage.getItem('md_editor_theme'),hasDraft:port.hasDraft,body:document.body.getAttribute('data-theme')};

        open();
        document.getElementById('setting-theme').value='dark';
        document.getElementById('setting-theme').dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('settings-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        const afterEscape={stored:localStorage.getItem('md_editor_theme'),hasDraft:port.hasDraft,body:document.body.getAttribute('data-theme')};

        open();
        document.getElementById('setting-theme').value='dark';
        document.getElementById('setting-theme').dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('settings-modal').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
        const afterBackdrop={stored:localStorage.getItem('md_editor_theme'),hasDraft:port.hasDraft,body:document.body.getAttribute('data-theme')};

        open();
        const reopened=document.getElementById('setting-theme').value;
        document.querySelector('#settings-modal .modal-footer button:not(.primary)')?.click();
        return {before,afterButton,afterEscape,afterBackdrop,reopened,globals:{
          openSettings:typeof window.openSettings,
          closeSettings:typeof window.closeSettings,
          applySettings:typeof window.applySettings,
          switchSettingsPage:typeof window.switchSettingsPage
        }};
      })()`);
      assert.deepEqual(result.before, {stored:null,committed:'light',body:'light'});
      for (const state of [result.afterButton, result.afterEscape, result.afterBackdrop]) {
        assert.deepEqual(state, {stored:null,hasDraft:false,body:'light'});
      }
      assert.equal(result.reopened, 'light');
      assert.deepEqual(result.globals, {
        openSettings:'undefined',closeSettings:'undefined',applySettings:'undefined',switchSettingsPage:'undefined'
      });
    });

    await test('application Settings UI validates and applies one draft without global dialog functions', async () => {
      await browser.page.evaluate(`document.querySelector('[data-settings-open]')?.click()`);
      await browser.page.waitFor(() => document.getElementById('settings-modal')?.classList.contains('show'), { description: 'Settings dialog open' });
      await browser.page.click('#settings-modal [data-settings-page="save"]');
      await browser.page.waitFor(() => !document.querySelector('#settings-modal [data-settings-page-panel="save"]')?.hidden, { description: 'Settings save page' });
      const selected = await browser.page.evaluate(`document.querySelector('#settings-modal [data-settings-page="save"]')?.getAttribute('aria-selected')`);
      assert.equal(selected, 'true');

      await browser.page.evaluate(`(()=>{
        const select=document.getElementById('setting-autosave-delay');
        select.value='custom';
        select.dispatchEvent(new Event('change',{bubbles:true}));
        const custom=document.getElementById('setting-autosave-custom-seconds');
        custom.value='0.1';
        custom.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#settings-modal .modal-footer .primary')?.click();
      })()`);
      const invalid = await browser.page.evaluate(`(()=>({
        open:document.getElementById('settings-modal')?.classList.contains('show'),
        invalid:document.getElementById('setting-autosave-custom-seconds')?.getAttribute('aria-invalid'),
        feedback:document.getElementById('settings-feedback')?.textContent||''
      }))()`);
      assert.equal(invalid.open, true);
      assert.equal(invalid.invalid, 'true');
      assert.match(invalid.feedback, /0\.5–3600/);

      await browser.page.evaluate(`(()=>{
        const custom=document.getElementById('setting-autosave-custom-seconds');
        custom.value='1.5';
        custom.dispatchEvent(new Event('input',{bubbles:true}));
        const theme=document.getElementById('setting-theme');
        theme.value='dark';
        theme.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('#settings-modal .modal-footer .primary')?.click();
      })()`);
      await browser.page.waitFor(() => !document.getElementById('settings-modal')?.classList.contains('show'), { description: 'Settings apply close' });
      const applied = await browser.page.evaluate(`(()=>{
        const port=document.getElementById('compatibility-business-ports')?.markdownEditorSettingsStorePort;
        return {
          theme:port?.get('theme'),
          delay:port?.get('autoSaveDelay'),
          storedTheme:localStorage.getItem('md_editor_theme'),
          storedDelay:localStorage.getItem('md_editor_autosave_delay'),
          body:document.body.getAttribute('data-theme')
        };
      })()`);
      assert.deepEqual(applied, {theme:'dark',delay:1500,storedTheme:'dark',storedDelay:'1500',body:'dark'});

      await browser.page.evaluate(`(()=>{
        document.querySelector('[data-settings-open]')?.click();
        const theme=document.getElementById('setting-theme');
        theme.value='light';
        theme.dispatchEvent(new Event('change',{bubbles:true}));
        const delay=document.getElementById('setting-autosave-delay');
        delay.value='500';
        delay.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('#settings-modal .modal-footer .primary')?.click();
      })()`);
      await browser.page.waitFor(() => document.body.getAttribute('data-theme') === 'light' && !document.getElementById('settings-modal')?.classList.contains('show'));
    });

    await test('application language Settings commit updates I18n without legacy globals', async () => {
      await browser.page.evaluate(`document.querySelector('[data-settings-open]')?.click()`);
      await browser.page.waitFor(() => document.getElementById('settings-modal')?.classList.contains('show'), { description: 'Settings dialog open for language' });
      await browser.page.evaluate(`(()=>{
        const language=document.getElementById('setting-language');
        if(!language)throw new Error('Language setting unavailable');
        language.value='en';
        language.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('#settings-modal .modal-footer .primary')?.click();
      })()`);
      await browser.page.waitFor(() => document.documentElement.lang === 'en' && !document.getElementById('settings-modal')?.classList.contains('show'), { description: 'committed English locale' });
      const applied = await browser.page.evaluate(`(()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorI18nPort;
        const store=host?.markdownEditorSettingsStorePort;
        const editorButton=document.getElementById('editor-collapse-btn');
        const editorCollapsed=document.querySelector('.editor-pane')?.classList.contains('collapsed');
        const expectedTitle=port?.t(editorCollapsed?'expandEditor':'collapseEditor');
        return {
          locale:port?.locale,
          committed:store?.get('language'),
          stored:localStorage.getItem('md_editor_language'),
          htmlLang:document.documentElement.lang,
          dynamicMatches:Boolean(editorButton && expectedTitle && editorButton.title===expectedTitle),
          globals:{i18n:typeof window.i18n,currentLang:typeof window.currentLang,setLanguage:typeof window.setLanguage}
        };
      })()`);
      assert.deepEqual(applied, {
        locale:'en',committed:'en',stored:'en',htmlLang:'en',dynamicMatches:true,
        globals:{i18n:'undefined',currentLang:'undefined',setLanguage:'undefined'}
      });

      await browser.page.evaluate(`(()=>{
        document.querySelector('[data-settings-open]')?.click();
        const language=document.getElementById('setting-language');
        language.value='zh-CN';
        language.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('#settings-modal .modal-footer .primary')?.click();
      })()`);
      await browser.page.waitFor(() => document.documentElement.lang === 'zh-CN', { description: 'restore zh-CN locale' });
    });

    await test('application theme switch changes visual tokens without changing shell geometry', async () => {
      const result = await browser.page.evaluate(`(async()=>{
        const selectors={
          shell:'[data-ui-shell="app"]',
          menu:'.l-menu-bar',
          toolbar:'.l-toolbar-shell',
          workspace:'.l-workspace',
          main:'.l-split-pane',
          editor:'.f-editor-pane',
          preview:'.f-preview-pane',
          status:'.l-status-bar',
          overlay:'.l-overlay-root'
        };
        const round=value=>Math.round(value*1000)/1000;
        const snapshot=()=>({
          geometry:Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{
            const rect=document.querySelector(selector)?.getBoundingClientRect();
            return [name,rect?{x:round(rect.x),y:round(rect.y),width:round(rect.width),height:round(rect.height)}:null];
          })),
          document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
          tokens:{
            canvas:getComputedStyle(document.body).getPropertyValue('--color-canvas').trim(),
            text:getComputedStyle(document.body).getPropertyValue('--color-text-primary').trim(),
            imageOpacity:getComputedStyle(document.body).getPropertyValue('--content-image-opacity').trim()
          }
        });
        const apply=theme=>new Promise(resolve=>{
          document.body.setAttribute('data-theme',theme);
          requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(snapshot())));
        });
        const light=await apply('light');
        const dark=await apply('dark');
        const restored=await apply('light');
        return {light,dark,restored,theme:document.body.getAttribute('data-theme')};
      })()`);
      assert.equal(result.theme, 'light');
      assert.equal(result.light.tokens.canvas, '#eef1f5');
      assert.equal(result.dark.tokens.canvas, '#0c1017');
      assert.equal(result.light.tokens.imageOpacity, '1');
      assert.equal(Number(result.dark.tokens.imageOpacity), 0.95);
      assert.notEqual(result.light.tokens.text, result.dark.tokens.text);
      assert.deepEqual(result.dark.geometry, result.light.geometry);
      assert.deepEqual(result.dark.document, result.light.document);
      assert.deepEqual(result.restored, result.light);
    });

    await test('application Theme Toggle Controller commits through Settings and Theme Service without rebuilding editor model or preview', async () => {
      await loadAppFixture(browser.page);
      const before = await browser.page.evaluate(`(()=>{
        const editor=document.getElementById('editor');
        const virtualEditor=editor?.virtualEditor||null;
        const documentText=virtualEditor?.getText?.()??null;
        const documentVersion=virtualEditor?.getDocumentVersion?.()??null;
        const preview=document.getElementById('preview');
        const previewFirst=preview?.firstElementChild||null;
        window.__themeToggleIdentity={editor,virtualEditor,documentText,documentVersion,preview,previewFirst};
        return {theme:document.body.getAttribute('data-theme'),trigger:Boolean(document.querySelector('[data-theme-toggle]'))};
      })()`);
      assert.deepEqual(before, {theme:'light',trigger:true});

      const toggle = async expected => {
        await browser.page.evaluate(`document.querySelector('[data-theme-toggle]').click()`);
        await browser.page.waitFor(`document.body.getAttribute('data-theme') === ${JSON.stringify(expected)}`, { description: 'Theme Toggle Controller apply ' + expected });
        return browser.page.evaluate(`(()=>{
          const probe=window.__themeToggleIdentity;
          return {
            theme:document.body.getAttribute('data-theme'),
            stored:localStorage.getItem('md_editor_theme'),
            sameEditor:probe.editor===document.getElementById('editor'),
            sameVirtualEditor:probe.virtualEditor===document.getElementById('editor')?.virtualEditor,
            sameDocumentText:probe.documentText===document.getElementById('editor')?.virtualEditor?.getText?.(),
            sameDocumentVersion:probe.documentVersion===document.getElementById('editor')?.virtualEditor?.getDocumentVersion?.(),
            samePreview:probe.preview===document.getElementById('preview'),
            samePreviewFirst:probe.previewFirst===document.getElementById('preview')?.firstElementChild
          };
        })()`);
      };

      const dark = await toggle('dark');
      assert.deepEqual(dark, {theme:'dark',stored:'dark',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,samePreview:true,samePreviewFirst:true});
      const light = await toggle('light');
      assert.deepEqual(light, {theme:'light',stored:'light',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,samePreview:true,samePreviewFirst:true});
      await browser.page.evaluate('delete window.__themeToggleIdentity');
    });

    await test('application Theme Service applies committed theme without rebuilding editor model or preview', async () => {
      await loadAppFixture(browser.page);
      await setAppLayout(browser.page, 'preview');
      await browser.page.waitFor(() => Boolean(document.getElementById('preview')?.firstElementChild), { timeoutMs: 10000, description: 'Theme Service preview fixture ready' });
      const before = await browser.page.evaluate(`(()=>{
        const editor=document.getElementById('editor');
        const virtualEditor=editor?.virtualEditor||null;
        const documentText=virtualEditor?.getText?.()??null;
        const documentVersion=virtualEditor?.getDocumentVersion?.()??null;
        const preview=document.getElementById('preview');
        const previewFirst=preview?.firstElementChild||null;
        window.__themeServiceIdentity={editor,virtualEditor,documentText,documentVersion,preview,previewFirst};
        return {
          theme:document.body.getAttribute('data-theme'),
          editor:Boolean(editor),virtualEditor:Boolean(virtualEditor),documentReady:typeof documentText==='string'&&Number.isInteger(documentVersion),previewFirst:Boolean(previewFirst),
          legacyThemeGlobal:typeof window.setAppTheme
        };
      })()`);
      assert.deepEqual(before, {theme:'light',editor:true,virtualEditor:true,documentReady:true,previewFirst:true,legacyThemeGlobal:'undefined'});

      const applyTheme = async theme => {
        await browser.page.evaluate(`(()=>{
          document.querySelector('[data-settings-open]')?.click();
          const field=document.getElementById('setting-theme');
          field.value=${JSON.stringify(theme)};
          field.dispatchEvent(new Event('change',{bubbles:true}));
          document.querySelector('#settings-modal .modal-footer .primary')?.click();
        })()`);
        const encodedTheme = JSON.stringify(theme);
        await browser.page.waitFor(`(()=>document.body.getAttribute('data-theme')===${encodedTheme}&&!document.getElementById('settings-modal')?.classList.contains('show'))()`, { description: 'Theme Service apply ' + theme });
        return browser.page.evaluate(`(()=>{
          const probe=window.__themeServiceIdentity;
          return {
            theme:document.body.getAttribute('data-theme'),
            sameEditor:probe.editor===document.getElementById('editor'),
            sameVirtualEditor:probe.virtualEditor===document.getElementById('editor')?.virtualEditor,
            sameDocumentText:probe.documentText===document.getElementById('editor')?.virtualEditor?.getText?.(),
            sameDocumentVersion:probe.documentVersion===document.getElementById('editor')?.virtualEditor?.getDocumentVersion?.(),
            samePreview:probe.preview===document.getElementById('preview'),
            samePreviewFirst:probe.previewFirst===document.getElementById('preview')?.firstElementChild,
            canvas:getComputedStyle(document.body).getPropertyValue('--color-canvas').trim()
          };
        })()`);
      };

      const dark = await applyTheme('dark');
      assert.deepEqual(dark, {
        theme:'dark',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,
        samePreview:true,samePreviewFirst:true,canvas:'#0c1017'
      });
      const light = await applyTheme('light');
      assert.deepEqual(light, {
        theme:'light',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,
        samePreview:true,samePreviewFirst:true,canvas:'#eef1f5'
      });
      await browser.page.evaluate('delete window.__themeServiceIdentity');
    });

    await test('application Modal Shell owns accessibility, focus, Escape, backdrop and protected progress policy', async () => {
      await browser.page.evaluate(`(()=>{
        document.getElementById('modal-shell-focus-source')?.remove();
        const source=document.createElement('button');
        source.id='modal-shell-focus-source';
        source.type='button';
        source.textContent='modal focus source';
        document.body.append(source);
        source.focus();
        document.querySelector('[data-settings-open]')?.click();
      })()`);
      await browser.page.waitFor(() => {
        const root=document.getElementById('settings-modal');
        const panel=root?.firstElementChild;
        return root?.classList.contains('show')
          && root?.getAttribute('aria-hidden')==='false'
          && panel?.contains(document.activeElement);
      }, { description: 'settings modal initial focus' });
      const opened = await browser.page.evaluate(`(()=>{
        const root=document.getElementById('settings-modal');
        const panel=root?.firstElementChild;
        return {
          role:panel?.getAttribute('role')||'',
          ariaModal:panel?.getAttribute('aria-modal')||'',
          labelledBy:panel?.getAttribute('aria-labelledby')||'',
          display:root?.style.display||''
        };
      })()`);
      assert.deepEqual(opened, {
        role: 'dialog',
        ariaModal: 'true',
        labelledBy: 'settings-title',
        display: 'flex'
      });

      await browser.page.pressKey('Escape');
      await browser.page.waitFor(() => (
        document.getElementById('settings-modal')?.style.display === 'none'
          && document.activeElement?.id === 'modal-shell-focus-source'
      ), { description: 'settings Escape close and focus restoration' });

      await browser.page.evaluate("document.querySelector('[data-settings-open]')?.click()");
      await browser.page.waitFor(() => document.getElementById('settings-modal')?.classList.contains('show'));
      await browser.page.evaluate(`(()=>{
        const root=document.getElementById('settings-modal');
        root.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      })()`);
      await browser.page.waitFor(() => (
        document.getElementById('settings-modal')?.style.display === 'none'
          && document.activeElement?.id === 'modal-shell-focus-source'
      ), { description: 'settings backdrop close and focus restoration' });

      await browser.page.evaluate(`(()=>{
        const root=document.getElementById('export-progress-modal');
        const detail={options:{initialFocus:document.getElementById('export-progress-cancel')}};
        root.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open',{detail}));
        if(detail.error)throw detail.error;
      })()`);
      await browser.page.waitFor(() => document.getElementById('export-progress-modal')?.classList.contains('show'));
      await browser.page.pressKey('Escape');
      await browser.page.evaluate(`(()=>{
        const root=document.getElementById('export-progress-modal');
        root.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      })()`);
      assert.equal(
        await browser.page.evaluate("document.getElementById('export-progress-modal')?.classList.contains('show')"),
        true
      );
      await browser.page.evaluate(`(()=>{
        const root=document.getElementById('export-progress-modal');
        const detail={reason:'browser-test'};
        root.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close',{detail}));
        if(detail.error)throw detail.error;
      })()`);
      await browser.page.waitFor(() => document.getElementById('export-progress-modal')?.style.display === 'none');
      await browser.page.evaluate(`(()=>{
        const source=document.getElementById('modal-shell-focus-source');
        if(document.activeElement===source)source.blur();
        source?.remove();
        scrollTo(0,0);
      })()`);
    });

    await test('application link preview uses scoped focus and cancels stale close completion', async () => {
      await browser.page.evaluate(`(()=>{
        document.getElementById('dom-primitive-focus-source')?.remove();
        const source=document.createElement('button');
        source.id='dom-primitive-focus-source';
        source.type='button';
        source.textContent='focus source';
        document.body.append(source);
        source.focus();
        window.markdownEditorLinkPreview.open('https://example.com/first',{sourceElement:source,source:'dom-primitive-test'});
      })()`);
      await browser.page.waitFor(() => document.activeElement?.classList.contains('link-preview-close'), { description: 'link preview initial focus' });
      await browser.page.pressKey('Tab');
      assert.equal(await browser.page.evaluate("document.activeElement?.classList.contains('link-preview-external')"), true);

      await browser.page.evaluate(`(()=>{
        const source=document.getElementById('dom-primitive-focus-source');
        window.markdownEditorLinkPreview.close('stale-close-test');
        window.markdownEditorLinkPreview.open('https://example.com/second',{sourceElement:source,source:'dom-primitive-test'});
      })()`);
      await new Promise(resolve => setTimeout(resolve, 240));
      const reopened = await browser.page.evaluate(`(()=>({
        open:window.markdownEditorLinkPreview.isOpen(),
        src:document.querySelector('.link-preview-frame')?.getAttribute('src')||'',
        focusClass:document.activeElement?.className||''
      }))()`);
      assert.equal(reopened.open, true);
      assert.match(reopened.src, /example\.com\/second/);
      assert.match(reopened.focusClass, /link-preview-close/);

      await browser.page.evaluate("window.markdownEditorLinkPreview.close('dom-primitive-test')");
      await browser.page.waitFor(() => document.activeElement?.id === 'dom-primitive-focus-source', { description: 'link preview focus restoration' });
      assert.equal(await browser.page.evaluate('window.markdownEditorLinkPreview.isOpen()'), false);
      await browser.page.evaluate(`(()=>{
        const source=document.getElementById('dom-primitive-focus-source');
        if(document.activeElement===source)source.blur();
        source?.remove();
        scrollTo(0,0);
      })()`);
    });

    await test('application Recent Files Repository and read-only Menu projection enforce limit, case-insensitive dedupe and clear', async () => {
      const result = await browser.page.evaluate(`(()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorRecentFilesPort;
        if(!port)throw new Error('Recent files write port unavailable');
        if(typeof port.load==='function'||'entries' in port)throw new Error('Recent files classic port leaked read authority');
        port.clear();
        for(let index=0;index<23;index+=1){
          const suffix=String(index).padStart(2,'0');
          port.add('C:/Notes/File-'+suffix+'.md',{name:'File '+suffix,openedAt:index+1});
        }
        port.add('c:/notes/FILE-05.md',{name:'Reopened.md',openedAt:999});
        const serialized=JSON.parse(localStorage.getItem('md_editor_recent_files')||'[]');
        const menuItems=[...document.querySelectorAll('#recent-files-menu .recent-file-item')];
        const snapshot={
          writePortKeys:Object.keys(port).sort(),
          count:serialized.length,
          first:{...serialized[0]},
          duplicateCount:serialized.filter(item=>String(item.path).toLocaleLowerCase()==='c:/notes/file-05.md').length,
          serializedKeys:Object.keys(serialized[0]||{}).sort(),
          menuCount:menuItems.length,
          menuDisabled:document.getElementById('recent-files-menu-item')?.getAttribute('aria-disabled')||'',
          menuText:document.getElementById('recent-files-menu')?.textContent||''
        };
        port.clear();
        snapshot.clearedStorage=localStorage.getItem('md_editor_recent_files');
        snapshot.clearedMenuText=document.getElementById('recent-files-menu')?.textContent||'';
        snapshot.clearedMenuItems=document.querySelectorAll('#recent-files-menu .recent-file-item').length;
        return snapshot;
      })()`);
      assert.deepEqual(result.writePortKeys, ['add', 'clear', 'destroy']);
      assert.equal(result.count, 20);
      assert.deepEqual(result.first, { path: 'c:/notes/FILE-05.md', name: 'Reopened.md', openedAt: 999 });
      assert.equal(result.duplicateCount, 1);
      assert.deepEqual(result.serializedKeys, ['name', 'openedAt', 'path']);
      assert.equal(result.menuCount, 0);
      assert.equal(result.menuDisabled, 'true');
      assert.match(result.menuText, /桌面版可用/);
      assert.equal(result.clearedStorage, '[]');
      assert.equal(result.clearedMenuItems, 0);
      assert.match(result.clearedMenuText, /桌面版可用/);
    });

    await test('application Document Session Controller keeps lifecycle model, session and UI coherent', async () => {
      const result = await browser.page.evaluate(`(async()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorDocumentControllerPort;
        if(!port)throw new Error('Document controller port unavailable');
        if(typeof applyDocumentLifecycleUi!=='function')throw new Error('Document lifecycle UI adapter unavailable');
        const metadataOnly=records=>records.every(record=>!['content','contentChunks','body','text','source','markdown'].some(key=>Object.prototype.hasOwnProperty.call(record,key)));
        const snapshot=()=>({
          activeId:port.activeId,
          modelId:String(window.markdownEditorDocumentModel?.documentId||''),
          title:document.getElementById('filename')?.value||'',
          body:window.markdownEditorDocumentModel?.createSnapshot?.('atomic-5.3-e2e')||'',
          recordCount:port.records.length,
          metadataOnly:metadataOnly(port.records)
        });
        port.initializeEmptySession({legacyRecords:port.records});
        document.getElementById('filename').value='未命名文档.md';

        const alpha=await port.newDocument({title:'Atomic Alpha.md',content:'alpha body',currentTitle:'未命名文档.md',fallbackTitle:'未命名文档.md'});
        await applyDocumentLifecycleUi(alpha);
        const alphaState=snapshot();

        const beta=await port.newDocument({title:'Atomic Beta.md',content:'beta body',currentTitle:'Atomic Alpha.md',fallbackTitle:'未命名文档.md'});
        await applyDocumentLifecycleUi(beta);
        const betaState=snapshot();

        await openDocument(alpha.record.id);
        const reopenedAlpha=snapshot();

        const originalPrompt=window.prompt;
        try{
          window.prompt=()=> 'Atomic Alpha Renamed';
          renameDocument(alpha.record.id);
        }finally{
          window.prompt=originalPrompt;
        }
        const renamedAlpha=snapshot();
        const persistencePort=host?.markdownEditorEditorUiCommandPort;
        if(!persistencePort?.has?.('saveCurrentFile'))throw new Error('Editor persistence command port unavailable');
        const savedAlpha=await persistencePort.invoke('saveCurrentFile');
        if(!savedAlpha)throw new Error('Atomic 5.3 lifecycle fixture failed to save renamed document');

        await closeDocument(alpha.record.id);
        const afterAlphaClose=snapshot();
        await closeDocument(beta.record.id);
        const emptyState=snapshot();

        return {
          alphaId:alpha.record.id,
          betaId:beta.record.id,
          alphaState,betaState,reopenedAlpha,renamedAlpha,afterAlphaClose,emptyState,
          scopedOnly:typeof window.markdownEditorDocumentControllerPort==='undefined'
        };
      })()`);
      assert.equal(result.scopedOnly, true);
      assert.deepEqual(result.alphaState, {
        activeId:result.alphaId,modelId:result.alphaId,title:'Atomic Alpha.md',body:'alpha body',recordCount:1,metadataOnly:true
      });
      assert.deepEqual(result.betaState, {
        activeId:result.betaId,modelId:result.betaId,title:'Atomic Beta.md',body:'beta body',recordCount:2,metadataOnly:true
      });
      assert.deepEqual(result.reopenedAlpha, {
        activeId:result.alphaId,modelId:result.alphaId,title:'Atomic Alpha.md',body:'alpha body',recordCount:2,metadataOnly:true
      });
      assert.deepEqual(result.renamedAlpha, {
        activeId:result.alphaId,modelId:result.alphaId,title:'Atomic Alpha Renamed.md',body:'alpha body',recordCount:2,metadataOnly:true
      });
      assert.deepEqual(result.afterAlphaClose, {
        activeId:result.betaId,modelId:result.betaId,title:'Atomic Beta.md',body:'beta body',recordCount:1,metadataOnly:true
      });
      assert.deepEqual(result.emptyState, {
        activeId:null,modelId:'',title:'未命名文档.md',body:'',recordCount:0,metadataOnly:true
      });
    });

    await test('application Editor Controller publishes model-authoritative transactions and suppresses programmatic body writes', async () => {
      const result = await browser.page.evaluate(`(()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorEditorControllerPort;
        const model=window.markdownEditorDocumentModel;
        const editor=document.getElementById('editor');
        if(!port||!model||!editor?.virtualEditor)throw new Error('Editor Controller fixture unavailable');
        const transactions=[];
        const unsubscribe=port.subscribeTransactions(transaction=>transactions.push(transaction));
        try{
          editor.virtualEditor.replaceRange('x',0,0,'end');
          const interactive={...transactions.at(-1)};
          const interactiveVersion=model.getDocumentVersion();
          port.setText('controller body');
          const programmatic={...transactions.at(-1)};
          return {
            count:transactions.length,
            interactive,
            interactiveVersion,
            programmatic,
            finalVersion:model.getDocumentVersion(),
            body:model.createSnapshot('atomic-5.8-e2e'),
            scopedOnly:typeof window.markdownEditorEditorControllerPort==='undefined'
          };
        }finally{unsubscribe();}
      })()`);
      assert.equal(result.count, 2);
      assert.equal(result.interactive.interactive, true);
      assert.equal(result.interactive.version, result.interactiveVersion);
      assert.equal(result.programmatic.interactive, false);
      assert.equal(result.programmatic.version, result.finalVersion);
      assert.equal(result.body, 'controller body');
      assert.equal(result.scopedOnly, true);
    });

    await loadAppFixture(browser.page);
    await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]') && document.querySelector('[data-hybrid-block-type="table"]')), { timeoutMs: 10000, description: 'hybrid widgets' });

    await test('application switches deterministically across every layout mode', async () => {
      for (const mode of ['both', 'hybrid', 'edit', 'preview', 'both']) {
        await setAppLayout(browser.page, mode);
        const snapshot = await appSnapshot(browser.page);
        if (mode === 'hybrid') assert.equal(snapshot.presentationMode || snapshot.layout, 'hybrid');
        if (mode === 'edit' || mode === 'both' || mode === 'preview') {
          assert.notEqual(snapshot.presentationMode, 'hybrid');
        }
      }
      await setAppLayout(browser.page, 'hybrid');
    });


    await test('compact shell keeps 860/900 hysteresis and clears resize burst state', async () => {
      await browser.page.setViewport({ width: 840, height: 700 });
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.compactShellActive === true, { description: 'compact shell enter' });
      let snapshot = await browser.page.evaluate(`(()=>{const p=document.getElementById('compatibility-business-ports').markdownEditorLayoutStatePort;return {active:p.compactShellActive,auto:p.sidebarAutoCollapsed,burst:p.windowResizeActiveUntil,cls:document.documentElement.classList.contains('is-compact-shell')}})()`);
      assert.deepEqual({ active: snapshot.active, auto: snapshot.auto, cls: snapshot.cls }, { active: true, auto: true, cls: true });
      await browser.page.setViewport({ width: 880, height: 700 });
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.windowResizeActiveUntil > performance.now(), { description: 'window resize burst gate' });
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await browser.page.evaluate("document.getElementById('compatibility-business-ports').markdownEditorLayoutStatePort.compactShellActive"), true);
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.windowResizeActiveUntil === 0, { description: 'window resize burst settled' });
      snapshot = await browser.page.evaluate(`(()=>{const p=document.getElementById('compatibility-business-ports').markdownEditorLayoutStatePort;return {started:p.windowResizeBurstStartedAt,events:p.windowResizeBurstEvents}})()`);
      assert.deepEqual(snapshot, { started: 0, events: 0 });
      await browser.page.setViewport({ width: 920, height: 700 });
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.compactShellActive === false, { description: 'compact shell hysteresis exit' });
      snapshot = await browser.page.evaluate(`(()=>{const p=document.getElementById('compatibility-business-ports').markdownEditorLayoutStatePort;return {active:p.compactShellActive,auto:p.sidebarAutoCollapsed,cls:document.documentElement.classList.contains('is-compact-shell')}})()`);
      assert.deepEqual(snapshot, { active: false, auto: false, cls: false });
    });

    await test('application toolbar boundary wraps from measured content width without hiding tools', async () => {
      await browser.page.setViewport({ width: 1800, height: 900 });
      await browser.page.waitFor(() => window.innerWidth === 1800 && !document.documentElement.classList.contains('is-compact-shell'), { description: 'wide toolbar viewport' });
      const before = await browser.page.evaluate(`(()=>{
        const toolbar=document.querySelector('.editor-toolbar');
        const format=toolbar?.querySelector('.format-group');
        const actions=toolbar?.querySelector('.editor-actions');
        if(!toolbar||!format||!actions)throw new Error('Toolbar Boundary fixture unavailable');
        const style=getComputedStyle(toolbar);
        const padding=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
        const gap=parseFloat(style.columnGap||style.gap)||0;
        const required=Math.ceil(format.scrollWidth+actions.scrollWidth+gap);
        const hidden=Array.from(toolbar.querySelectorAll('[data-toolbar-item]')).map(item=>[item.dataset.toolbarItem,item.classList.contains('toolbar-item-hidden')]);
        return {wrapped:toolbar.classList.contains('toolbar-boundary-wrap'),width:toolbar.clientWidth,padding,required,hidden};
      })()`);
      assert.equal(before.wrapped, false, JSON.stringify(before));
      const targetWidth = Math.max(260, Math.min(620, Math.floor(before.required + before.padding - 24)));
      assert.ok(targetWidth < before.required + before.padding, JSON.stringify({before,targetWidth}));
      try {
        await browser.page.evaluate(`(()=>{
          const target=${JSON.stringify(targetWidth)};
          const toolbar=document.querySelector('.editor-toolbar');
          toolbar.style.width=target+'px';
          toolbar.style.maxWidth=target+'px';
          toolbar.style.boxSizing='border-box';
          toolbar.style.alignSelf='flex-start';
        })()`);
        await browser.page.waitFor(() => document.querySelector('.editor-toolbar')?.classList.contains('toolbar-boundary-wrap') === true, { description: 'content-width toolbar wrapping' });
        const wrapped = await browser.page.evaluate(`(()=>{
          const toolbar=document.querySelector('.editor-toolbar');
          const format=toolbar.querySelector('.format-group');
          const actions=toolbar.querySelector('.editor-actions');
          const formatRect=format.getBoundingClientRect();
          const actionsRect=actions.getBoundingClientRect();
          return {
            width:toolbar.clientWidth,
            wrapped:toolbar.classList.contains('toolbar-boundary-wrap'),
            twoRows:actionsRect.top>=formatRect.bottom-1,
            hidden:Array.from(toolbar.querySelectorAll('[data-toolbar-item]')).map(item=>[item.dataset.toolbarItem,item.classList.contains('toolbar-item-hidden')])
          };
        })()`);
        assert.equal(wrapped.wrapped, true, JSON.stringify(wrapped));
        assert.ok(wrapped.width <= targetWidth + 1, JSON.stringify({wrapped,targetWidth}));
        assert.equal(wrapped.twoRows, true, JSON.stringify(wrapped));
        assert.deepEqual(wrapped.hidden, before.hidden, 'responsive boundary must not hide toolbar tools');
      } finally {
        await browser.page.evaluate(`(()=>{
          const toolbar=document.querySelector('.editor-toolbar');
          if(!toolbar)return;
          toolbar.style.removeProperty('width');
          toolbar.style.removeProperty('max-width');
          toolbar.style.removeProperty('box-sizing');
          toolbar.style.removeProperty('align-self');
        })()`);
      }
      await browser.page.waitFor(() => document.querySelector('.editor-toolbar')?.classList.contains('toolbar-boundary-wrap') === false, { description: 'wide toolbar unwrap restoration' });
      const restored = await browser.page.evaluate(`(()=>({
        hidden:Array.from(document.querySelectorAll('.editor-toolbar [data-toolbar-item]')).map(item=>[item.dataset.toolbarItem,item.classList.contains('toolbar-item-hidden')])
      }))()`);
      assert.deepEqual(restored.hidden, before.hidden);
      await browser.page.setViewport({ width: 1440, height: 1000 });
      await browser.page.waitFor(() => window.innerWidth === 1440 && window.innerHeight === 1000, { description: 'restore toolbar test viewport' });
    });

    await test('application page fullscreen uses the Stage 6.6 controller without changing command IDs', async () => {
      await browser.page.setViewport({ width: 1440, height: 1000 });
      const before = await browser.page.evaluate(`(()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorEditorUiCommandPort;
        const layout=host?.markdownEditorLayoutStatePort;
        if(!port||!layout)throw new Error('Atomic 6.6 fullscreen ports unavailable');
        localStorage.setItem('md_editor_page_fullscreen','false');
        return {
          active:layout.pageFullscreen,
          app:document.querySelector('.app')?.classList.contains('is-page-fullscreen')||false,
          body:document.body.classList.contains('is-page-fullscreen-active')
        };
      })()`);
      if (before.active) {
        await browser.page.evaluate(`document.getElementById('compatibility-business-ports').markdownEditorEditorUiCommandPort.invoke('togglePageFullscreen')`);
      }
      await browser.page.evaluate(`document.getElementById('compatibility-business-ports').markdownEditorEditorUiCommandPort.invoke('togglePageFullscreen')`);
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.pageFullscreen === true, { description: 'page fullscreen enter' });
      let snapshot = await browser.page.evaluate(`(()=>({
        state:document.getElementById('compatibility-business-ports').markdownEditorLayoutStatePort.pageFullscreen,
        appLegacy:document.querySelector('.app').classList.contains('page-fullscreen'),
        appCurrent:document.querySelector('.app').classList.contains('is-page-fullscreen'),
        bodyLegacy:document.body.classList.contains('page-fullscreen-active'),
        bodyCurrent:document.body.classList.contains('is-page-fullscreen-active'),
        persisted:localStorage.getItem('md_editor_page_fullscreen')
      }))()`);
      assert.deepEqual(snapshot, { state:true, appLegacy:true, appCurrent:true, bodyLegacy:true, bodyCurrent:true, persisted:'true' });
      await browser.page.evaluate(`document.getElementById('compatibility-business-ports').markdownEditorEditorUiCommandPort.invoke('togglePageFullscreen')`);
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.pageFullscreen === false, { description: 'page fullscreen exit' });
      snapshot = await browser.page.evaluate(`(()=>({
        state:document.getElementById('compatibility-business-ports').markdownEditorLayoutStatePort.pageFullscreen,
        app:document.querySelector('.app').classList.contains('is-page-fullscreen'),
        body:document.body.classList.contains('is-page-fullscreen-active'),
        persisted:localStorage.getItem('md_editor_page_fullscreen')
      }))()`);
      assert.deepEqual(snapshot, { state:false, app:false, body:false, persisted:'false' });
    });

    await test('application sidebar tabs switch one mount region and coordinate child lifecycles', async () => {
      await loadAppFixture(browser.page);
      const result = await browser.page.evaluate(`(async()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorSidebarControllerPort;
        const tree=host?.markdownEditorFolderTreeControllerPort;
        if(!port||!tree)throw new Error('Sidebar/Folder Tree runtime unavailable');
        const states=[];
        const panelState=()=>['docs','files','outline'].filter(name=>document.getElementById('sidebar-'+name+'-panel')?.classList.contains('active'));
        const tabState=()=>['docs','files','outline'].filter(name=>document.getElementById('sidebar-'+name+'-tab')?.classList.contains('active'));
        const docsBefore=document.getElementById('document-list')?.childElementCount??-1;
        document.getElementById('sidebar-files-tab').click();
        await Promise.resolve();
        states.push(tree.snapshot.active);
        const files={active:port.activeTab,panels:panelState(),tabs:tabState(),stored:localStorage.getItem('md_editor_sidebar_tab'),treeActive:tree.snapshot.active};
        document.getElementById('sidebar-outline-tab').click();
        await Promise.resolve();
        states.push(tree.snapshot.active);
        const outline={active:port.activeTab,panels:panelState(),tabs:tabState(),stored:localStorage.getItem('md_editor_sidebar_tab'),items:document.getElementById('outline-list')?.children.length??0,treeActive:tree.snapshot.active};
        document.getElementById('sidebar-docs-tab').click();
        await Promise.resolve();
        const docs={active:port.activeTab,panels:panelState(),tabs:tabState(),stored:localStorage.getItem('md_editor_sidebar_tab'),count:document.getElementById('document-list')?.childElementCount??-1};
        states.push(tree.snapshot.active);
        return {files,outline,docs,docsBefore,states,legacyGlobal:typeof window.setSidebarTab,legacyTreeGlobal:typeof window.markdownEditorFileTree};
      })()`);
      assert.deepEqual(result.files, {active:'files',panels:['files'],tabs:['files'],stored:'files',treeActive:true});
      assert.equal(result.outline.active, 'outline');
      assert.deepEqual(result.outline.panels, ['outline']);
      assert.deepEqual(result.outline.tabs, ['outline']);
      assert.equal(result.outline.stored, 'outline');
      assert.equal(result.outline.treeActive, false);
      assert.ok(result.outline.items > 0, 'outline activation should request the existing Outline renderer');
      assert.deepEqual(result.docs, {active:'docs',panels:['docs'],tabs:['docs'],stored:'docs',count:result.docsBefore});
      assert.deepEqual(result.states, [true, false, false]);
      assert.equal(result.legacyGlobal, 'undefined');
      assert.equal(result.legacyTreeGlobal, 'undefined');
    });

    await test('application Outline uses indexed headings, persists collapse, tracks active heading, and navigates source', async () => {
      await loadAppFixture(browser.page);
      const source = '# Root\nroot body\n## Child\nchild body\n### Grand\ngrand body\n# Next\nnext body\n';
      await browser.page.evaluate(`window.__markdownEditorE2E.loadMarkdown(${JSON.stringify(source)},{layout:'both',focusText:'child body'})`);
      await browser.page.evaluate(`document.getElementById('sidebar-outline-tab').click()`);
      await browser.page.waitFor(() => {
        const host=document.getElementById('compatibility-business-ports');
        return host?.markdownEditorOutlineControllerPort?.snapshot?.headings?.length===4
          && document.querySelectorAll('#outline-list .outline-node').length===4;
      }, { description: 'Atomic 6.8 indexed Outline tree' });

      const initial = await browser.page.evaluate(`(()=>{
        const host=document.getElementById('compatibility-business-ports');
        const port=host?.markdownEditorOutlineControllerPort;
        const serialize=node=>({
          id:node.dataset.outlineId||'',
          level:Number(node.dataset.outlineLevel||0),
          text:node.querySelector(':scope > .outline-row .outline-link')?.textContent?.trim()||'',
          children:Array.from(node.querySelectorAll(':scope > .outline-children > .outline-node')).map(serialize)
        });
        const root=document.querySelector('#outline-list > .outline-tree');
        const editor=document.getElementById('editor');
        return {
          tree:Array.from(root?.children||[]).map(serialize),
          activeText:document.querySelector('#outline-list .outline-row.active .outline-link')?.textContent?.trim()||'',
          activeLine:editor?.virtualEditor?.getLineNumberAtPosition?.(editor.selectionStart)||0,
          headings:port?.snapshot?.headings?.map(item=>({id:item.id,level:item.level,text:item.text,line:item.line}))||[],
          legacy:{
            renderOutline:typeof window.renderOutline,
            getMarkdownHeadings:typeof window.getMarkdownHeadings,
            jumpToLine:typeof window.jumpToLine
          }
        };
      })()`);
      assert.deepEqual(initial.tree.map(node=>({text:node.text,level:node.level,children:node.children.map(child=>({text:child.text,level:child.level,children:child.children.map(grand=>({text:grand.text,level:grand.level}))}))})), [
        {text:'Root',level:1,children:[{text:'Child',level:2,children:[{text:'Grand',level:3}]}]},
        {text:'Next',level:1,children:[]}
      ]);
      assert.deepEqual(initial.headings.map(({level,text,line})=>({level,text,line})), [
        {level:1,text:'Root',line:1},
        {level:2,text:'Child',line:3},
        {level:3,text:'Grand',line:5},
        {level:1,text:'Next',line:7}
      ]);
      assert.equal(initial.activeText, 'Child');
      assert.equal(initial.activeLine, 4);
      assert.deepEqual(initial.legacy, {renderOutline:'undefined',getMarkdownHeadings:'undefined',jumpToLine:'undefined'});

      const rootId = initial.headings[0].id;
      await browser.page.evaluate(`(()=>{
        const id=${JSON.stringify(rootId)};
        const node=Array.from(document.querySelectorAll('#outline-list .outline-node')).find(item=>item.dataset.outlineId===id);
        const toggle=node?.querySelector(':scope > .outline-row .outline-toggle');
        if(!toggle)throw new Error('Atomic 6.8 Root Outline toggle unavailable');
        toggle.click();
      })()`);
      await browser.page.waitFor(() => {
        const persisted=JSON.parse(localStorage.getItem('md_editor_outline_collapsed')||'{}');
        const node=document.querySelector('#outline-list > .outline-tree > .outline-node');
        return Object.values(persisted).some(value=>value===true)
          && node?.classList.contains('is-collapsed')
          && node.querySelector(':scope > .outline-children')?.classList.contains('collapsed');
      }, { description: 'Atomic 6.8 Outline collapse persisted' });

      await browser.page.evaluate(`document.getElementById('sidebar-docs-tab').click()`);
      await browser.page.evaluate(`document.getElementById('sidebar-outline-tab').click()`);
      await browser.page.waitFor(() => document.querySelector('#outline-list > .outline-tree > .outline-node')?.classList.contains('is-collapsed')===true, {
        description: 'Atomic 6.8 Outline collapse restored after lifecycle resume'
      });

      await browser.page.evaluate(`(()=>{
        const link=Array.from(document.querySelectorAll('#outline-list .outline-link')).find(item=>item.textContent?.trim()==='Next');
        if(!link)throw new Error('Atomic 6.8 Next Outline link unavailable');
        link.click();
      })()`);
      await browser.page.waitFor(() => {
        const editor=document.getElementById('editor');
        return editor?.virtualEditor?.getLineNumberAtPosition?.(editor.selectionStart)===7
          && document.querySelector('#outline-list .outline-row.active .outline-link')?.textContent?.trim()==='Next';
      }, { description: 'Atomic 6.8 Outline heading navigation' });
      const final = await browser.page.evaluate(`(()=>({
        line:document.getElementById('editor')?.virtualEditor?.getLineNumberAtPosition?.(document.getElementById('editor')?.selectionStart)||0,
        active:document.querySelector('#outline-list .outline-row.active .outline-link')?.textContent?.trim()||'',
        persisted:JSON.parse(localStorage.getItem('md_editor_outline_collapsed')||'{}')
      }))()`);
      assert.equal(final.line, 7);
      assert.equal(final.active, 'Next');
      assert.equal(final.persisted[rootId], true);
    });

    await test('application shell has no structural overflow or clipped focus across required viewports', async () => {
      const report = [];
      try {
        await browser.page.setViewport({ width: 1200, height: 720 });
        await browser.page.waitFor(() => !document.documentElement.classList.contains('is-compact-shell'), {
          description: 'wide shell before responsive verification'
        });
        await setAppLayout(browser.page, 'both');
        await browser.page.evaluate(`(()=>{
          const sidebar=document.querySelector('.l-sidebar');
          if(sidebar?.classList.contains('is-hidden')) toggleSidebar();
        })()`);
        for (const viewport of RESPONSIVE_SHELL_VIEWPORTS) {
          await applyResponsiveViewport(browser.page, viewport);
          report.push(await inspectResponsiveShell(browser.page, viewport));
        }
        await writeFile(join(artifactRoot, 'responsive-shell-report.json'), `${JSON.stringify(report, null, 2)}\n`);
        for (const snapshot of report) {
          const context = JSON.stringify(snapshot);
          assert.deepEqual(snapshot.actualViewport, {
            width: snapshot.viewport.width,
            height: snapshot.viewport.height
          }, context);
          assert.equal(snapshot.document.scrollWidth <= snapshot.viewport.width + 1, true, context);
          assert.equal(snapshot.document.bodyScrollWidth <= snapshot.viewport.width + 1, true, context);
          assert.equal(snapshot.states.compact, snapshot.viewport.compact, context);
          assert.equal(snapshot.states.sidebarHidden, snapshot.viewport.compact, context);
          if (snapshot.viewport.width <= 768) {
            assert.equal(snapshot.states.toolbarWrapped, true, context);
            assert.equal(snapshot.regions.main.flexDirection, 'column', context);
          } else {
            assert.equal(snapshot.regions.main.flexDirection, 'row', context);
          }
          assert.equal(snapshot.regions.shell.rect.height, snapshot.viewport.height, context);
          assert.ok(snapshot.regions.workspace.rect.height >= 80, context);
          assert.ok(snapshot.regions.main.rect.width > 0 && snapshot.regions.main.rect.height >= 48, context);
          assert.ok(snapshot.focusableCount > 0, context);
          assert.deepEqual(snapshot.viewportIssues, [], context);
          assert.deepEqual(snapshot.focusIssues, [], context);
        }
      } finally {
        await browser.page.setViewport({ width: 1440, height: 1000 });
        await browser.page.waitFor(() => window.innerWidth === 1440 && window.innerHeight === 1000, {
          description: 'restore default application viewport'
        });
        await setAppLayout(browser.page, 'hybrid');
      }
    });

    await test('application code block placeholder never receives a phantom source highlight', async () => {
      const source = '```\n\n\n```\n\n';
      await browser.page.evaluate(`window.__markdownEditorE2E.loadMarkdown(${JSON.stringify(source)},{layout:'hybrid',selection:${source.length},codeVisualEditing:true,tableVisualEditing:true})`);
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'closed code widget' });
      const trailingPoint = await browser.page.evaluate(`(()=>{
        const editor=document.getElementById('editor');
        const virtualEditor=editor?.virtualEditor;
        const position=editor?.textLength;
        if(!virtualEditor||!Number.isInteger(position))return null;
        virtualEditor.scrollPositionIntoView(position,'auto',0.5);
        const rect=virtualEditor.getPositionCoordinates?.(position,1)||virtualEditor.getPositionCoordinates?.(position,-1);
        if(!rect)return null;
        return {
          x:Math.max(2,rect.left+2),
          y:rect.top+Math.max(1,rect.bottom-rect.top)/2,
          position
        };
      })()`);
      if (!trailingPoint) throw new Error('Unable to resolve final document caret point');
      await browser.page.clickAt(trailingPoint.x, trailingPoint.y);
      await browser.page.waitFor(() => {
        const editor=document.getElementById('editor');
        return editor?.selectionStart===editor?.textLength
          && editor?.selectionEnd===editor?.textLength
          && editor?.virtualEditor?.getPresentationStats?.().sourceActiveLines===1;
      }, { description: 'trailing source active line' });
      const snapshot = await browser.page.evaluate(`(()=>{
        const widget=document.querySelector('[data-hybrid-block-type="code"]');
        const widgetRect=widget?.getBoundingClientRect();
        const active=Array.from(document.querySelectorAll('.cm-hybrid-source-active')).map(element=>{const rect=element.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,text:element.textContent||''};});
        return {widgetTop:widgetRect?.top||0,widgetBottom:widgetRect?.bottom||0,active,presentation:document.getElementById('editor')?.virtualEditor?.getPresentationStats?.()||{}};
      })()`);
      assert.equal(snapshot.presentation.codeBlocks, 1);
      assert.equal(snapshot.active.length, 1);
      assert.ok(snapshot.active.every(line => line.top >= snapshot.widgetBottom - 1), JSON.stringify(snapshot));    });

    await test('application code block ignores single click and opens on strict double click', async () => {
      await loadAppFixture(browser.page);
      await browser.page.click('[data-hybrid-block-type="code"] .cm-hybrid-code-body');
      assert.equal(await browser.page.evaluate('Boolean(document.querySelector("[data-hybrid-code-editor]"))'), false);
      await browser.page.click('[data-hybrid-block-type="code"] .cm-hybrid-code-body', { count: 2, intervalMs: 90 });
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-code-editor]')), { description: 'code editor open' });
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
      await browser.page.clickAt(outside.x + 2, outside.y);
      await browser.page.waitFor(() => !document.querySelector('[data-hybrid-code-editor]'), { description: 'code editor close' });
    });

    await test('application keeps only one direct editor active', async () => {
      await loadAppFixture(browser.page);
      await browser.page.click('[data-hybrid-block-type="code"] .cm-hybrid-code-body', { count: 2 });
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-code-editor]')));
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
      await browser.page.clickAt(outside.x + 2, outside.y);
      await browser.page.waitFor(() => !document.querySelector('[data-hybrid-code-editor]'));
      await browser.page.click('[data-hybrid-block-type="table"] td', { count: 2 });
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-table-cell-input]')));
      assert.equal(await browser.page.evaluate('Boolean(document.querySelector("[data-hybrid-code-editor]"))'), false);
      await browser.page.clickAt(outside.x + 2, outside.y);
      await browser.page.waitFor(() => !document.querySelector('[data-hybrid-table-cell-input]'));
    });

    await test('application Hybrid table pointer input avoids block decoration dispatch races', async () => {
      await loadAppFixture(browser.page);
      await setAppLayout(browser.page, 'hybrid');
      await browser.page.evaluate(`(()=>{
        window.__hybridDispatchRaceErrors=[];
        window.addEventListener('error',event=>{
          const message=String(event?.message||event?.error?.message||'');
          if(/Cannot read properties of null.*dom|block-dispatch-failure/i.test(message)){
            window.__hybridDispatchRaceErrors.push(message);
          }
        });
        const perf=window.markdownEditorPerf;
        if(perf&&typeof perf.diagnostic==='function'){
          const original=perf.diagnostic.bind(perf);
          perf.diagnostic=(operation,options={})=>{
            if(operation==='hybrid.block-dispatch-failure'){
              window.__hybridDispatchRaceErrors.push(String(options?.details?.message||operation));
            }
            return original(operation,options);
          };
        }
      })()`);
      const beforeLength = await browser.page.evaluate('document.getElementById("editor")?.textLength || 0');
      for (let index = 0; index < 4; index += 1) {
        await browser.page.click('[data-hybrid-block-type="table"] td');
        const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
        await browser.page.clickAt(outside.x + 2, outside.y);
        await browser.page.evaluate(`(()=>{
          const editor=document.getElementById('editor');
          const virtualEditor=editor?.virtualEditor;
          const selection=virtualEditor?.getSelection?.();
          if(!virtualEditor||!selection)throw new Error('Virtual editor selection is unavailable');
          virtualEditor.replaceRange('x',selection.head,selection.head,'end');
        })()`);
        await browser.page.evaluate('new Promise(resolve=>queueMicrotask(resolve))');
      }
      await browser.page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,160))))');
      const result = await browser.page.evaluate(`(()=>({
        errors:window.__hybridDispatchRaceErrors||[],
        textLength:document.getElementById('editor')?.textLength||0
      }))()`);
      assert.deepEqual(result.errors, []);
      assert.equal(result.textLength, beforeLength + 4);
    });

    await test('application Mermaid presentation stays normalized across hybrid and preview layouts', async () => {
      await loadAppFixture(browser.page);
      await setAppLayout(browser.page, 'hybrid');
      await browser.page.evaluate(`window.__markdownEditorE2E.revealText('flowchart LR',{preserveSelection:true})`);
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type=\"mermaid\"] svg')), { timeoutMs: 10000, description: 'hybrid Mermaid SVG' });
      const inspectMermaid = `selector=>{const svg=document.querySelector(selector);const style=svg?getComputedStyle(svg):null;return {role:svg?.getAttribute('role'),label:svg?.getAttribute('aria-label'),className:svg?.getAttribute('class')||'',heightAttribute:svg?.getAttribute('height'),inlineStyle:svg?.getAttribute('style'),maxWidth:style?.maxWidth||'',backgroundColor:style?.backgroundColor||''}}`;
      const hybrid = await browser.page.evaluate(`(${inspectMermaid})('[data-hybrid-block-type=\"mermaid\"] svg')`);
      await setAppLayout(browser.page, 'preview');
      await browser.page.waitFor(() => Boolean(document.querySelector('.preview-pane .mermaid svg')), { timeoutMs: 10000, description: 'preview Mermaid SVG' });
      const previewResult = await browser.page.evaluate(`(${inspectMermaid})('.preview-pane .mermaid svg')`);
      assert.deepEqual(previewResult, hybrid);
      assert.match(hybrid.className, /(?:^|\s)f-mermaid-svg(?:\s|$)/);
      assert.equal(hybrid.heightAttribute, null);
      assert.equal(hybrid.inlineStyle, null);
      assert.equal(hybrid.maxWidth, '100%');
      assert.equal(hybrid.backgroundColor, 'rgba(0, 0, 0, 0)');
      await setAppLayout(browser.page, 'hybrid');
    });

    await test('application source edit exits when pointer moves outside the source range', async () => {
      await loadAppFixture(browser.page);
      const point = await centerByText(browser.page, '[data-hybrid-block-type="code"]', '编辑源码');
      await browser.page.clickAt(point.x, point.y);
      await browser.page.waitFor(() => !document.querySelector('[data-hybrid-block-type="code"]') && document.getElementById('editor')?.selectionEnd > document.getElementById('editor')?.selectionStart, { description: 'source range open' });
      const selectedSource = await browser.page.evaluate(`(()=>{const editor=document.getElementById('editor');return editor.value.slice(editor.selectionStart,editor.selectionEnd)})()`);
      assert.match(selectedSource, /plain code/);
      await browser.page.evaluate(`window.__markdownEditorE2E.revealText('selection alpha',{preserveSelection:true})`);
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
      await browser.page.clickAt(outside.x + 2, outside.y);
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'source range close' });
    });

    await test('application split controllers drag, collapse and preserve compact hysteresis in the built app', async () => {
      await browser.page.setViewport({ width: 1440, height: 1000 });
      await browser.page.waitFor(() => window.innerWidth === 1440, { description: 'wide split viewport' });
      await browser.page.evaluate(`(()=>{ setLayoutMode('both', false, false); })()`);
      await browser.page.waitFor(() => {
        const handle=document.getElementById('resizer');
        return Boolean(handle && !handle.classList.contains('is-hidden') && handle.getBoundingClientRect().width > 0);
      }, { description: 'visible split handle' });
      const before=await browser.page.evaluate(`(()=>{
        const handle=document.getElementById('resizer'); const rect=handle.getBoundingClientRect();
        const host=document.getElementById('compatibility-business-ports');
        return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,ratio:host.markdownEditorLayoutStatePort.editorRatio};
      })()`);
      await browser.page.drag({ x: before.x, y: before.y }, { x: before.x + 120, y: before.y }, { steps: 12 });
      const dragged=await browser.page.evaluate(`(()=>{
        const host=document.getElementById('compatibility-business-ports');
        return {
          ratio:host.markdownEditorLayoutStatePort.editorRatio,
          stored:Number(localStorage.getItem('md_editor_ratio')),
          aria:document.getElementById('resizer')?.getAttribute('aria-valuenow')||'',
          active:host.markdownEditorLayoutStatePort.isResizing
        };
      })()`);
      assert.ok(dragged.ratio > before.ratio);
      assert.equal(Math.abs(dragged.stored-dragged.ratio) < 0.0001, true);
      assert.equal(dragged.active, false);
      assert.ok(Number(dragged.aria) >= 15 && Number(dragged.aria) <= 85);

      await browser.page.click('#preview-collapse-btn');
      await browser.page.waitFor(() => document.querySelector('.preview-pane')?.classList.contains('is-collapsed'), { description: 'preview collapsed' });
      let collapsed=await browser.page.evaluate(`(()=>({
        editor:document.querySelector('.editor-pane')?.classList.contains('is-collapsed'),
        preview:document.querySelector('.preview-pane')?.classList.contains('is-collapsed'),
        resizer:document.getElementById('resizer')?.classList.contains('is-hidden')
      }))()`);
      assert.deepEqual(collapsed,{editor:false,preview:true,resizer:true});
      await browser.page.waitForElementStable('#preview-collapse-btn', { description: 'preview collapse button after collapse' });
      await browser.page.click('#preview-collapse-btn');
      await browser.page.waitFor(() => !document.querySelector('.preview-pane')?.classList.contains('is-collapsed'), { description: 'preview expanded' });

      await browser.page.evaluate(`(()=>{
        const main=document.querySelector('.main'); main.style.flex='0 0 710px'; main.style.width='710px';
      })()`);
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.compactSplitActive === true, { description: 'compact split enter' });
      await browser.page.evaluate(`(()=>{const main=document.querySelector('.main');main.style.flex='0 0 740px';main.style.width='740px';})()`);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await browser.page.evaluate("document.getElementById('compatibility-business-ports').markdownEditorLayoutStatePort.compactSplitActive"), true);
      await browser.page.evaluate(`(()=>{const main=document.querySelector('.main');main.style.flex='0 0 780px';main.style.width='780px';})()`);
      await browser.page.waitFor(() => document.getElementById('compatibility-business-ports')?.markdownEditorLayoutStatePort?.compactSplitActive === false, { description: 'compact split hysteresis exit' });
      collapsed=await browser.page.evaluate(`(()=>({
        editor:document.querySelector('.editor-pane')?.classList.contains('is-collapsed'),
        preview:document.querySelector('.preview-pane')?.classList.contains('is-collapsed')
      }))()`);
      assert.deepEqual(collapsed,{editor:false,preview:false});
      await browser.page.evaluate(`(()=>{const main=document.querySelector('.main');main.style.removeProperty('flex');main.style.removeProperty('width');})()`);
    });

    await test('application sidebar resize captures pointer, projects width and persists the final width', async () => {
      await browser.page.setViewport({ width: 1440, height: 1000 });
      await browser.page.waitFor(() => window.innerWidth === 1440 && window.innerHeight === 1000, {
        description: 'wide viewport for sidebar resize'
      });
      await browser.page.evaluate(`(()=>{
        const sidebar=document.querySelector('.l-sidebar');
        if(sidebar?.classList.contains('is-hidden')) toggleSidebar();
      })()`);
      await browser.page.waitFor(() => {
        const handle=document.getElementById('sidebar-resizer');
        return Boolean(handle && !handle.classList.contains('is-hidden') && handle.getBoundingClientRect().height > 0);
      }, { description: 'visible sidebar resize handle' });
      const before = await browser.page.evaluate(`(()=>{
        const handle=document.getElementById('sidebar-resizer');
        const rect=handle.getBoundingClientRect();
        const width=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
        return {
          x:rect.left+Math.max(1,rect.width/2),
          y:rect.top+Math.max(1,rect.height/2),
          width,
          stored:localStorage.getItem('md_editor_sidebar_width')
        };
      })()`);
      assert.ok(Number.isFinite(before.width) && before.width >= 180 && before.width <= 520, JSON.stringify(before));
      const delta = before.width >= 320 ? -72 : 72;
      await browser.page.drag(
        { x: before.x, y: before.y },
        { x: before.x + delta, y: before.y },
        { steps: 12 }
      );
      await browser.page.evaluate('window.__atomic62SidebarBaselineWidth=' + JSON.stringify(before.width));
      await browser.page.waitFor(() => {
        const handle=document.getElementById('sidebar-resizer');
        const css=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
        const stored=Number.parseFloat(localStorage.getItem('md_editor_sidebar_width'));
        const aria=Number.parseFloat(handle?.getAttribute('aria-valuenow')||'');
        return Number.isFinite(css) && Number.isFinite(stored) && Number.isFinite(aria)
          && css===stored && css===aria && Math.abs(css-Number(window.__atomic62SidebarBaselineWidth))>=20
          && !document.body.classList.contains('sidebar-resizing')
          && !document.body.classList.contains('is-sidebar-resizing');
      }, { description: 'persisted sidebar width after pointer drag' });
      const after = await browser.page.evaluate(`(()=>{
        const handle=document.getElementById('sidebar-resizer');
        return {
          width:Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')),
          stored:Number.parseFloat(localStorage.getItem('md_editor_sidebar_width')),
          aria:Number.parseFloat(handle?.getAttribute('aria-valuenow')||''),
          dragging:Boolean(handle?.classList.contains('is-dragging')),
          bodyResizing:document.body.classList.contains('is-sidebar-resizing')
        };
      })()`);
      assert.equal(after.width, after.stored);
      assert.equal(after.width, after.aria);
      assert.equal(after.dragging, false);
      assert.equal(after.bodyResizing, false);
      assert.ok(after.width >= 180 && after.width <= 520, JSON.stringify(after));
      await browser.page.evaluate('delete window.__atomic62SidebarBaselineWidth');
      await browser.page.evaluate(`(()=>{
        const value=${JSON.stringify(before.stored)};
        if(value===null) localStorage.removeItem('md_editor_sidebar_width');
        else localStorage.setItem('md_editor_sidebar_width', value);
      })()`);
    });

    await test('application pointer drag maps to exact editor characters', async () => {
      await loadAppFixture(browser.page);
      await setAppLayout(browser.page, 'edit');
      await browser.page.evaluate(`(()=>{const editor=document.getElementById('editor'); const position=editor.value.indexOf('selection alpha'); editor.setSelectionRange(position,position); editor.virtualEditor.scrollPositionIntoView(position);})()`);
      await new Promise(resolve => setTimeout(resolve, 250));
      const lineSelector = '.cm-line';
      const start = await getTextBoundary(browser.page, lineSelector, 'alpha', 'start', 'selection alpha');
      const end = await getTextBoundary(browser.page, lineSelector, 'beta', 'end', 'selection alpha');
      await browser.page.drag({ x: start.x + 1, y: start.y }, { x: end.x - 1, y: end.y }, { steps: 18 });
      const snapshot = await appSnapshot(browser.page);
      assert.equal(snapshot.selectedText.trim(), 'alpha beta');
      await setAppLayout(browser.page, 'hybrid');
    });

    if (browser.page.exceptions.length) {
      throw new Error(`Browser exceptions detected: ${JSON.stringify(browser.page.exceptions.slice(0, 3))}`);
    }
  } finally {
    activePage = null;
    await virtualHost?.close();
    await browser.close();
  }
}

console.log(`Browser artifacts: ${artifactRoot}`);
if (runContract) await runContractSuite();
if (runApp) await runAppSuite();

const failed = results.filter(result => !result.ok);
console.log(`\nBrowser tests: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`);
if (!failed.length && !process.env.E2E_ARTIFACT_DIR) await rm(artifactRoot, { recursive: true, force: true });
if (failed.length) process.exitCode = 1;
