import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';
import { verifyBuiltApplication } from './lib/built-application-check.mjs';
import { runExportCharacterization } from './lib/export-characterization.mjs';
import { runE2EInstallationChecks } from './lib/e2e-installation.mjs';
import { evaluateApplication, waitForApplication, releaseApplicationInspector } from './lib/application-inspector.mjs';
import { createApplicationDriver } from './lib/application-driver.mjs';

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
    const roots=Array.from(document.querySelectorAll(rootSelector));
    const element=roots.flatMap(root=>[root,...root.querySelectorAll('button,[role="button"]')])
      .find(item=>item.textContent.trim()===text&&item.getBoundingClientRect().width>0&&item.getBoundingClientRect().height>0);
    if(!element)return null; const rect=element.getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
  })()`);
  if (!point) throw new Error(`Button not found: ${rootSelector} / ${text}`);
  return point;
}

async function runContractSuite() {
  // The contract host serves source ESM without Vite. Resolve the same installed
  // package as production and embed its ESM bytes; never expose parent directories.
  const purifierSource = await readFile(new URL(import.meta.resolve('dompurify')));
  const importMap = JSON.stringify({ imports: {
    dompurify: `data:text/javascript;base64,${purifierSource.toString('base64')}`
  } });
  const setContractDocument = html => browser.page.setDocumentContent(
    html.replace('<head>', `<head><script type="importmap">${importMap}</script>`)
  );
  const browser = await launchChromium();
  const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });
  activePage = browser.page;
  try {
    let harnessHtml = await readFile(resolve(projectRoot, 'tests/e2e/fixtures/interaction-harness.html'), 'utf8');
    harnessHtml = harnessHtml
      .replace('<head>', `<head><base href="${virtualHost.origin}/tests/e2e/fixtures/">`)
      .replace(/<script type="module" src="\.\/interaction-harness\.js"><\/script>/, '');
    await setContractDocument(harnessHtml);
    await browser.page.evaluate(`import('${virtualHost.origin}/tests/e2e/fixtures/interaction-harness.js').then(()=>true)`);
    await browser.page.waitFor(() => window.__interactionHarness?.ready === true, { description: 'interaction harness' });

    await test('source ESM uses locked DOMPurify and preserves only passive document HTML', async () => {
      const lock = JSON.parse(await readFile(resolve(projectRoot, 'package-lock.json'), 'utf8'));
      const result = await browser.page.evaluate(`(async () => {
        const { default: purifier } = await import('dompurify');
        const { createDocumentHtmlFragment } = await import('${virtualHost.origin}/src/shared/security/document-html.js');
        const root = document.createElement('div');
        root.append(createDocumentHtmlFragment('<details open><summary>safe</summary><em>kept</em></details><button onclick="window.__contractAttack=true">click</button><a href="javascript:window.__contractAttack=true">link</a><iframe srcdoc="bad"></iframe>'));
        window.__contractAttack = false;
        document.body.append(root);
        try {
          root.querySelector('button').click();
          root.querySelector('a').click();
          return {
            version: purifier.version, executed: window.__contractAttack,
            activeMarkup: Boolean(root.querySelector('[onclick], a[href], iframe')),
            safeHtml: root.querySelector('details[open] em')?.textContent
          };
        } finally { root.remove(); delete window.__contractAttack; }
      })()`);
      assert.deepEqual(result, {
        version: lock.packages['node_modules/dompurify'].version,
        executed: false, activeMarkup: false, safeHtml: 'kept'
      });
    });

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
      await setContractDocument(`<!doctype html><html><head><base href="${virtualHost.origin}/"></head><body>
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
      await browser.page.click('.folder-tree-directory-row');
      assert.equal(await browser.page.evaluate(`document.querySelector('.folder-tree-directory-row').getAttribute('aria-expanded')`), 'false');
      const nextPoint = await centerByText(browser.page, '.folder-tree-file-row', 'next.txt');
      await browser.page.clickAt(nextPoint.x, nextPoint.y);
      await browser.page.waitFor(() => window.__folderTreeOpened?.length === 1, { description: 'folder tree open callback' });
      assert.equal(await browser.page.evaluate('window.__folderTreeOpened[0]'), 'F:/Notes/next.txt');
      const readsBeforeDestroy = await browser.page.evaluate('window.__folderTreeReads');
      await browser.page.evaluate(`window.__folderTreeController.destroy()`);
      await browser.page.click('#folder-file-tree-refresh');
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(await browser.page.evaluate('window.__folderTreeReads'), readsBeforeDestroy);
    });


    await test('feature content releases owned nodes, rolls back invalid construction and leaves App Shell ownership intact', async () => {
      await setContractDocument(`<!doctype html><html><head><base href="${virtualHost.origin}/"></head><body>
        <div id="app-root" hidden><span id="pre-shell-node">before</span></div>
      </body></html>`);
      const result = await browser.page.evaluate(`(async()=>{
        const [{createUI},{mountStaticContent},{createMenuContentView},{createDocumentContentView}]=await Promise.all([
          import('${virtualHost.origin}/src/ui/create-ui.js'), import('${virtualHost.origin}/src/ui/dom/index.js'),
          import('${virtualHost.origin}/src/features/menu/ui/menu-content-view.js'),
          import('${virtualHost.origin}/src/features/documents/ui/document-content-view.js')
        ]);
        const root=document.getElementById('app-root'),ui=createUI(root);
        let invalidMarkupError='';
        try{mountStaticContent([[ui.menu,[['span',{},['uncommitted']]]],[null,[]]]);}catch(error){invalidMarkupError=error.message;}
        const cleanAfterInvalid={shellCount:root.querySelectorAll('[data-ui-shell="app"]').length,menuChildren:ui.menu.childNodes.length};
        const menu=createMenuContentView(ui),documents=createDocumentContentView(ui);
        const foreign=document.createElement('span'); foreign.id='foreign-content';ui.overlay.append(foreign);
        const mounted={rootChildren:Array.from(root.children).map(node=>node.id||node.getAttribute('data-ui-shell')||''),
          shellCount:root.querySelectorAll('[data-ui-shell="app"]').length,menuChildren:ui.menu.childNodes.length,
          portHostPresent:Boolean(document.getElementById('compatibility-business-ports')),
          filePortParent:document.getElementById('filename')?.parentElement?.id||'',previousPresent:Boolean(document.getElementById('pre-shell-node'))};
        documents.destroy();documents.destroy();menu.destroy();menu.destroy();
        const afterContent={shellCount:root.querySelectorAll('[data-ui-shell="app"]').length,menuChildren:ui.menu.childNodes.length,
          filePortPresent:Boolean(document.getElementById('filename')),foreignPresent:foreign.isConnected};
        ui.destroy();
        return {invalidMarkupError,cleanAfterInvalid,mounted,afterContent,
          afterUI:{hidden:root.hidden,children:Array.from(root.children).map(node=>node.id),shellCount:root.querySelectorAll('[data-ui-shell="app"]').length}};
      })()`);
      assert.match(result.invalidMarkupError,/live root/);
      assert.deepEqual(result.cleanAfterInvalid,{shellCount:1,menuChildren:0});
      assert.deepEqual(result.mounted.rootChildren,['app','overlay-root']);
      assert.equal(result.mounted.shellCount,1);assert.ok(result.mounted.menuChildren>0);
      assert.equal(result.mounted.portHostPresent,false);assert.equal(result.mounted.filePortParent,'overlay-root');
      assert.equal(result.mounted.previousPresent,false);
      assert.deepEqual(result.afterContent,{shellCount:1,menuChildren:0,filePortPresent:false,foreignPresent:true});
      assert.deepEqual(result.afterUI,{hidden:true,children:['pre-shell-node'],shellCount:0});
    });
  } finally {
    activePage = null;
    await virtualHost.close();
    await browser.close();
  }
}

const APP_FIXTURE = await readFile(resolve(projectRoot, 'tests/fixtures/hybrid-regression.md'), 'utf8');

async function loadAppFixture(page) {
  return createApplicationDriver(page).loadMarkdown(APP_FIXTURE, { layout: 'hybrid', codeVisualEditing: true, tableVisualEditing: true });
}

async function setAppLayout(page, mode) {
  return createApplicationDriver(page).setLayout(mode);
}

async function appSnapshot(page) {
  return createApplicationDriver(page).snapshot();
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
  // Admit local bytes before allocating any Chromium process or listening socket.
  if (!externalUrl) {
    const evidencePath = join(artifactRoot, 'r15-12-build-fingerprint.json');
    try {
      await writeFile(evidencePath, JSON.stringify(await verifyBuiltApplication({ projectRoot }), null, 2));
    } catch (error) {
      await writeFile(evidencePath, JSON.stringify({ accepted: false, code: error.code, reason: error.reason, message: error.message }, null, 2));
      throw error;
    }
  } else console.log('External URL mode: local dist fingerprint admission does not attest the external server.');
  const browser = await launchChromium({ width: 1440, height: 1000 });
  const app = createApplicationDriver(browser.page);
  const openSettings = async () => {
    await browser.page.click('#file-menu-dropdown > .menu-trigger');
    await browser.page.click('[data-settings-open]');
    await browser.page.waitFor(() => document.getElementById('settings-modal')?.classList.contains('show'), { description: 'Settings dialog open' });
  };
  const settingsClosed = () => browser.page.waitFor(() => !document.getElementById('settings-modal')?.classList.contains('show'), { description: 'Settings dialog closed' });
  const showSidebar = async () => {
    if (await browser.page.evaluate("document.querySelector('.l-sidebar')?.classList.contains('is-hidden')")) {
      await browser.page.click('#view-menu-dropdown > .menu-trigger');
      await browser.page.click('[data-menu-command="layout.toggle-sidebar"]');
    }
    await browser.page.waitFor(() => !document.querySelector('.l-sidebar')?.classList.contains('is-hidden'), { description: 'sidebar visible for real pointer input' });
  };
  let applicationHost = null;
  activePage = browser.page;
  try {
    applicationHost = externalUrl ? null : await startBuiltApplicationHost(resolve(projectRoot, 'dist'));
    const baseUrl = externalUrl || applicationHost.origin;
    await runE2EInstallationChecks({ test, baseUrl, artifactRoot });
    if (!externalUrl) await browser.page.addInitScript(`
      localStorage.setItem('md_editor_help_shown','true');
      localStorage.setItem('md_editor_sidebar_visible','false');
    `);
    await browser.page.navigate(`${baseUrl.replace(/\/$/, '')}/?e2e=1`);
    await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 20000, description: 'application ready' });
    const bridgeAvailable = await browser.page.evaluate('Boolean(window.__markdownEditorE2E)');
    if (!bridgeAvailable) throw new Error('Public E2E capability is unavailable at ?e2e=1 after application startup.');
    await test('application mounts one App Shell with strict named slots', async () => {
      // Check the delivered asset before MenuView can remove legacy attributes.
      const markupResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/compatibility/business-content.html`);
      assert.equal(markupResponse.status, 404);

      const snapshot = await browser.page.evaluate(`(()=>{
        const root=document.getElementById('app-root');
        const shell=root?.querySelector('[data-ui-shell="app"]');
        const slotNames=['menu','toolbar','sidebar','editor','preview','status','overlay'];
        const counts=Object.fromEntries(slotNames.map(name=>[name,document.querySelectorAll('[data-ui-slot="'+name+'"]').length]));
        const ids=Array.from(document.querySelectorAll('[id]')).map(element=>element.id);
        return {
          shellCount:document.querySelectorAll('[data-ui-shell="app"]').length,
          scripts:Array.from(document.scripts).map(script=>({type:script.type,path:new URL(script.src,location.href).pathname})),
          businessGlobals:Object.getOwnPropertyNames(window).filter(name=>/^markdownEditor/.test(name)),
          implicitHandlers:Array.from(document.querySelectorAll('*')).filter(node=>Array.from(node.attributes).some(attribute=>/^on(?:click|change|input)$/.test(attribute.name))).length,
          appCount:document.querySelectorAll('.l-app-shell').length,
          legacyAppHookCount:document.querySelectorAll('.app').length,
          legacyShellAliases:Array.from(root.querySelectorAll('*')).flatMap(node=>Array.from(node.classList))
            .filter(name=>['app','menu-bar','editor-toolbar','workspace','sidebar','sidebar-resizer','main','pane','editor-pane','preview-pane','resizer','statusbar','overlay-root'].includes(name)),
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
      assert.ok(snapshot.scripts.length > 0);
      assert.ok(snapshot.scripts.every(script => script.type === 'module' && !script.path.startsWith('/app/')));
      assert.deepEqual(snapshot.businessGlobals, []);
      assert.equal(snapshot.implicitHandlers, 0);
      assert.equal(snapshot.appCount, 1);
      assert.equal(snapshot.legacyAppHookCount, 0);
      assert.deepEqual(snapshot.legacyShellAliases, []);
      assert.deepEqual(snapshot.counts, {menu:1,toolbar:1,sidebar:1,editor:1,preview:1,status:1,overlay:1});
      assert.deepEqual(snapshot.appChildren, ['l-menu-bar','l-toolbar-shell','l-workspace','l-status-bar']);
      assert.deepEqual(snapshot.workspaceChildren, ['sidebar','sidebar-resizer','l-split-pane']);
      assert.deepEqual(snapshot.mainChildren, ['l-pane f-editor-pane','resizer','l-pane f-preview-pane']);
      assert.equal(snapshot.overlayParent, 'app-root');
      assert.equal(snapshot.settingsParent, 'overlay-root');
      assert.equal(snapshot.compatibilityPortHostParent, '');
      assert.deepEqual(snapshot.filePortParents, ['overlay-root','overlay-root']);
      assert.deepEqual(snapshot.duplicateIds, []);
    });

    await test('application Help feature owns first-run visibility, navigation and scoped lifecycle', async () => {
      const initial = await evaluateApplication(browser.page, `(()=>{
        localStorage.removeItem('md_editor_help_shown');
        const host=applicationCapabilities;
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
      await waitForApplication(browser.page, () => document.getElementById('help-modal')?.classList.contains('show'), { description: 'Help first-run modal open' });
      await browser.page.click('#help-modal [data-help-page="files"]');
      await waitForApplication(browser.page, () => document.querySelector('#help-modal [data-help-page-panel="files"]'), { description: 'Help files page' });
      const navigated = await evaluateApplication(browser.page, `(()=>{
        const port=applicationCapabilities?.markdownEditorHelpPort;
        return {activePage:port?.activePage,selected:document.querySelector('#help-modal [data-help-page="files"]')?.getAttribute('aria-selected')};
      })()`);
      assert.deepEqual(navigated, {activePage:'files',selected:'true'});
      await browser.page.click('#help-modal .modal-footer button');
      await waitForApplication(browser.page, () => !document.getElementById('help-modal')?.classList.contains('show'), { description: 'Help modal close' });
      const closed = await evaluateApplication(browser.page, `(()=>{
        const port=applicationCapabilities?.markdownEditorHelpPort;
        return {shown:localStorage.getItem('md_editor_help_shown'),firstRunAgain:port?.openFirstRun(),isOpen:port?.isOpen()};
      })()`);
      assert.deepEqual(closed, {shown:'true',firstRunAgain:false,isOpen:false});
    });

    await test('application Settings Store cancels draft without persisting changes', async () => {
      const before = await evaluateApplication(browser.page, "(()=>{const port=applicationCapabilities.markdownEditorSettingsStorePort;return {stored:localStorage.getItem('md_editor_theme'),committed:port.get('theme'),body:document.body.getAttribute('data-theme')};})()");
      const read = () => evaluateApplication(browser.page, "(()=>{const port=applicationCapabilities.markdownEditorSettingsStorePort;return {stored:localStorage.getItem('md_editor_theme'),hasDraft:port.hasDraft,body:document.body.getAttribute('data-theme')};})()");
      const states = [];
      for (const action of ['button', 'escape', 'backdrop']) {
        await openSettings();
        await browser.page.click('#settings-modal [data-settings-page="general"]');
        await browser.page.selectOption('#setting-theme', 'dark');
        if (action === 'button') await browser.page.click('#settings-modal .modal-footer button:not(.primary)');
        else if (action === 'escape') await browser.page.pressKey('Escape');
        else await browser.page.clickAt(3, 3);
        await settingsClosed();
        states.push(await read());
      }
      await openSettings();
      await browser.page.click('#settings-modal [data-settings-page="general"]');
      const reopened = await evaluateApplication(browser.page, "document.getElementById('setting-theme').value");
      await browser.page.click('#settings-modal .modal-footer button:not(.primary)');
      await settingsClosed();
      assert.deepEqual(before, {stored:null,committed:'light',body:'light'});
      for (const state of states) assert.deepEqual(state, {stored:null,hasDraft:false,body:'light'});
      assert.equal(reopened, 'light');
      const globals = await evaluateApplication(browser.page, "({openSettings:typeof window.openSettings,closeSettings:typeof window.closeSettings,applySettings:typeof window.applySettings,switchSettingsPage:typeof window.switchSettingsPage})");
      assert.deepEqual(globals, {openSettings:'undefined',closeSettings:'undefined',applySettings:'undefined',switchSettingsPage:'undefined'});
    });

    await test('application Settings UI validates and applies one draft without global dialog functions', async () => {
      await openSettings();
      await browser.page.click('#settings-modal [data-settings-page="save"]');
      await waitForApplication(browser.page, () => !document.querySelector('#settings-modal [data-settings-page-panel="save"]')?.hidden, { description: 'Settings save page' });
      const selected = await evaluateApplication(browser.page, "document.querySelector('#settings-modal [data-settings-page=\"save\"]')?.getAttribute('aria-selected')");
      assert.equal(selected, 'true');
      await browser.page.selectOption('#setting-autosave-delay', 'custom');
      await browser.page.fill('#setting-autosave-custom-seconds', '0.1');
      await browser.page.click('#settings-modal .modal-footer .primary');
      const invalid = await evaluateApplication(browser.page, "({open:document.getElementById('settings-modal')?.classList.contains('show'),invalid:document.getElementById('setting-autosave-custom-seconds')?.getAttribute('aria-invalid'),feedback:document.getElementById('settings-feedback')?.textContent||''})");
      assert.equal(invalid.open, true); assert.equal(invalid.invalid, 'true'); assert.match(invalid.feedback, /0\.5–3600/);
      await browser.page.fill('#setting-autosave-custom-seconds', '1.5');
      await browser.page.click('#settings-modal [data-settings-page="general"]');
      await browser.page.selectOption('#setting-theme', 'dark');
      await browser.page.click('#settings-modal .modal-footer .primary');
      await settingsClosed();
      const applied = await evaluateApplication(browser.page, "(()=>{const port=applicationCapabilities.markdownEditorSettingsStorePort;return {theme:port.get('theme'),delay:port.get('autoSaveDelay'),storedTheme:localStorage.getItem('md_editor_theme'),storedDelay:localStorage.getItem('md_editor_autosave_delay'),body:document.body.getAttribute('data-theme')};})()");
      assert.deepEqual(applied, {theme:'dark',delay:1500,storedTheme:'dark',storedDelay:'1500',body:'dark'});
      await openSettings();
      await browser.page.click('#settings-modal [data-settings-page="general"]');
      await browser.page.selectOption('#setting-theme', 'light');
      await browser.page.click('#settings-modal [data-settings-page="save"]');
      await browser.page.selectOption('#setting-autosave-delay', '500');
      await browser.page.click('#settings-modal .modal-footer .primary');
      await settingsClosed();
      await waitForApplication(browser.page, () => document.body.getAttribute('data-theme') === 'light');
    });

    await test('application language Settings commit updates I18n without legacy globals', async () => {
      const setLanguage = async value => {
        await openSettings();
        await browser.page.click('#settings-modal [data-settings-page="general"]');
        await browser.page.selectOption('#setting-language', value);
        await browser.page.click('#settings-modal .modal-footer .primary');
        await settingsClosed();
      };
      await setLanguage('en');
      await waitForApplication(browser.page, () => document.documentElement.lang === 'en', { description: 'committed English locale' });
      const applied = await evaluateApplication(browser.page, "(()=>{const host=applicationCapabilities,port=host.markdownEditorI18nPort,store=host.markdownEditorSettingsStorePort,button=document.getElementById('editor-collapse-btn'),collapsed=document.querySelector('.f-editor-pane')?.classList.contains('is-collapsed');return {locale:port.locale,committed:store.get('language'),stored:localStorage.getItem('md_editor_language'),htmlLang:document.documentElement.lang,dynamicMatches:Boolean(button&&button.title===port.t(collapsed?'expandEditor':'collapseEditor')),globals:{i18n:typeof window.i18n,currentLang:typeof window.currentLang,setLanguage:typeof window.setLanguage}};})()");
      assert.deepEqual(applied, {locale:'en',committed:'en',stored:'en',htmlLang:'en',dynamicMatches:true,globals:{i18n:'undefined',currentLang:'undefined',setLanguage:'undefined'}});
      await setLanguage('zh-CN');
      await waitForApplication(browser.page, () => document.documentElement.lang === 'zh-CN', { description: 'restore zh-CN locale' });
    });

    await test('application theme switch changes visual tokens without changing shell geometry', async () => {
      const result = await evaluateApplication(browser.page, `(async()=>{
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
      const report={};
      try {
        await loadAppFixture(browser.page);
        await evaluateApplication(browser.page, `applicationCapabilities.markdownEditorPreviewCommandPort.update()`);
        const before = await evaluateApplication(browser.page, `(()=>{
          const editor=document.getElementById('editor');
          const virtualEditor=editorApi;
          const documentText=virtualEditor?.getText?.()??null;
          const documentVersion=virtualEditor?.getDocumentVersion?.()??null;
          const preview=document.getElementById('preview');
          const previewFirst=preview?.firstElementChild||null;
          window.__themeToggleIdentity={editor,virtualEditor,documentText,documentVersion,preview,previewFirst};
          return {theme:document.body.getAttribute('data-theme'),trigger:Boolean(document.querySelector('[data-theme-toggle]')),previewFirst:Boolean(previewFirst)};
        })()`);
        report.before=before;
        assert.deepEqual(before, {theme:'light',trigger:true,previewFirst:true});

        const toggle = async expected => {
          await browser.page.click('[data-theme-toggle]');
          await waitForApplication(browser.page, `document.body.getAttribute('data-theme') === ${JSON.stringify(expected)}`, { description: 'Theme Toggle Controller apply ' + expected });
          return evaluateApplication(browser.page, `(()=>{
            const probe=window.__themeToggleIdentity;
            return {
              theme:document.body.getAttribute('data-theme'),
              stored:localStorage.getItem('md_editor_theme'),
              sameEditor:probe.editor===document.getElementById('editor'),
              sameVirtualEditor:probe.virtualEditor===editorApi,
              sameDocumentText:probe.documentText===editorApi?.getText?.(),
              sameDocumentVersion:probe.documentVersion===editorApi?.getDocumentVersion?.(),
              samePreview:probe.preview===document.getElementById('preview'),
              samePreviewFirst:probe.previewFirst===document.getElementById('preview')?.firstElementChild
            };
          })()`);
        };

        const dark = await toggle('dark');
        report.dark=dark;
        assert.deepEqual(dark, {theme:'dark',stored:'dark',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,samePreview:true,samePreviewFirst:true});
        const light = await toggle('light');
        report.light=light;
        assert.deepEqual(light, {theme:'light',stored:'light',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,samePreview:true,samePreviewFirst:true});
      } finally {
        try { await writeFile(join(artifactRoot, 'themeToggle-identity.json'), JSON.stringify(report, null, 2)); }
        finally {
          if (await evaluateApplication(browser.page, "document.body.getAttribute('data-theme')==='dark'")) await browser.page.click('[data-theme-toggle]');
          await evaluateApplication(browser.page, 'delete window.__themeToggleIdentity');
          await waitForApplication(browser.page, () => document.body.getAttribute('data-theme') === 'light', { description: 'restore light theme after Theme Toggle Controller' });
        }
      }
    });

    await test('application Theme Service applies committed theme without rebuilding editor model or preview', async () => {
      const report={};
      try {
        await loadAppFixture(browser.page);
        await setAppLayout(browser.page, 'preview');
        await evaluateApplication(browser.page, `applicationCapabilities.markdownEditorPreviewCommandPort.update()`);
        await waitForApplication(browser.page, () => Boolean(document.getElementById('preview')?.firstElementChild), { timeoutMs: 10000, description: 'Theme Service preview fixture ready' });
        const before = await evaluateApplication(browser.page, `(()=>{
          const editor=document.getElementById('editor');
          const virtualEditor=editorApi;
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
        report.before=before;
        assert.deepEqual(before, {theme:'light',editor:true,virtualEditor:true,documentReady:true,previewFirst:true,legacyThemeGlobal:'undefined'});

        const applyTheme = async theme => {
          await openSettings();
          await browser.page.click('#settings-modal [data-settings-page="general"]');
          await browser.page.selectOption('#setting-theme', theme);
          await browser.page.click('#settings-modal .modal-footer .primary');
          const encodedTheme = JSON.stringify(theme);
          await waitForApplication(browser.page, `(()=>document.body.getAttribute('data-theme')===${encodedTheme}&&!document.getElementById('settings-modal')?.classList.contains('show'))()`, { description: 'Theme Service apply ' + theme });
          return evaluateApplication(browser.page, `(()=>{
            const probe=window.__themeServiceIdentity;
            return {
              theme:document.body.getAttribute('data-theme'),
              sameEditor:probe.editor===document.getElementById('editor'),
              sameVirtualEditor:probe.virtualEditor===editorApi,
              sameDocumentText:probe.documentText===editorApi?.getText?.(),
              sameDocumentVersion:probe.documentVersion===editorApi?.getDocumentVersion?.(),
              samePreview:probe.preview===document.getElementById('preview'),
              samePreviewFirst:probe.previewFirst===document.getElementById('preview')?.firstElementChild,
              canvas:getComputedStyle(document.body).getPropertyValue('--color-canvas').trim()
            };
          })()`);
        };

        const dark = await applyTheme('dark');
        report.dark=dark;
        assert.deepEqual(dark, {
          theme:'dark',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,
          samePreview:true,samePreviewFirst:true,canvas:'#0c1017'
        });
        const light = await applyTheme('light');
        report.light=light;
        assert.deepEqual(light, {
          theme:'light',sameEditor:true,sameVirtualEditor:true,sameDocumentText:true,sameDocumentVersion:true,
          samePreview:true,samePreviewFirst:true,canvas:'#eef1f5'
        });
      } finally {
        try { await writeFile(join(artifactRoot, 'themeService-identity.json'), JSON.stringify(report, null, 2)); }
        finally {
          if (await evaluateApplication(browser.page, "document.body.getAttribute('data-theme')==='dark'")) await browser.page.click('[data-theme-toggle]');
          await evaluateApplication(browser.page, 'delete window.__themeServiceIdentity');
          await waitForApplication(browser.page, () => document.body.getAttribute('data-theme') === 'light', { description: 'restore light theme after Theme Service' });
        }
      }
    });

    await test('application Modal Shell owns accessibility, focus, Escape, backdrop and protected progress policy', async () => {
      await app.loadMarkdown('modal focus', { layout: 'edit', selection: 0 });
      const openFromKeyboard = async () => {
        await app.revealPosition(0);
        await evaluateApplication(browser.page, 'void(window.__runnerModalOpener=document.activeElement)');
        await browser.page.pressKey(',', { modifiers: 2, code: 'Comma' });
        await waitForApplication(browser.page, () => document.getElementById('settings-modal')?.classList.contains('show'));
      };
      await openFromKeyboard();
      await waitForApplication(browser.page, () => {
        const root=document.getElementById('settings-modal');
        const panel=root?.firstElementChild;
        return root?.classList.contains('show')
          && root?.getAttribute('aria-hidden')==='false'
          && panel?.contains(document.activeElement);
      }, { description: 'settings modal initial focus' });
      const opened = await evaluateApplication(browser.page, `(()=>{
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
      await waitForApplication(browser.page, () => (
        document.getElementById('settings-modal')?.style.display === 'none'
          && document.activeElement === window.__runnerModalOpener
      ), { description: 'settings Escape close and focus restoration' });

      await openFromKeyboard();
      await waitForApplication(browser.page, () => document.getElementById('settings-modal')?.classList.contains('show'));
      await browser.page.clickAt(3, 3);
      await waitForApplication(browser.page, () => (
        document.getElementById('settings-modal')?.style.display === 'none'
          && document.activeElement === window.__runnerModalOpener
      ), { description: 'settings backdrop close and focus restoration' });

      await evaluateApplication(browser.page, `window.__progressProbeTask=applicationCapabilities.markdownEditorExportTaskPort.begin('进度弹窗');`);
      await waitForApplication(browser.page, () => document.getElementById('export-progress-modal')?.classList.contains('show'));
      await browser.page.pressKey('Escape');
      await browser.page.clickAt(3, 3);
      assert.equal(
        await evaluateApplication(browser.page, "document.getElementById('export-progress-modal')?.classList.contains('show')"),
        true
      );
      await evaluateApplication(browser.page, `applicationCapabilities.markdownEditorExportTaskPort.finish(window.__progressProbeTask);delete window.__progressProbeTask;`);
      await waitForApplication(browser.page, () => document.getElementById('export-progress-modal')?.style.display === 'none');
      await evaluateApplication(browser.page, `(()=>{
        delete window.__runnerModalOpener;
        scrollTo(0,0);
      })()`);
    });

    await test('application link preview uses scoped focus and cancels stale close completion', async () => {
      await evaluateApplication(browser.page, `(()=>{
        document.getElementById('dom-primitive-focus-source')?.remove();
        const source=document.createElement('button');
        source.id='dom-primitive-focus-source';
        source.type='button';
        source.textContent='focus source';
        document.body.append(source);
        source.focus();
        const anchor=document.createElement('a');anchor.href='https://example.com/first';anchor.textContent='preview link';document.getElementById('preview').append(anchor);
        anchor.id='dom-primitive-link-source';anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
      })()`);
      await waitForApplication(browser.page, () => document.activeElement?.classList.contains('link-preview-close'), { description: 'link preview initial focus' });
      await browser.page.pressKey('Tab');
      assert.equal(await evaluateApplication(browser.page, "document.activeElement?.classList.contains('link-preview-external')"), true);

      await evaluateApplication(browser.page, `(()=>{
        const source=document.getElementById('dom-primitive-focus-source');
        document.querySelector('.link-preview-close').click();
        source.focus();const anchor=document.createElement('a');anchor.href='https://example.com/second';anchor.textContent='preview link';document.getElementById('preview').append(anchor);
        anchor.id='dom-primitive-link-source-2';anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
      })()`);
      await new Promise(resolve => setTimeout(resolve, 240));
      const reopened = await evaluateApplication(browser.page, `(()=>({
        open:Boolean(document.querySelector('#link-preview-overlay.show')),
        src:document.querySelector('.link-preview-frame')?.getAttribute('src')||'',
        focusClass:document.activeElement?.className||''
      }))()`);
      assert.equal(reopened.open, true);
      assert.match(reopened.src, /example\.com\/second/);
      assert.match(reopened.focusClass, /link-preview-close/);

      await evaluateApplication(browser.page, "document.querySelector('.link-preview-close').click()");
      await waitForApplication(browser.page, () => document.activeElement?.id === 'dom-primitive-link-source-2', { description: 'link preview focus restoration' });
      assert.equal(await evaluateApplication(browser.page, "Boolean(document.querySelector('#link-preview-overlay.show'))"), false);
      await evaluateApplication(browser.page, `(()=>{
        const source=document.getElementById('dom-primitive-link-source-2');
        if(document.activeElement===source)source.blur();
        source?.remove();
        document.getElementById('dom-primitive-link-source')?.remove();
        document.getElementById('dom-primitive-focus-source')?.remove();
        scrollTo(0,0);
      })()`);
    });

    await test('application Recent Files Repository and read-only Menu projection enforce limit, case-insensitive dedupe and clear', async () => {
      const result = await evaluateApplication(browser.page, `(()=>{
        const host=applicationCapabilities;
        const port=host?.markdownEditorRecentFilesPort;
        if(!port)throw new Error('Recent files write port unavailable');
        if(document.getElementById('compatibility-business-ports'))throw new Error('Retired service host remains.');
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
      assert.deepEqual(result.writePortKeys, ['add', 'clear', 'destroy', 'entries', 'load', 'maxEntries', 'snapshot', 'subscribe']);
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
      const result = await evaluateApplication(browser.page, `(async()=>{
        const host=applicationCapabilities;
        const port=host?.markdownEditorDocumentControllerPort;
        if(!port)throw new Error('Document controller port unavailable');
        const applyDocumentLifecycleUi=result=>host.markdownEditorDocumentUiCommandPort.invoke('applyDocumentLifecycleUi',result);
        if(!host.markdownEditorDocumentUiCommandPort.has('applyDocumentLifecycleUi'))throw new Error('Document lifecycle UI adapter unavailable');
        const metadataOnly=records=>records.every(record=>!['content','contentChunks','body','text','source','markdown'].some(key=>Object.prototype.hasOwnProperty.call(record,key)));
        const snapshot=()=>({
          activeId:port.activeId,
          modelId:window.__markdownEditorE2E.snapshot().documentId,
          title:document.getElementById('filename')?.value||'',
          body:window.__markdownEditorE2E.getEditorValue(),
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

        await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('openDocument',alpha.record.id);
        const reopenedAlpha=snapshot();

        const originalPrompt=window.prompt;
        try{
          window.prompt=()=> 'Atomic Alpha Renamed';
          applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('renameDocument',alpha.record.id);
        }finally{
          window.prompt=originalPrompt;
        }
        const renamedAlpha=snapshot();
        const persistencePort=host?.markdownEditorEditorUiCommandPort;
        if(!persistencePort?.has?.('saveCurrentFile'))throw new Error('Editor persistence command port unavailable');
        const savedAlpha=await persistencePort.invoke('saveCurrentFile');
        if(!savedAlpha)throw new Error('Atomic 5.3 lifecycle fixture failed to save renamed document');

        await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('closeDocument',alpha.record.id);
        const afterAlphaClose=snapshot();
        await applicationCapabilities.markdownEditorDocumentUiCommandPort.invoke('closeDocument',beta.record.id);
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
      await app.loadMarkdown('controller seed', { layout: 'edit', selection: 0 });
      await evaluateApplication(browser.page, "(()=>{const port=applicationCapabilities.markdownEditorEditorControllerPort;window.__runnerTransactions=[];window.__runnerUnsubscribe=port.subscribeTransactions(value=>window.__runnerTransactions.push(value));})()");
      let result;
      try {
        await browser.page.insertText('x');
        result = await evaluateApplication(browser.page, "(()=>{const host=applicationCapabilities,port=host.markdownEditorEditorControllerPort,model=window.__markdownEditorE2E,transactions=window.__runnerTransactions;const interactive={...transactions.at(-1)},interactiveVersion=model.snapshot().documentVersion;port.setText('controller body');return {count:transactions.length,interactive,interactiveVersion,programmatic:{...transactions.at(-1)},finalVersion:model.snapshot().documentVersion,body:model.getEditorValue(),scopedOnly:typeof window.markdownEditorEditorControllerPort==='undefined'};})()");
      } finally {
        await evaluateApplication(browser.page, "window.__runnerUnsubscribe?.();delete window.__runnerUnsubscribe;delete window.__runnerTransactions");
      }
      assert.equal(result.count, 2);
      assert.equal(result.interactive.interactive, true);
      assert.equal(result.interactive.version, result.interactiveVersion);
      assert.equal(result.programmatic.interactive, false);
      assert.equal(result.programmatic.version, result.finalVersion);
      assert.equal(result.body, 'controller body');
      assert.equal(result.scopedOnly, true);
    });

    await loadAppFixture(browser.page);
    await waitForApplication(browser.page, () => Boolean(document.querySelector('[data-hybrid-block-type="code"]') && document.querySelector('[data-hybrid-block-type="table"]')), { timeoutMs: 10000, description: 'hybrid widgets' });

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
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.compact.shellActive === true, { description: 'compact shell enter' });
      let snapshot = await evaluateApplication(browser.page, `(()=>{const p=applicationCapabilities.markdownEditorLayoutStatePort;return {active:p.snapshot.compact.shellActive,auto:p.snapshot.sidebar.autoCollapsed,burst:p.snapshot.resize.windowActiveUntil,cls:document.documentElement.classList.contains('is-compact-shell')}})()`);
      assert.deepEqual({ active: snapshot.active, auto: snapshot.auto, cls: snapshot.cls }, { active: true, auto: true, cls: true });
      await browser.page.setViewport({ width: 880, height: 700 });
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.resize.windowActiveUntil > performance.now(), { description: 'window resize burst gate' });
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await evaluateApplication(browser.page, "applicationCapabilities.markdownEditorLayoutStatePort.snapshot.compact.shellActive"), true);
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.resize.windowActiveUntil === 0, { description: 'window resize burst settled' });
      snapshot = await evaluateApplication(browser.page, `(()=>{const p=applicationCapabilities.markdownEditorLayoutStatePort;return {started:p.snapshot.resize.windowBurstStartedAt,events:p.snapshot.resize.windowBurstEvents}})()`);
      assert.deepEqual(snapshot, { started: 0, events: 0 });
      await browser.page.setViewport({ width: 920, height: 700 });
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.compact.shellActive === false, { description: 'compact shell hysteresis exit' });
      snapshot = await evaluateApplication(browser.page, `(()=>{const p=applicationCapabilities.markdownEditorLayoutStatePort;return {active:p.snapshot.compact.shellActive,auto:p.snapshot.sidebar.autoCollapsed,cls:document.documentElement.classList.contains('is-compact-shell')}})()`);
      assert.deepEqual(snapshot, { active: false, auto: false, cls: false });
    });

    await test('application toolbar boundary wraps from measured content width without hiding tools', async () => {
      await browser.page.setViewport({ width: 1800, height: 900 });
      await waitForApplication(browser.page, () => window.innerWidth === 1800 && !document.documentElement.classList.contains('is-compact-shell'), { description: 'wide toolbar viewport' });
      const before = await evaluateApplication(browser.page, `(()=>{
        const toolbar=document.querySelector('.l-toolbar-shell');
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
        await evaluateApplication(browser.page, `(()=>{
          const target=${JSON.stringify(targetWidth)};
          const toolbar=document.querySelector('.l-toolbar-shell');
          toolbar.style.width=target+'px';
          toolbar.style.maxWidth=target+'px';
          toolbar.style.boxSizing='border-box';
          toolbar.style.alignSelf='flex-start';
        })()`);
        await waitForApplication(browser.page, () => document.querySelector('.l-toolbar-shell')?.classList.contains('toolbar-boundary-wrap') === true, { description: 'content-width toolbar wrapping' });
        const wrapped = await evaluateApplication(browser.page, `(()=>{
          const toolbar=document.querySelector('.l-toolbar-shell');
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
        await evaluateApplication(browser.page, `(()=>{
          const toolbar=document.querySelector('.l-toolbar-shell');
          if(!toolbar)return;
          toolbar.style.removeProperty('width');
          toolbar.style.removeProperty('max-width');
          toolbar.style.removeProperty('box-sizing');
          toolbar.style.removeProperty('align-self');
        })()`);
      }
      await waitForApplication(browser.page, () => document.querySelector('.l-toolbar-shell')?.classList.contains('toolbar-boundary-wrap') === false, { description: 'wide toolbar unwrap restoration' });
      const restored = await evaluateApplication(browser.page, `(()=>({
        hidden:Array.from(document.querySelectorAll('.l-toolbar-shell [data-toolbar-item]')).map(item=>[item.dataset.toolbarItem,item.classList.contains('toolbar-item-hidden')])
      }))()`);
      assert.deepEqual(restored.hidden, before.hidden);
      await browser.page.setViewport({ width: 1440, height: 1000 });
      await waitForApplication(browser.page, () => window.innerWidth === 1440 && window.innerHeight === 1000, { description: 'restore toolbar test viewport' });
    });

    await test('application page fullscreen uses the Stage 6.6 controller without changing command IDs', async () => {
      await browser.page.setViewport({ width: 1440, height: 1000 });
      const before = await evaluateApplication(browser.page, `(()=>{
        const host=applicationCapabilities;
        const port=host?.markdownEditorEditorUiCommandPort;
        const layout=host?.markdownEditorLayoutStatePort;
        if(!port||!layout)throw new Error('Atomic 6.6 fullscreen ports unavailable');
        localStorage.setItem('md_editor_page_fullscreen','false');
        return {
          active:layout.snapshot.fullscreen.page,
          app:document.querySelector('.l-app-shell')?.classList.contains('is-page-fullscreen')||false,
          body:document.body.classList.contains('is-page-fullscreen-active')
        };
      })()`);
      if (before.active) {
        await evaluateApplication(browser.page, `applicationCapabilities.markdownEditorEditorUiCommandPort.invoke('togglePageFullscreen')`);
      }
      await evaluateApplication(browser.page, `applicationCapabilities.markdownEditorEditorUiCommandPort.invoke('togglePageFullscreen')`);
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.fullscreen.page === true, { description: 'page fullscreen enter' });
      let snapshot = await evaluateApplication(browser.page, `(()=>({
        state:applicationCapabilities.markdownEditorLayoutStatePort.snapshot.fullscreen.page,
        appLegacy:document.querySelector('.l-app-shell').classList.contains('page-fullscreen'),
        appCurrent:document.querySelector('.l-app-shell').classList.contains('is-page-fullscreen'),
        bodyLegacy:document.body.classList.contains('page-fullscreen-active'),
        bodyCurrent:document.body.classList.contains('is-page-fullscreen-active'),
        persisted:localStorage.getItem('md_editor_page_fullscreen')
      }))()`);
      assert.deepEqual(snapshot, { state:true, appLegacy:false, appCurrent:true, bodyLegacy:false, bodyCurrent:true, persisted:'true' });
      await evaluateApplication(browser.page, `applicationCapabilities.markdownEditorEditorUiCommandPort.invoke('togglePageFullscreen')`);
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.fullscreen.page === false, { description: 'page fullscreen exit' });
      snapshot = await evaluateApplication(browser.page, `(()=>({
        state:applicationCapabilities.markdownEditorLayoutStatePort.snapshot.fullscreen.page,
        app:document.querySelector('.l-app-shell').classList.contains('is-page-fullscreen'),
        body:document.body.classList.contains('is-page-fullscreen-active'),
        persisted:localStorage.getItem('md_editor_page_fullscreen')
      }))()`);
      assert.deepEqual(snapshot, { state:false, app:false, body:false, persisted:'false' });
    });

    await test('application sidebar tabs switch one mount region and coordinate child lifecycles', async () => {
      await loadAppFixture(browser.page);
      await showSidebar();
      const docsBefore = await evaluateApplication(browser.page, "document.getElementById('document-list')?.childElementCount??-1");
      const readSidebar = () => evaluateApplication(browser.page, "(()=>{const host=applicationCapabilities,port=host.markdownEditorSidebarControllerPort,tree=host.markdownEditorFolderTreeControllerPort;return {active:port.activeTab,panels:['docs','files','outline'].filter(name=>document.getElementById('sidebar-'+name+'-panel')?.classList.contains('active')),tabs:['docs','files','outline'].filter(name=>document.getElementById('sidebar-'+name+'-tab')?.classList.contains('active')),stored:localStorage.getItem('md_editor_sidebar_tab'),treeActive:tree.snapshot.active,items:document.getElementById('outline-list')?.children.length??0,count:document.getElementById('document-list')?.childElementCount??-1};})()");
      await browser.page.click('#sidebar-files-tab'); const files = await readSidebar();
      await browser.page.click('#sidebar-outline-tab'); const outline = await readSidebar();
      await browser.page.click('#sidebar-docs-tab'); const docs = await readSidebar();
      const globals = await evaluateApplication(browser.page, "({legacyGlobal:typeof window.setSidebarTab,legacyTreeGlobal:typeof window.markdownEditorFileTree})");
      const result={docsBefore,files:{active:files.active,panels:files.panels,tabs:files.tabs,stored:files.stored,treeActive:files.treeActive},outline,docs:{active:docs.active,panels:docs.panels,tabs:docs.tabs,stored:docs.stored,count:docs.count},states:[files.treeActive,outline.treeActive,docs.treeActive],...globals};
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
      await showSidebar();
      const source = '# Root\nroot body\n## Child\nchild body\n### Grand\ngrand body\n# Next\nnext body\n';
      await app.loadMarkdown(source, { layout: 'both', focusText: 'child body' });
      await browser.page.click('#sidebar-outline-tab');
      await waitForApplication(browser.page, () => {
        const host=applicationCapabilities;
        return host?.markdownEditorOutlineControllerPort?.snapshot?.headings?.length===4
          && document.querySelectorAll('#outline-list .outline-node').length===4;
      }, { description: 'Atomic 6.8 indexed Outline tree' });

      const initial = await evaluateApplication(browser.page, `(()=>{
        const host=applicationCapabilities;
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
          activeLine:editorApi?.getLineNumberAtPosition?.(editorApi.getSelection().start)||0,
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
      await browser.page.click('#outline-list .outline-node[data-outline-id='+JSON.stringify(rootId)+'] > .outline-row .outline-toggle');
      await waitForApplication(browser.page, () => {
        const persisted=JSON.parse(localStorage.getItem('md_editor_outline_collapsed')||'{}');
        const node=document.querySelector('#outline-list > .outline-tree > .outline-node');
        return Object.values(persisted).some(value=>value===true)
          && node?.classList.contains('is-collapsed')
          && node.querySelector(':scope > .outline-children')?.classList.contains('collapsed');
      }, { description: 'Atomic 6.8 Outline collapse persisted' });

      await browser.page.click('#sidebar-docs-tab');
      await browser.page.click('#sidebar-outline-tab');
      await waitForApplication(browser.page, () => document.querySelector('#outline-list > .outline-tree > .outline-node')?.classList.contains('is-collapsed')===true, {
        description: 'Atomic 6.8 Outline collapse restored after lifecycle resume'
      });

      const nextHeading = await centerByText(browser.page, '#outline-list .outline-link', 'Next');
      await browser.page.clickAt(nextHeading.x, nextHeading.y);
      await waitForApplication(browser.page, () => {
        const editor=document.getElementById('editor');
        return editorApi?.getLineNumberAtPosition?.(editorApi.getSelection().start)===7
          && document.querySelector('#outline-list .outline-row.active .outline-link')?.textContent?.trim()==='Next';
      }, { description: 'Atomic 6.8 Outline heading navigation' });
      const final = await evaluateApplication(browser.page, `(()=>({
        line:editorApi?.getLineNumberAtPosition?.(editorApi.getSelection().start)||0,
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
        await waitForApplication(browser.page, () => !document.documentElement.classList.contains('is-compact-shell'), {
          description: 'wide shell before responsive verification'
        });
        await setAppLayout(browser.page, 'both');
        await evaluateApplication(browser.page, `(()=>{
          const sidebar=document.querySelector('.l-sidebar');
          if(sidebar?.classList.contains('is-hidden')) applicationCapabilities.markdownEditorEditorUiCommandPort.invoke('toggleSidebar');
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
        await waitForApplication(browser.page, () => window.innerWidth === 1440 && window.innerHeight === 1000, {
          description: 'restore default application viewport'
        });
        await setAppLayout(browser.page, 'hybrid');
      }
    });

    await test('application code block placeholder never receives a phantom source highlight', async () => {
      const source = '```\n\n\n```\n\n';
      await app.loadMarkdown(source, { layout: 'hybrid', selection: source.length, codeVisualEditing: true, tableVisualEditing: true });
      await waitForApplication(browser.page, () => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'closed code widget' });
      await app.revealPosition(source.length);
      const trailingRect = await browser.page.elementRect('.cm-content > .cm-line:last-child');
      const trailingPoint = { x: trailingRect.x + 2, y: trailingRect.y + trailingRect.height / 2 };
      await browser.page.clickAt(trailingPoint.x, trailingPoint.y);
      await waitForApplication(browser.page, () => {
        const editor=document.getElementById('editor');
        return editorApi.getSelection().start===editorApi.getTextLength()
          && editorApi.getSelection().end===editorApi.getTextLength()
          && window.__markdownEditorE2E.snapshot().presentationStats?.sourceActiveLines===1;
      }, { description: 'trailing source active line' });
      const snapshot = await evaluateApplication(browser.page, `(()=>{
        const widget=document.querySelector('[data-hybrid-block-type="code"]');
        const widgetRect=widget?.getBoundingClientRect();
        const active=Array.from(document.querySelectorAll('.cm-hybrid-source-active')).map(element=>{const rect=element.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,text:element.textContent||''};});
        return {widgetTop:widgetRect?.top||0,widgetBottom:widgetRect?.bottom||0,active,presentation:window.__markdownEditorE2E.snapshot().presentationStats||{}};
      })()`);
      assert.equal(snapshot.presentation.codeBlocks, 1);
      assert.equal(snapshot.active.length, 1);
      assert.ok(snapshot.active.every(line => line.top >= snapshot.widgetBottom - 1), JSON.stringify(snapshot));    });

    await test('application code block ignores single click and opens on strict double click', async () => {
      await loadAppFixture(browser.page);
      await browser.page.click('[data-hybrid-block-type="code"] .cm-hybrid-code-body');
      assert.equal(await evaluateApplication(browser.page, 'Boolean(document.querySelector("[data-hybrid-code-editor]"))'), false);
      await browser.page.click('[data-hybrid-block-type="code"] .cm-hybrid-code-body', { count: 2, intervalMs: 90 });
      await waitForApplication(browser.page, () => Boolean(document.querySelector('[data-hybrid-code-editor]')), { description: 'code editor open' });
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
      await browser.page.clickAt(outside.x + 2, outside.y);
      await waitForApplication(browser.page, () => !document.querySelector('[data-hybrid-code-editor]'), { description: 'code editor close' });
    });

    await test('application keeps only one direct editor active', async () => {
      await loadAppFixture(browser.page);
      await browser.page.click('[data-hybrid-block-type="code"] .cm-hybrid-code-body', { count: 2 });
      await waitForApplication(browser.page, () => Boolean(document.querySelector('[data-hybrid-code-editor]')));
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
      await browser.page.clickAt(outside.x + 2, outside.y);
      await waitForApplication(browser.page, () => !document.querySelector('[data-hybrid-code-editor]'));
      await browser.page.click('[data-hybrid-block-type="table"] td', { count: 2 });
      await waitForApplication(browser.page, () => Boolean(document.querySelector('[data-hybrid-table-cell-input]')));
      assert.equal(await evaluateApplication(browser.page, 'Boolean(document.querySelector("[data-hybrid-code-editor]"))'), false);
      await browser.page.clickAt(outside.x + 2, outside.y);
      await waitForApplication(browser.page, () => !document.querySelector('[data-hybrid-table-cell-input]'));
    });

    await test('application Hybrid table pointer input avoids block decoration dispatch races', async () => {
      await loadAppFixture(browser.page);
      await setAppLayout(browser.page, 'hybrid');
      await evaluateApplication(browser.page, `(()=>{
        window.__hybridDispatchRaceErrors=[];
        window.addEventListener('error',event=>{
          const message=String(event?.message||event?.error?.message||'');
          if(/Cannot read properties of null.*dom|block-dispatch-failure/i.test(message)){
            window.__hybridDispatchRaceErrors.push(message);
          }
        });
      })()`);
      const beforeLength = await evaluateApplication(browser.page, 'editorApi.getTextLength()');
      for (let index = 0; index < 4; index += 1) {
        await browser.page.click('[data-hybrid-block-type="table"] td');
        const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
        await browser.page.clickAt(outside.x + 2, outside.y);
        await app.revealText('selection alpha', { edge: 'end' });
        await browser.page.insertText('x');
        await evaluateApplication(browser.page, 'new Promise(resolve=>queueMicrotask(resolve))');
      }
      await evaluateApplication(browser.page, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,160))))');
      const result = await evaluateApplication(browser.page, `(()=>({
        errors:window.__hybridDispatchRaceErrors||[],
        textLength:editorApi.getTextLength()
      }))()`);
      assert.deepEqual(result.errors, []);
      assert.equal(result.textLength, beforeLength + 4);
    });

    await test('application Mermaid presentation stays normalized across hybrid and preview layouts', async () => {
      await loadAppFixture(browser.page);
      await setAppLayout(browser.page, 'hybrid');
      await app.revealText('flowchart LR', { preserveSelection: true });
      await waitForApplication(browser.page, () => Boolean(document.querySelector('[data-hybrid-block-type=\"mermaid\"] svg')), { timeoutMs: 10000, description: 'hybrid Mermaid SVG' });
      const inspectMermaid = `selector=>{const svg=document.querySelector(selector);const style=svg?getComputedStyle(svg):null;return {role:svg?.getAttribute('role'),label:svg?.getAttribute('aria-label'),className:svg?.getAttribute('class')||'',heightAttribute:svg?.getAttribute('height'),inlineStyle:svg?.getAttribute('style'),maxWidth:style?.maxWidth||'',backgroundColor:style?.backgroundColor||''}}`;
      const hybrid = await evaluateApplication(browser.page, `(${inspectMermaid})('[data-hybrid-block-type=\"mermaid\"] svg')`);
      await setAppLayout(browser.page, 'preview');
      await waitForApplication(browser.page, () => Boolean(document.querySelector('.f-preview-pane .mermaid svg')), { timeoutMs: 10000, description: 'preview Mermaid SVG' });
      const previewResult = await evaluateApplication(browser.page, `(${inspectMermaid})('.f-preview-pane .mermaid svg')`);
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
      await waitForApplication(browser.page, () => !document.querySelector('[data-hybrid-block-type="code"]') && editorApi.getSelection().end > editorApi.getSelection().start, { description: 'source range open' });
      const selectedSource = await evaluateApplication(browser.page, `(()=>{const editor=document.getElementById('editor');return editorApi.sliceText(editorApi.getSelection().start,editorApi.getSelection().end)})()`);
      assert.match(selectedSource, /plain code/);
      await app.revealText('selection alpha', { preserveSelection: true });
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');
      await browser.page.clickAt(outside.x + 2, outside.y);
      await waitForApplication(browser.page, () => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'source range close' });
    });

    await test('application split controllers drag, collapse and preserve compact hysteresis in the built app', async () => {
      await browser.page.setViewport({ width: 1440, height: 1000 });
      await waitForApplication(browser.page, () => window.innerWidth === 1440, { description: 'wide split viewport' });
      await app.setLayout('both');
      await waitForApplication(browser.page, () => {
        const handle=document.getElementById('resizer');
        return Boolean(handle && !handle.classList.contains('is-hidden') && handle.getBoundingClientRect().width > 0);
      }, { description: 'visible split handle' });
      const before=await evaluateApplication(browser.page, `(()=>{
        const handle=document.getElementById('resizer'); const rect=handle.getBoundingClientRect();
        const host=applicationCapabilities;
        return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,ratio:host.markdownEditorLayoutStatePort.snapshot.split.ratio};
      })()`);
      await browser.page.drag({ x: before.x, y: before.y }, { x: before.x + 120, y: before.y }, { steps: 12 });
      const dragged=await evaluateApplication(browser.page, `(()=>{
        const host=applicationCapabilities;
        return {
          ratio:host.markdownEditorLayoutStatePort.snapshot.split.ratio,
          stored:Number(localStorage.getItem('md_editor_ratio')),
          aria:document.getElementById('resizer')?.getAttribute('aria-valuenow')||'',
          active:host.markdownEditorLayoutStatePort.snapshot.resize.splitActive
        };
      })()`);
      assert.ok(dragged.ratio > before.ratio);
      assert.equal(Math.abs(dragged.stored-dragged.ratio) < 0.0001, true);
      assert.equal(dragged.active, false);
      assert.ok(Number(dragged.aria) >= 15 && Number(dragged.aria) <= 85);

      await browser.page.click('#preview-collapse-btn');
      await waitForApplication(browser.page, () => document.querySelector('.f-preview-pane')?.classList.contains('is-collapsed'), { description: 'preview collapsed' });
      let collapsed=await evaluateApplication(browser.page, `(()=>({
        editor:document.querySelector('.f-editor-pane')?.classList.contains('is-collapsed'),
        preview:document.querySelector('.f-preview-pane')?.classList.contains('is-collapsed'),
        resizer:document.getElementById('resizer')?.classList.contains('is-hidden')
      }))()`);
      assert.deepEqual(collapsed,{editor:false,preview:true,resizer:true});
      await browser.page.waitForElementStable('#preview-collapse-btn', { description: 'preview collapse button after collapse' });
      await browser.page.click('#preview-collapse-btn');
      await waitForApplication(browser.page, () => !document.querySelector('.f-preview-pane')?.classList.contains('is-collapsed'), { description: 'preview expanded' });

      await evaluateApplication(browser.page, `(()=>{
        const main=document.querySelector('.l-split-pane'); main.style.flex='0 0 710px'; main.style.width='710px';
      })()`);
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.split.compactActive === true, { description: 'compact split enter' });
      await evaluateApplication(browser.page, `(()=>{const main=document.querySelector('.l-split-pane');main.style.flex='0 0 740px';main.style.width='740px';})()`);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await evaluateApplication(browser.page, "applicationCapabilities.markdownEditorLayoutStatePort.snapshot.split.compactActive"), true);
      await evaluateApplication(browser.page, `(()=>{const main=document.querySelector('.l-split-pane');main.style.flex='0 0 780px';main.style.width='780px';})()`);
      await waitForApplication(browser.page, () => applicationCapabilities?.markdownEditorLayoutStatePort?.snapshot.split.compactActive === false, { description: 'compact split hysteresis exit' });
      collapsed=await evaluateApplication(browser.page, `(()=>({
        editor:document.querySelector('.f-editor-pane')?.classList.contains('is-collapsed'),
        preview:document.querySelector('.f-preview-pane')?.classList.contains('is-collapsed')
      }))()`);
      assert.deepEqual(collapsed,{editor:false,preview:false});
      await evaluateApplication(browser.page, `(()=>{const main=document.querySelector('.l-split-pane');main.style.removeProperty('flex');main.style.removeProperty('width');})()`);
    });

    await test('application sidebar resize captures pointer, projects width and persists the final width', async () => {
      await browser.page.setViewport({ width: 1440, height: 1000 });
      await waitForApplication(browser.page, () => window.innerWidth === 1440 && window.innerHeight === 1000, {
        description: 'wide viewport for sidebar resize'
      });
      await showSidebar();
      await waitForApplication(browser.page, () => {
        const handle=document.getElementById('sidebar-resizer');
        return Boolean(handle && !handle.classList.contains('is-hidden') && handle.getBoundingClientRect().height > 0);
      }, { description: 'visible sidebar resize handle' });
      const before = await evaluateApplication(browser.page, `(()=>{
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
      await evaluateApplication(browser.page, 'window.__atomic62SidebarBaselineWidth=' + JSON.stringify(before.width));
      await waitForApplication(browser.page, () => {
        const handle=document.getElementById('sidebar-resizer');
        const css=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
        const stored=Number.parseFloat(localStorage.getItem('md_editor_sidebar_width'));
        const aria=Number.parseFloat(handle?.getAttribute('aria-valuenow')||'');
        return Number.isFinite(css) && Number.isFinite(stored) && Number.isFinite(aria)
          && css===stored && css===aria && Math.abs(css-Number(window.__atomic62SidebarBaselineWidth))>=20
          && !document.body.classList.contains('sidebar-resizing')
          && !document.body.classList.contains('is-sidebar-resizing');
      }, { description: 'persisted sidebar width after pointer drag' });
      const after = await evaluateApplication(browser.page, `(()=>{
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
      await evaluateApplication(browser.page, 'delete window.__atomic62SidebarBaselineWidth');
      await evaluateApplication(browser.page, `(()=>{
        const value=${JSON.stringify(before.stored)};
        if(value===null) localStorage.removeItem('md_editor_sidebar_width');
        else localStorage.setItem('md_editor_sidebar_width', value);
      })()`);
    });

    await test('application pointer drag maps to exact editor characters', async () => {
      await loadAppFixture(browser.page);
      await setAppLayout(browser.page, 'edit');
      await app.revealText('selection alpha');
      const lineSelector = '.cm-line';
      const start = await getTextBoundary(browser.page, lineSelector, 'alpha', 'start', 'selection alpha');
      const end = await getTextBoundary(browser.page, lineSelector, 'beta', 'end', 'selection alpha');
      await browser.page.drag({ x: start.x + 1, y: start.y }, { x: end.x - 1, y: end.y }, { steps: 18 });
      const snapshot = await appSnapshot(browser.page);
      assert.equal(snapshot.selectedText.trim(), 'alpha beta');
      await setAppLayout(browser.page, 'hybrid');
    });

    await test('R15-11 application runner uses public queries and trusted pointer and keyboard input', async () => {
      const original = 'runner alpha', addition = ' 中文🧪';
      await app.loadMarkdown(original, { layout: 'edit', selection: original.length });
      await evaluateApplication(browser.page, `(() => {
        const events = [], capture = event => { if (event.target.closest?.('.cm-content')) events.push({ type: event.type, trusted: event.isTrusted }); };
        const types = ['pointerdown', 'keydown', 'beforeinput', 'input'];
        for (const type of types) document.addEventListener(type, capture, true);
        window.__runnerInputProbe = { events, destroy() { for (const type of types) document.removeEventListener(type, capture, true); } };
      })()`);
      try {
        await browser.page.click('.cm-content');
        await app.revealPosition(original.length);
        await browser.page.pressKey('ArrowLeft');
        await browser.page.pressKey('ArrowRight');
        await browser.page.insertText(addition);
        await app.waitForIdle();
        assert.equal(await app.getEditorValue(), original + addition);
        const snapshot = await app.snapshot(), state = await app.getState();
        assert.equal(snapshot.documentLength, (original + addition).length);
        assert.equal(state.activeOperations, 0); assert.equal(state.pendingWaits, 0);
        const events = await evaluateApplication(browser.page, 'window.__runnerInputProbe.events');
        for (const type of ['pointerdown', 'keydown', 'beforeinput', 'input']) assert.ok(events.some(event => event.type === type && event.trusted), type);
        assert.ok(events.every(event => event.trusted));
        await writeFile(join(artifactRoot, 'r15-11-runner.json'), JSON.stringify({ snapshot, state, events }, null, 2));
      } finally {
        await evaluateApplication(browser.page, 'window.__runnerInputProbe.destroy();delete window.__runnerInputProbe');
      }
    });

    await test('application public E2E queries return readonly semantic data without feature objects', async () => {
      await loadAppFixture(browser.page);
      const result = await evaluateApplication(browser.page, `(async () => {
        const api=window.__markdownEditorE2E;
        const before=api.snapshot();
        const deeplyReadonly=value=>value===null||typeof value!=='object'
          ? typeof value!=='function'
          : Object.isFrozen(value)&&(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype)
            &&Object.values(value).every(deeplyReadonly);
        const states=api.getComponentStates(),preview=api.getPreviewStats();
        const readonly=deeplyReadonly(before)&&deeplyReadonly(states)&&deeplyReadonly(preview);
        const noDetails=states.every(value=>!('details' in value)&&!('model' in value)&&!('dom' in value));
        const blocked=states.length===0||Reflect.set(states[0],'mode','external-mutation')===false;
        const querySnapshot=api.snapshot();
        const presentationRoot=editorApi;
        const sameLayoutCommands=[];
        const repeatedLayout=await api.setLayout(before.layout);
        if(editorApi!==presentationRoot)sameLayoutCommands.push('editor-replaced');
        const layout=await api.setLayout('preview');
        const reveal=await api.revealText('selection alpha',{preserveSelection:true});
        const idle=await api.waitForIdle();
        const after=api.snapshot();
        await api.setLayout('hybrid');
        return {readonly,noDetails,blocked,layout,reveal,idle,preview,repeatedLayout,sameLayoutCommands,
          unchangedByQuery:before.documentId===querySnapshot.documentId&&before.documentGeneration===querySnapshot.documentGeneration
            &&before.documentVersion===querySnapshot.documentVersion&&before.selectionStart===querySnapshot.selectionStart&&before.selectionEnd===querySnapshot.selectionEnd,
          identityStable:before.documentId===after.documentId&&before.documentGeneration===after.documentGeneration&&before.documentVersion===after.documentVersion,
          documentLength:after.documentLength,textLength:api.getEditorValue().length,state:api.getState()};
      })()`);
      assert.equal(result.readonly,true);assert.equal(result.noDetails,true);assert.equal(result.blocked,true);
      assert.equal(result.unchangedByQuery,true);assert.equal(result.identityStable,true);assert.equal(result.layout,'preview');
      assert.equal(result.repeatedLayout,'hybrid');assert.deepEqual(result.sameLayoutCommands,[]);
      assert.ok(result.reveal>=0);assert.equal(result.idle,true);assert.equal(result.documentLength,APP_FIXTURE.length);assert.equal(result.textLength,APP_FIXTURE.length);
      assert.equal(typeof result.preview.active,'boolean');assert.ok(Number.isFinite(result.preview.blocks));
      assert.equal(result.state.activeOperations,0);assert.equal(result.state.pendingWaits,0);assert.equal(result.state.busy,false);
      await writeFile(join(artifactRoot,'r15-09-query-api.json'),JSON.stringify(result,null,2));
    });

    await runExportCharacterization({ page: browser.page, test, artifactRoot, applicationHost,
      loadMarkdown: (source, options = {}) => app.loadMarkdown(source, { layout: 'both', codeVisualEditing: true, tableVisualEditing: true, ...options })
    });

    if (browser.page.exceptions.length) {
      throw new Error(`Browser exceptions detected: ${JSON.stringify(browser.page.exceptions.slice(0, 3))}`);
    }
  } finally {
    activePage = null;
    try {
      await writeFile(join(artifactRoot, 'built-app-diagnostics.json'), JSON.stringify({
        console: browser.page.consoleMessages, exceptions: browser.page.exceptions,
        requests: applicationHost?.requests || [], origin: applicationHost?.origin || externalUrl
      }, null, 2));
    } finally {
      try { await releaseApplicationInspector(browser.page);
    await browser.close(); } finally { await applicationHost?.close(); }
    }
  }
}

console.log(`Browser artifacts: ${artifactRoot}`);
if (runContract) await runContractSuite();
if (runApp) await runAppSuite();

const failed = results.filter(result => !result.ok);
console.log(`\nBrowser tests: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`);
if (!failed.length && !process.env.E2E_ARTIFACT_DIR) await rm(artifactRoot, { recursive: true, force: true });
if (failed.length) process.exitCode = 1;
