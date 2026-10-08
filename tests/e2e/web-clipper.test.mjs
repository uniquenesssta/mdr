import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';
const purifier = (await readFile(new URL(import.meta.resolve('dompurify')))).toString('base64');
const browser = await launchChromium(); let host;
try {
  host = await installVirtualFileHost(browser.page, { root: fileURLToPath(new URL('../../', import.meta.url)) });
  await browser.page.setDocumentContent('<!doctype html><head><script type="importmap">' + JSON.stringify({ imports: { dompurify: 'data:text/javascript;base64,' + purifier } }) + '</script></head><body><button id="launcher">Open</button><div id="overlay-root"></div></body>');
  const result = await browser.page.evaluate(`(async () => {
    const { createWebClipperController, createWebClipperView, createWebFetchCoordinator, extractHtml, convertExtractedHtml } = await import(${JSON.stringify(host.origin)} + '/src/features/import/index.js');
    const overlayRoot = document.getElementById('overlay-root'), inserted = [], notices = [];
    let resolve, localeListener, locale = 'zh', localeDisposals = 0;
    const coordinator = createWebFetchCoordinator({ nativeFetch: url => url === 'bad' ? Promise.reject(new Error('<img onerror=attack()>')) : new Promise(done => { resolve = done; }) });
    const controller = createWebClipperController({ fetchCoordinator: coordinator, extract: extractHtml, convert: convertExtractedHtml, insertMarkdown: text => inserted.push(text), native: true });
    const translate = (key, error) => error || (key === 'urlTitle' ? locale + ':' + key : key);
    const view = createWebClipperView({ overlayRoot, controller, translate, notify: message => notices.push(message),
      subscribeLocale: listener => { localeListener = listener; return () => { localeDisposals++; localeListener = null; }; } });
    const root = view.root;
    let duplicate = false;
    try { createWebClipperView({ overlayRoot, controller, translate, notify() {} }); } catch (error) { duplicate = /already mounted/.test(error.message); }
    const input = (id, value) => { const node = root.querySelector('#' + id); node.value = value; node.dispatchEvent(new Event('input')); };
    const frames = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    document.getElementById('launcher').focus(); view.open(); await frames();
    const focus = document.activeElement.id === 'url-input';
    view.open(); const repeatedOpen = controller.snapshot.open && view.isOpen();
    root.querySelector('[data-clipper-close]').focus();
    root.querySelector('[data-clipper-close]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    const trapped = document.activeElement.matches('[data-clipper-insert]');
    locale = 'en'; localeListener(); const translated = root.querySelector('#url-modal-title span').textContent === 'en:urlTitle';
    input('url-input', 'old'); const pending = controller.fetch();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const escaped = !controller.snapshot.open && !view.isOpen();
    await frames(); const returnedFocus = document.activeElement.id === 'launcher';
    view.open(); resolve('<p>late</p>'); await pending;
    const late = controller.snapshot.hasContent;
    root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const backdrop = !view.isOpen() && !controller.snapshot.open;
    view.open(); input('url-input', 'bad'); await controller.fetch();
    const errorText = root.querySelector('#url-status').textContent;
    const active = Boolean(root.querySelector('#url-status img'));
    input('manual-html', '<article><h1>Title</h1><p>Body</p></article>');
    root.querySelector('[data-clipper-insert]').click(); root.querySelector('[data-clipper-insert]').click();
    view.open(); input('url-input', 'destroy'); const unfinished = controller.fetch();
    view.destroy(); view.destroy();
    input('manual-html', 'after destroy'); root.querySelector('[data-clipper-fetch]').click(); root.querySelector('[data-clipper-insert]').click();
    resolve('<p>late after destroy</p>'); await unfinished;
    const removed = !document.getElementById('url-modal');
    const terminal = !controller.snapshot.open && !controller.snapshot.hasContent && !view.isOpen();
    let destroyedError = false; try { view.open(); } catch (error) { destroyedError = /destroyed/.test(error.message); }
    const successorController = createWebClipperController({ fetchCoordinator: coordinator, extract: value => value, convert: value => value, insertMarkdown() {} });
    const successor = createWebClipperView({ overlayRoot, controller: successorController, translate, notify() {} });
    view.destroy(); const successorOwned = document.getElementById('url-modal') === successor.root;
    successor.destroy();
    let rollbackDestroyed = false, rollbackError = false;
    try { createWebClipperView({ overlayRoot, translate, notify() {}, controller: {
      subscribe() { throw new Error('subscribe failure'); }, destroy() { rollbackDestroyed = true; } } }); }
    catch (error) { rollbackError = /subscribe failure/.test(error.message); }
    const rollback = rollbackError && rollbackDestroyed && !document.getElementById('url-modal');
    const cleanupController = createWebClipperController({ fetchCoordinator: coordinator, extract: value => value, convert: value => value, insertMarkdown() {} });
    const cleanupView = createWebClipperView({ overlayRoot, controller: cleanupController, translate, notify() {},
      subscribeLocale: () => () => { throw new Error('locale cleanup failure'); } });
    cleanupView.open(); let cleanupError = false;
    try { cleanupView.destroy(); } catch (error) { cleanupError = error instanceof AggregateError; }
    cleanupView.destroy();
    const cleanup = cleanupError && !cleanupController.snapshot.open && !document.getElementById('url-modal');
    coordinator.destroy();
    return { inserted, notices, duplicate, focus, repeatedOpen, trapped, translated, escaped, returnedFocus, backdrop,
      late, errorText, active, removed, terminal, destroyedError, localeDisposals, successorOwned, rollback, cleanup };
  })()`);
  assert.deepEqual(result.inserted, ['# Title\n\nBody']); assert.equal(result.late, false);
  assert.equal(result.errorText, '<img onerror=attack()>'); assert.equal(result.active, false);
  assert.deepEqual(result.notices, ['toastInsertedMd']); assert.equal(result.localeDisposals, 1);
  for (const key of ['duplicate', 'focus', 'repeatedOpen', 'trapped', 'translated', 'escaped', 'returnedFocus', 'backdrop', 'removed', 'terminal', 'destroyedError', 'successorOwned', 'rollback', 'cleanup']) assert.equal(result[key], true, key);
  assert.deepEqual(host.errors, []);
  assert.deepEqual(browser.page.exceptions, [], 'owned clipper and dead DOM events must not raise uncaught errors');
  console.log('ok - R13.14 owned clipper DOM, focus/Escape/backdrop, translations, inert errors, late fetch isolation, single insertion, rollback and complete disposal');
} finally { try { await host?.close(); } finally { await browser.close(); } }
