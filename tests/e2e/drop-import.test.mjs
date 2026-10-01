import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const browser = await launchChromium({ width: 900, height: 700 });
let host;
try {
  host = await installVirtualFileHost(browser.page, { root, origin: 'https://markdown-editor.test' });
  await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${host.origin}/"></head><body><div id="overlay"></div><div id="outer"><div id="inner"></div></div></body></html>`);
  const result = await browser.page.evaluate(`(async () => {
    const { createDropImportController, createDropOverlayView } = await import(${JSON.stringify(host.origin)} + '/src/features/import/index.js');
    const overlay = document.getElementById('overlay');
    const outer = document.getElementById('outer'), inner = document.getElementById('inner');
    const calls = [], states = [];
    const view = createDropOverlayView({ element: overlay });
    const c = createDropImportController({ target: document });
    c.start({
      setOverlayVisible: view.setVisible,
      openBrowserText(file) { calls.push(['text', file.name]); return true; },
      openBrowserImage(file) { calls.push(['image', file.name]); return true; },
      openNativeText() { throw new Error('unexpected native text'); },
      openNativeImage() { throw new Error('unexpected native image'); },
      unsupported() { calls.push(['unsupported']); }, onError(error) { throw error; }
    });
    try {
      const emit = (target, type, dataTransfer) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
        target.dispatchEvent(event); return event.defaultPrevented;
      };
      emit(outer, 'dragenter'); emit(inner, 'dragenter'); emit(inner, 'dragleave'); states.push(overlay.classList.contains('show'));
      emit(outer, 'dragleave'); states.push(overlay.classList.contains('show'));
      const data = new DataTransfer(); data.items.add(new File(['body'], 'note.MD', { type: 'image/png' })); data.items.add(new File(['ignored'], 'ignored.md'));
      emit(outer, 'dragenter'); const prevented = emit(inner, 'drop', data); states.push(overlay.classList.contains('show'));
      const image = new DataTransfer(); image.items.add(new File(['image'], 'photo.bin', { type: 'image/png' })); emit(inner, 'drop', image);
      emit(outer, 'dragenter'); c.destroy(); view.destroy(); view.setVisible(true); states.push(overlay.classList.contains('show'));
      const latePrevented = emit(inner, 'drop', data); emit(inner, 'dragenter'); states.push(overlay.classList.contains('show'));
      await Promise.resolve();
      return { calls, states, prevented, latePrevented };
    } finally { c.destroy(); view.destroy(); }
  })()`);
  assert.deepEqual(result.calls, [['text', 'note.MD'], ['image', 'photo.bin']]);
  assert.deepEqual(result.states, [true, false, false, false, false]);
  assert.equal(result.prevented, true); assert.equal(result.latePrevented, false);
  assert.deepEqual(host.errors, []);
  console.log('ok - R13.4 real DOM nested drag, DataTransfer first-file routing, overlay and teardown');
} finally {
  try { await host?.close(); } finally { await browser.close(); }
}
