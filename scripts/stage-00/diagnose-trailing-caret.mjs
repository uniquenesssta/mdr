import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChromium } from '../../tests/e2e/lib/cdp-browser.mjs';
import { installVirtualFileHost } from '../../tests/e2e/lib/virtual-file-host.mjs';

const projectRoot = resolve(new URL('../..', import.meta.url).pathname);
const browser = await launchChromium({ width: 1440, height: 1000 });
const virtualHost = await installVirtualFileHost(browser.page, {
  root: resolve(projectRoot, 'dist'),
  origin: 'https://markdown-editor-caret-diagnostic.test'
});

try {
  let appHtml = await readFile(resolve(projectRoot, 'dist/index.html'), 'utf8');
  const moduleMatch = appHtml.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
  const styleMatch = appHtml.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
  if (!moduleMatch || !styleMatch) throw new Error('Unable to locate built application assets');

  const moduleUrl = new URL(moduleMatch[1], `${virtualHost.origin}/`).href;
  const styleUrl = new URL(styleMatch[1], `${virtualHost.origin}/`).href;
  appHtml = appHtml
    .replace('<head>', `<head><base href="${virtualHost.origin}/">`)
    .replace(moduleMatch[0], '')
    .replace(styleMatch[0], '')
    .replace(/<script src="\/i18n\.js"><\/script>/, '');

  await browser.page.setDocumentContent(appHtml);
  await browser.page.evaluate(`(()=>{
    const values=new Map();
    const storage={getItem:key=>values.has(String(key))?values.get(String(key)):null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear(),key:index=>Array.from(values.keys())[index]??null,get length(){return values.size;}};
    Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
    window.__MARKDOWN_EDITOR_E2E__=true;
    localStorage.setItem('md_editor_help_shown','true');
    localStorage.setItem('md_editor_sidebar_visible','false');
  })()`);
  await browser.page.evaluate(`new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href=${JSON.stringify(styleUrl)};link.onload=resolve;link.onerror=()=>reject(new Error('stylesheet failed'));document.head.appendChild(link);})`);
  await browser.page.evaluate(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='${virtualHost.origin}/i18n.js';script.onload=resolve;script.onerror=()=>reject(new Error('i18n failed'));document.body.appendChild(script);})`);
  await browser.page.evaluate(`import(${JSON.stringify(moduleUrl)}).then(()=>true)`);
  await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), {
    timeoutMs: 20000,
    description: 'application ready'
  });

  const source = '```\n\n\n```\n\n';
  await browser.page.evaluate(`window.__markdownEditorE2E.loadMarkdown(${JSON.stringify(source)},{layout:'hybrid',selection:${source.length},codeVisualEditing:true,tableVisualEditing:true})`);
  await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), {
    description: 'closed code widget'
  });

  const before = await browser.page.evaluate(`(()=>{
    const editor=document.getElementById('editor');
    const view=editor?.virtualEditor?.view;
    const position=editor?.textLength;
    const rect=view?.coordsAtPos(position,1)||view?.coordsAtPos(position,-1);
    return {
      selectionStart:editor?.selectionStart,
      selectionEnd:editor?.selectionEnd,
      textLength:editor?.textLength,
      viewSelection:view?{anchor:view.state.selection.main.anchor,head:view.state.selection.main.head,empty:view.state.selection.main.empty}:null,
      hasFocus:view?.hasFocus,
      activeElement:document.activeElement?.className||document.activeElement?.tagName||'',
      presentation:editor?.virtualEditor?.getPresentationStats?.()||null,
      coordinate:rect?{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}:null,
      lines:view?Array.from({length:view.state.doc.lines},(_,index)=>{const line=view.state.doc.line(index+1);return {number:line.number,from:line.from,to:line.to,text:line.text};}):[],
      activeLines:Array.from(document.querySelectorAll('.cm-hybrid-source-active')).map(element=>{const rect=element.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,text:element.textContent||'',classes:element.className};})
    };
  })()`);
  console.log(`CARET_DIAGNOSTIC_BEFORE=${JSON.stringify(before)}`);
  if (!before.coordinate) throw new Error('Unable to resolve final document coordinate');

  await browser.page.clickAt(before.coordinate.left + 2, before.coordinate.top + Math.max(1, before.coordinate.bottom - before.coordinate.top) / 2);
  await new Promise(resolve => setTimeout(resolve, 600));

  const after = await browser.page.evaluate(`(()=>{
    const editor=document.getElementById('editor');
    const view=editor?.virtualEditor?.view;
    return {
      selectionStart:editor?.selectionStart,
      selectionEnd:editor?.selectionEnd,
      textLength:editor?.textLength,
      viewSelection:view?{anchor:view.state.selection.main.anchor,head:view.state.selection.main.head,empty:view.state.selection.main.empty}:null,
      hasFocus:view?.hasFocus,
      activeElement:document.activeElement?.className||document.activeElement?.tagName||'',
      presentation:editor?.virtualEditor?.getPresentationStats?.()||null,
      activeLines:Array.from(document.querySelectorAll('.cm-hybrid-source-active')).map(element=>{const rect=element.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,text:element.textContent||'',classes:element.className};}),
      allLines:Array.from(document.querySelectorAll('.cm-line')).map((element,index)=>{const rect=element.getBoundingClientRect();return {index,top:rect.top,bottom:rect.bottom,text:element.textContent||'',classes:element.className};})
    };
  })()`);
  console.log(`CARET_DIAGNOSTIC_AFTER=${JSON.stringify(after)}`);
} finally {
  await virtualHost.close();
  await browser.close();
}
