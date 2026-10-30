import assert from 'node:assert/strict';
import {openWorkspaceExport,openWorkspaceFind} from './workspace-header-actions.mjs';
import { join } from 'node:path';
import { runBlueComponentChecks } from './blue-component-checks.mjs';
import { runWritingPreferenceChecks } from './writing-preference-checks.mjs';
import { runQuoteHeightChecks } from './quote-height-checks.mjs';
import { runDropOutlineFluidChecks } from './drop-outline-fluid-checks.mjs';

const sample = '# 慢慢写，也很好。\n\n不急着把每个想法变成结论。\n先为它留下一点空间，让文字慢慢生长。\n\n> 写作不是把所有事情说完，\n> 而是找到此刻真正想说的那一句。\n\n## 把注意力还给文字\n\nalpha ALPHA scatteralpha alpha\n\n- [ ] 留一点余白\n\n' + '写作需要耐心。\n\n'.repeat(60);

/** Exercise the actual redesigned surfaces over the public app driver and browser input. */
export async function runFigmaUiChecks({ page, app, artifacts }) {
  const report = { checks: [], views: [] };
  const check = (name, value = true) => { assert.equal(value, true, name); report.checks.push(name); };
  const settle = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const settings = async () => {
    await page.click('[data-menu-toggle="file-menu"]'); await page.click('[data-settings-open]');
    await page.waitFor(() => !document.getElementById('settings-modal').hidden);
  };
  const back = async () => { await page.click('#settings-modal .sidebar-footer-action'); await page.waitFor(() => document.getElementById('settings-modal').hidden); await settle(); };
  const theme = async value => { await settings(); await page.click('[data-settings-page="general"]'); await page.selectOption('#setting-theme', value); await page.waitFor(`document.body.dataset.theme === ${JSON.stringify(value)}`); await back(); };
  const snapshot = name => page.screenshot(join(artifacts, `figma-${name}.png`));
  const footerGeometry = () => page.evaluate(`(() => {const b=document.querySelector('.l-status-bar').getBoundingClientRect(),e=document.querySelector('.statusbar-format'),m=e.getBoundingClientRect(),s=document.querySelector('.save-hint').getBoundingClientRect();return {height:b.height,right:innerWidth-m.right,top:m.top-b.top,bottom:b.bottom-m.bottom,saveLeft:s.left,border:getComputedStyle(e).borderWidth};})()`);
  const checkFooter = async name => {const g=await footerGeometry();check('balanced footer '+name,g.height===40&&g.right===24&&g.top===10&&g.bottom===10&&g.saveLeft===48&&g.border==='0px');};
  const within = selector => page.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect(); return {width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};})()`);
  await page.setViewport({ width: 1440, height: 960 });
  await app.loadMarkdown(sample, { layout: 'hybrid', selection: 0 }); await app.waitForIdle();
  await checkFooter('desktop');
  await snapshot('writing-light');
  const recent = await within('[data-workspace-recent]');
  await page.evaluate(`globalThis.__figmaEditor = document.getElementById('editor'); globalThis.__figmaScroll = document.querySelector('#editor .cm-scroller'); globalThis.__figmaScroll.scrollTop=240; globalThis.__figmaScrollTop=globalThis.__figmaScroll.scrollTop;`);
  await settle();
  await settings();
  const settingsInfo = await page.evaluate(`(() => {const r=document.getElementById('settings-modal'); return {modal:r.querySelector('[aria-modal=true]')!==null,inert:document.querySelector('.l-workspace').inert,visibility:getComputedStyle(document.querySelector('.l-workspace')).visibility};})()`);
  assert.deepEqual(settingsInfo, { modal: false, inert: true, visibility: 'hidden' });
  const returned = await within('#settings-modal .sidebar-footer-action');
  assert.equal(returned.left, recent.left); assert.equal(returned.top, recent.top); assert.equal(returned.width, recent.width); assert.equal(returned.height, recent.height);
  await page.selectOption('#setting-theme', 'dark');
  check('settings immediately persist', await page.evaluate(`localStorage.getItem('md_editor_theme')==='dark' && !document.getElementById('settings-modal').hidden`));
  await page.selectOption('#setting-theme', 'light');
  await snapshot('settings-light');
  for (const section of ['editor', 'toolbar', 'save', 'performance']) {
    await page.click(`[data-settings-page="${section}"]`);
    check('settings section ' + section, await page.evaluate(`!document.querySelector('[data-settings-page-panel="${section}"]').hidden`));
  }
  await back();
  check('settings retain editor and scroll', await page.evaluate(`globalThis.__figmaEditor === document.getElementById('editor') && Math.abs(globalThis.__figmaScroll.scrollTop-globalThis.__figmaScrollTop)<2`));
  assert.equal(await app.getEditorValue(), sample);
  await page.evaluate(`globalThis.__figmaScroll.scrollTop=0`); await settle();
  for (const mode of ['both', 'preview', 'hybrid']) {
    await page.click(`.writing-modes [data-mode="${mode}"]`); await app.waitForIdle();
    check('view command ' + mode, await page.evaluate(`document.querySelector('.writing-modes [data-mode="${mode}"]').getAttribute('aria-pressed')==='true'`));
    if(mode==='both') check('split panes share header height and content inset',await page.evaluate(`(()=>{const h=[...document.querySelectorAll('.pane-header')].map(e=>e.getBoundingClientRect()),line=document.querySelector('#editor .cm-line'),source=document.querySelector('.f-editor-pane').getBoundingClientRect(),body=document.querySelector('.preview-content .markdown-body'),preview=document.querySelector('.f-preview-pane').getBoundingClientRect();return h.every(r=>r.height===36&&r.top===h[0].top)&&Math.abs(line.getBoundingClientRect().left+parseFloat(getComputedStyle(line).paddingLeft)-source.left-24)<1&&Math.abs(body.getBoundingClientRect().left+parseFloat(getComputedStyle(body).paddingLeft)-preview.left-24)<1;})()`));
  }
  await openWorkspaceFind(page);
  const find = await within('#find-modal'); check('find is compact and within viewport', find.inside && find.width <= 480 && find.height <= 160);
  check('find is nonmodal', await page.evaluate(`document.querySelectorAll('.modal-overlay.show').length===0 && document.querySelector('#find-modal [aria-modal=true]')===null`));
  await page.fill('#find-input', 'alpha');
  // Case-insensitive is the Figma default; whole-word filtering is enabled below.
  await page.click('.writing-find-options button:nth-child(2)');
  await page.click('#find-modal [data-find-action="next"]');
  await page.waitFor(() => document.getElementById('find-status').textContent.includes('/ 3'));
  await page.fill('#replace-input', '想法');
  await snapshot('find');
  await page.click('#find-modal [data-find-action="replace-all"]');
  assert.equal(await app.getEditorValue(), sample.replace('alpha ALPHA scatteralpha alpha', '想法 想法 scatteralpha 想法'));
  await page.click('#find-modal [data-find-action="close"]'); await page.pressKey('z', { modifiers: 2, code: 'KeyZ' });
  assert.equal(await app.getEditorValue(), sample); check('filtered replace and undo');
  check('header has no duplicate insert entry', await page.evaluate(`document.querySelector('.writing-actions [data-editor-action="toggle-insert"]')===null`));
  await page.click('[data-menu-toggle="insert-menu"]');
  await snapshot('insert');
  await page.click('#insert-menu [data-editor-action="open-link"]');
  await page.waitFor(() => document.getElementById('link-modal').classList.contains('show'));
  await page.pressKey('Escape'); check('insert opens existing link flow');
  await page.click('[data-menu-toggle="help-menu"]'); await page.click('[data-help-open]');
  await page.waitFor(() => document.getElementById('help-modal').classList.contains('show'));
  const help = await within('#help-modal .modal'); check('help is compact', help.inside && help.width <= 600 && help.height <= 320);
  await snapshot('help'); await page.click('[data-help-page="markdown"]');
  check('help theme switch', await page.evaluate(`document.querySelector('[data-help-page-panel="markdown"]')!==null`));
  await page.pressKey('Escape');
  await openWorkspaceExport(page);
  await page.waitFor(() => document.getElementById('export-document-modal').classList.contains('show'));
  await page.click('.writing-export-formats button:nth-child(4)'); await page.selectOption('#export-document-background', 'dark');
  const exp = await within('.writing-export-dialog'); check('export is compact', exp.inside && exp.width <= 520 && exp.height < 330);
  await snapshot('export');
  await page.click('#export-document-modal .modal-footer .primary');
  await page.waitFor(() => document.getElementById('export-image-preview')?.getAttribute('src')?.startsWith('data:image/png'), { timeoutMs: 30000, description: 'actual dark PNG generation' });
  const png = await page.evaluate(`(async()=>{const image=document.getElementById('export-image-preview');await image.decode();const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:image.naturalWidth,height:image.naturalHeight,pixel:Array.from(ctx.getImageData(0,0,1,1).data)};})()`);
  assert.equal(png.width, 1080); assert.ok(png.height >= 1920); assert.deepEqual(png.pixel, [16, 23, 34, 255]); report.png = png; check('real PNG dimensions and dark background');
  await page.waitFor(() => !document.querySelector('.export-progress-overlay.show'), { timeoutMs: 30000 });
  await theme('dark'); await snapshot('writing-dark');
  const previousPng = await page.evaluate("document.getElementById('export-image-preview').getAttribute('src')");
  await page.connection.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(artifacts, 'downloads-light') });
  await openWorkspaceExport(page);
  await page.selectOption('#export-document-background', 'light');
  await page.click('#export-document-modal .modal-footer .primary');
  await page.waitFor(`document.getElementById('export-image-preview')?.getAttribute('src')?.startsWith('data:image/png') && document.getElementById('export-image-preview').getAttribute('src') !== ${JSON.stringify(previousPng)}`, { timeoutMs: 30000 });
  const lightPixel = await page.evaluate(`(async()=>{const image=document.getElementById('export-image-preview');await image.decode();const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return Array.from(ctx.getImageData(0,0,1,1).data);})()`);
  assert.deepEqual(lightPixel, [255, 255, 255, 255]);
  check('light PNG is isolated from dark application theme', await page.evaluate("document.body.dataset.theme === 'dark'"));
  report.lightPngPixel = lightPixel;
  await page.waitFor(() => !document.querySelector('.export-progress-overlay.show'), { timeoutMs: 30000 });
  await theme('light');
  await page.pressKey('F10', { modifiers: 1, code: 'F10' });
  check('format toolbar has a keyboard entry', await page.evaluate(`document.querySelector('.format-group').classList.contains('has-selection')`));
  check('keyboard pin and menu state agree', await page.evaluate(`document.querySelector('.format-group > [data-editor-action="pin-toolbar"]').getAttribute('aria-pressed')==='true'`));
  await snapshot('format-toolbar');
  await page.click('.format-group [data-editor-action="toggle-more"]');
  await page.waitFor(()=>!document.getElementById('settings-modal').hidden);
  check('More opens toolbar configuration instead of an oversized menu',await page.evaluate(`!document.querySelector('[data-settings-page-panel="toolbar"]').hidden && !document.getElementById('format-more-menu').classList.contains('show')`));
  await back(); await page.click('.format-group > [data-editor-action="pin-toolbar"]');
  for (const view of [{width:840,height:900,deviceScaleFactor:1}, {width:600,height:700,deviceScaleFactor:1}, {width:900,height:480,deviceScaleFactor:1.25}, {width:1440,height:960,deviceScaleFactor:1.5}]) {
    await page.setViewport(view); await settle();
    await checkFooter(view.width+'x'+view.height);
    const geometry = await page.evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:Array.from(document.querySelectorAll('.writing-actions > button,.writing-modes > button')).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})})`);
    check('responsive controls ' + view.width + 'x' + view.height, geometry.scroll <= view.width && geometry.controls.every(r => r.left >= 0 && r.right <= view.width + 1 && r.top >= 0 && r.bottom <= view.height));
    check('three-mode header stays centered at '+view.width,await page.evaluate(`(()=>{const h=document.querySelector('.l-toolbar-shell').getBoundingClientRect(),m=document.querySelector('.writing-modes').getBoundingClientRect();return h.height===76&&m.width===208&&Math.abs((h.left+h.right-m.left-m.right)/2)<1&&Math.abs((h.top+h.bottom-m.top-m.bottom)/2)<1&&document.querySelectorAll('.writing-modes button').length===3;})()`));
    await settings(); const settingsBox = await within('#settings-modal .preferences-content'); check('responsive settings ' + view.width, settingsBox.inside); await back();
    await snapshot(`${view.width}-${view.height}-${view.deviceScaleFactor}`); report.views.push({ ...view, geometry });
  }
  await page.setViewport({ width: 1440, height: 960 });
  report.checks.push(...await runBlueComponentChecks({ page, app, artifacts }));
  report.checks.push(...await runWritingPreferenceChecks({ page, app, artifacts }));
  report.checks.push(...await runQuoteHeightChecks({ page, app, artifacts }));
  report.checks.push(...await runDropOutlineFluidChecks({page,app,artifacts}));
  check('no page exceptions', page.exceptions.length === 0);
  check('no console errors', page.consoleMessages.filter(entry => entry.type === 'error').length === 0);
  await page.evaluate(`delete globalThis.__figmaEditor;delete globalThis.__figmaScroll;delete globalThis.__figmaScrollTop;`);
  return report;
}
