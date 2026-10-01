import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const browser = await launchChromium({ width: 900, height: 700 });
let host;
try {
  host = await installVirtualFileHost(browser.page, { root: projectRoot, origin: 'https://markdown-editor.test' });
  await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${host.origin}/"></head><body></body></html>`);
  const result = await browser.page.evaluate(`(async () => {
    const base = ${JSON.stringify(host.origin)};
    const { createBrowserFileReader } = await import(base + '/src/platform/browser/browser-file-reader.js');
    const { createFileImportController, createImageImportController } = await import(base + '/src/features/import/index.js');
    const reader = createBrowserFileReader();
    const importer = createFileImportController({
      readBrowserText: (file, options) => reader.readText(file, options),
      readNativeText: () => { throw new Error('native reader must not be called'); }
    });
    const body = '中文\\r\\n😀';
    const file = new File([body], 'note.md', { type: 'text/plain' });
    try {
      const images = createImageImportController({ readBrowserImage: reader.readDataUrl });
      let image, imageCancellation;
      try {
        const imageFile = new File([new Uint8Array([0, 1, 2])], 'a.png', { type: 'image/png' });
        image = await images.readFile(imageFile);
        const imagePending = images.readFile(imageFile).then(() => 'unexpected success', error => error.code);
        images.destroy();
        imageCancellation = await imagePending;
      } finally { images.destroy(); }
      const imported = await importer.readBrowserFile(file);
      const empty = await importer.readBrowserFile(new File([], 'empty.md'));
      const abort = new AbortController();
      const reading = reader.readText(file, { signal: abort.signal }).then(() => 'unexpected success', error => error.code);
      abort.abort();
      const adapterCancellation = await reading;
      const pending = importer.readBrowserFile(file).then(() => 'unexpected success', error => error.code);
      await Promise.resolve();
      importer.destroy();
      return { image, imageCancellation, imported, frozen: Object.isFrozen(imported), empty: empty.content, adapterCancellation, importCancellation: await pending };
    } finally { importer.destroy(); }
  })()`);
  assert.deepEqual(result.imported, { kind: 'text', name: 'note.md', filePath: '', content: '中文\r\n😀' });
  assert.deepEqual(result.image, { name: 'a.png', url: 'data:image/png;base64,AAEC' });
  assert.equal(result.imageCancellation, 'IMAGE_IMPORT_CANCELLED');
  assert.equal(result.frozen, true);
  assert.equal(result.empty, '');
  assert.equal(result.adapterCancellation, 'BROWSER_FILE_READ_CANCELLED');
  assert.equal(result.importCancellation, 'FILE_IMPORT_CANCELLED');
  assert.deepEqual(host.errors, []);
  console.log('ok - R13.3 real File/FileReader text, empty file, abort and destroy');
} finally {
  try { await host?.close(); } finally { await browser.close(); }
}

