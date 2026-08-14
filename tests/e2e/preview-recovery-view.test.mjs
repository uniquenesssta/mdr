import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const browser = await launchChromium({ width: 800, height: 600 });
const virtualHost = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });

try {
  await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${virtualHost.origin}/"></head><body><textarea id="editor">user draft</textarea><div id="preview"><div class="markdown-body"><p id="stable">stable preview</p></div></div></body></html>`);
  await browser.page.evaluate(`(async()=>{
    const base=${JSON.stringify(virtualHost.origin)};
    const {createPreviewRecoveryView}=await import(base+'/src/features/preview/ui/preview-recovery-view.js');
    const root=document.getElementById('preview');
    const editor=document.getElementById('editor');
    const stableBody=root.querySelector('.markdown-body');
    const view=createPreviewRecoveryView({root,documentRef:document});
    const preserved=view.recover({preserveStable:true});
    const preservedBody=root.querySelector('.markdown-body');
    root.replaceChildren();
    const fallback=view.recover({preserveStable:true});
    window.__recoveryResult={
      editorValue:editor.value,
      preservedSame:preserved.body===stableBody&&preservedBody===stableBody,
      preservedFlag:preserved.preserved,
      fallbackFlag:fallback.recovery,
      fallbackText:fallback.body.textContent,
      fallbackMarker:fallback.body.dataset.previewRecovery,
      fallbackClass:fallback.body.className
    };
    view.destroy();
  })()`);
  const result = await browser.page.evaluate(`window.__recoveryResult`);
  assert.equal(result.editorValue, 'user draft');
  assert.equal(result.preservedSame, true);
  assert.equal(result.preservedFlag, true);
  assert.equal(result.fallbackFlag, true);
  assert.equal(result.fallbackMarker, 'true');
  assert.equal(result.fallbackClass, 'markdown-body preview-loading');
  assert.equal(result.fallbackText, '后台预览恢复中，编辑内容与自动保存不受影响…');
  assert.deepEqual(virtualHost.errors, []);
  console.log('ok - Atomic 7.13 preserves stable preview or renders lightweight recovery without touching editor text');
} finally {
  await virtualHost.close();
  await browser.close();
}
