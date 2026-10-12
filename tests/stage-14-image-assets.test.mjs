import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createImageAssetPreloader, EXPORT_IMAGE_PLACEHOLDER, mountClassicImageAssetPort,
  createExportTaskController, isExportCancelledError } from '../src/features/export/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const cancelled = reason => error => isExportCancelledError(error) && error.reason === reason;
const image = src => ({ src, attrs: new Set(['srcset', 'sizes']), removeAttribute(name) { this.attrs.delete(name); } });
const root = images => ({ querySelectorAll: () => images, contains: item => images.includes(item) });

function fixture({ auto = true, autoFrames = true, timeoutMs = 10000, canvasFailure = null, loadFailure = null } = {}) {
  const loaders = [], canvases = [], timers = new Map(), frames = new Map(), requests = [], cleared = [];
  let handle = 0, onDraw = null, onCreate = null;
  const owner = createImageAssetPreloader({ timeoutMs, now: () => 123,
    createImage() {
      onCreate?.();
      if (loadFailure) throw loadFailure;
      let source = '';
      const loader = { naturalWidth: 2, naturalHeight: 3, onload: null, onerror: null,
        get src() { return source; }, set src(value) { source = value;
          if (value) { requests.push({ url: value, crossOrigin: this.crossOrigin });
            if (auto) queueMicrotask(() => this.onload?.()); }
        } };
      loaders.push(loader); return loader;
    },
    createCanvas() {
      if (canvasFailure === 'factory') throw new Error('canvas factory');
      const canvas = { width: 0, height: 0, getContext() { return canvasFailure === 'context' ? null : {
        drawImage() { onDraw?.(); if (canvasFailure === 'draw') throw new Error('draw'); }
      }; }, toDataURL() { if (canvasFailure === 'tainted') throw new Error('SecurityError'); return canvasFailure === 'invalid' ? 'data:,' : PNG; } };
      canvases.push(canvas); return canvas;
    },
    setTimer(callback, delay) { const id = ++handle; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { cleared.push(id); timers.delete(id); },
    requestFrame(callback) { const id = ++handle; frames.set(id, callback); if (autoFrames) queueMicrotask(callback); return id; },
    cancelFrame: id => frames.delete(id)
  });
  return { owner, loaders, canvases, timers, frames, requests, cleared,
    setDraw(callback) { onDraw = callback; }, setCreate(callback) { onCreate = callback; },
    timeout() { const value = timers.values().next().value; assert.ok(value); value.callback(); },
    clean() { assert.equal(timers.size, 0); assert.equal(frames.size, 0); for (const loader of loaders) {
      assert.equal(loader.onload, null); assert.equal(loader.onerror, null); assert.equal(loader.src, ''); }
      for (const canvas of canvases) { assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); } }
  };
}

test('R14-14 construction validates capabilities and timeout without starting I/O', () => {
  assert.throws(() => createImageAssetPreloader(), TypeError);
  for (const timeoutMs of [0, -1, Infinity, NaN, '10']) assert.throws(() => fixture({ timeoutMs }), TypeError);
  const h = fixture(); assert.equal(h.requests.length, 0); h.owner.destroy(); h.clean();
});

test('R14-14 missing root and malformed task reject before requesting images', async () => {
  const h = fixture(); await assert.rejects(h.owner.prepare({}), TypeError);
  await assert.rejects(h.owner.prepare({ root: root([]), task: {} }), TypeError); h.clean(); h.owner.destroy();
});

test('R14-14 empty body remains exportable and result is immutable', async () => {
  const h = fixture(); const result = await h.owner.prepare({ root: root([]) });
  assert.deepEqual(result, { total: 0, inline: 0, loaded: 0, failed: 0 }); assert.equal(Object.isFrozen(result), true);
  h.clean(); h.owner.destroy();
});

for (const source of ['https://image.test/a.png', 'https://image.test/a.png?keep=1', 'https://image.test/a.png#logo', 'https://image.test/a.png?keep=1#logo']) {
  test(`R14-14 anonymous image becomes inline PNG and retains query/fragment: ${source}`, async () => {
    const h = fixture(), item = image(source); const result = await h.owner.prepare({ root: root([item]) });
    assert.equal(h.requests[0].crossOrigin, 'anonymous');
    const url = new URL(h.requests[0].url); assert.equal(url.searchParams.get('_cors'), '123');
    assert.equal(url.searchParams.get('keep'), new URL(source).searchParams.get('keep')); assert.equal(url.hash, new URL(source).hash);
    assert.equal(item.src, PNG); assert.equal(item.attrs.size, 0); assert.deepEqual(result, { total: 1, inline: 0, loaded: 1, failed: 0 });
    h.clean(); h.owner.destroy();
  });
}

for (const source of [PNG, EXPORT_IMAGE_PLACEHOLDER, 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E']) {
  test(`R14-14 existing inline image preserves its source and decodes before capture: ${source.slice(0, 30)}`, async () => {
    const h = fixture(), item = image(source); let resolve, entered = false, done = false;
    item.decode = () => { entered = true; return new Promise(r => { resolve = r; }); };
    const work = h.owner.prepare({ root: root([item]) }).then(result => { done = true; return result; });
    await tick(); assert.equal(entered, true); assert.equal(done, false); assert.equal(h.canvases.length, 0);
    assert.equal(h.requests[0].url, source); assert.equal(h.requests[0].crossOrigin, undefined);
    resolve(); const result = await work; assert.equal(item.src, source); assert.equal(result.inline, 1); h.clean(); h.owner.destroy();
  });
}

test('R14-14 placeholder is the accepted neutral offline SVG byte-for-byte', () => {
  const svg = Buffer.from(EXPORT_IMAGE_PLACEHOLDER.split(',')[1], 'base64').toString();
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#e9ecef"/><text x="60" y="44" text-anchor="middle" font-size="12" fill="#6c757d">Image unavailable</text></svg>');
});

test('R14-14 load failure substitutes only that asset and proceeds to later success', async () => {
  const h = fixture({ auto: false }), bad = image('https://image.test/bad'), good = image('https://image.test/good');
  const work = h.owner.prepare({ root: root([bad, good]) }); h.loaders[0].onerror(); await tick(); h.loaders[1].onload();
  assert.deepEqual(await work, { total: 2, inline: 0, loaded: 1, failed: 1 }); assert.equal(bad.src, EXPORT_IMAGE_PLACEHOLDER); assert.equal(good.src, PNG); h.clean(); h.owner.destroy();
});

for (const canvasFailure of ['factory', 'context', 'draw', 'tainted', 'invalid']) {
  test(`R14-14 ${canvasFailure} pixel conversion failure remains a recoverable asset failure`, async () => {
    const h = fixture({ canvasFailure }), item = image('https://image.test/a');
    const result = await h.owner.prepare({ root: root([item]) }); assert.equal(result.failed, 1); assert.equal(item.src, EXPORT_IMAGE_PLACEHOLDER);
    const next = await h.owner.prepare({ root: root([image(PNG)]) }); assert.equal(next.inline, 1); h.clean(); h.owner.destroy();
  });
}

for (const source of ['', 'data:image/png;base64,broken']) {
  test(`R14-14 missing or broken inline resource uses placeholder: ${source}`, async () => {
    const h = fixture({ auto: false }), item = image(source), work = h.owner.prepare({ root: root([item]) });
    if (source) h.loaders[0].onerror(); assert.equal((await work).failed, 1); assert.equal(item.src, EXPORT_IMAGE_PLACEHOLDER); h.clean(); h.owner.destroy();
  });
}

test('R14-14 stuck loader times out, detaches captured callbacks and permits the next image', async () => {
  const h = fixture({ auto: false }), a = image('https://image.test/stall'), b = image(PNG);
  const work = h.owner.prepare({ root: root([a, b]) }), late = h.loaders[0].onload;
  h.timeout(); await tick(); late(); assert.equal(h.canvases.length, 0); h.loaders[1].onload();
  assert.deepEqual(await work, { total: 2, inline: 1, loaded: 0, failed: 1 }); assert.equal(a.src, EXPORT_IMAGE_PLACEHOLDER); h.clean(); h.owner.destroy();
});

test('R14-14 failed decode and even a stuck fallback decode are bounded before continuing', async () => {
  const h = fixture(), item = image(PNG); let count = 0;
  item.decode = () => ++count === 1 ? Promise.reject(new Error('decode failed')) : new Promise(() => {});
  const work = h.owner.prepare({ root: root([item, image(PNG)]) }); await tick(); assert.equal(count, 2); h.timeout();
  assert.equal((await work).failed, 1); assert.equal(item.src, EXPORT_IMAGE_PLACEHOLDER); h.clean(); h.owner.destroy();
});

for (const action of ['cancel', 'replace', 'destroy-task', 'destroy-preloader']) {
  test(`R14-14 ${action} releases loading immediately and late success cannot mutate a source`, async () => {
    const h = fixture({ auto: false }), c = createExportTaskController(), task = c.begin('assets'), item = image('https://image.test/a');
    const work = h.owner.prepare({ root: root([item]), task }), late = h.loaders[0].onload;
    const reason = action === 'cancel' ? 'cancelled' : action === 'replace' ? 'replaced' : 'destroyed';
    const rejected = assert.rejects(work, cancelled(reason));
    if (action === 'cancel') c.cancel(); else if (action === 'replace') c.begin('replacement'); else if (action === 'destroy-task') c.destroy(); else h.owner.destroy();
    await rejected; late(); assert.equal(item.src, 'https://image.test/a'); assert.equal(h.canvases.length, 0); h.clean(); c.destroy(); h.owner.destroy();
  });
}

test('R14-14 root replacement interrupts its own job without cancelling a different root', async () => {
  const h = fixture({ auto: false }), a = image(PNG), b = image(PNG), firstRoot = root([a]);
  const first = h.owner.prepare({ root: firstRoot }), rejected = assert.rejects(first, cancelled('replaced'));
  const independent = h.owner.prepare({ root: root([b]) }), replacement = h.owner.prepare({ root: firstRoot });
  await rejected; h.loaders[1].onload(); h.loaders[2].onload(); assert.equal((await independent).inline, 1); assert.equal((await replacement).inline, 1); h.clean(); h.owner.destroy();
});

for (const boundary of ['load', 'decode']) {
  test(`R14-14 ${boundary} stale source never overwrites newer DOM state`, async () => {
    const h = fixture({ auto: boundary === 'decode' }), item = image(PNG); let resolve;
    if (boundary === 'decode') item.decode = () => new Promise(r => { resolve = r; });
    const work = h.owner.prepare({ root: root([item]) }), rejected = assert.rejects(work, cancelled('stale-assets'));
    if (boundary === 'decode') await tick(); item.src = 'new-source'; if (boundary === 'load') h.loaders[0].onload(); else resolve();
    await rejected; assert.equal(item.src, 'new-source'); h.clean(); h.owner.destroy();
  });
}

test('R14-14 removing an image while loading prevents publication into detached content', async () => {
  const h = fixture({ auto: false }), item = image(PNG), items = [item], body = root(items), work = h.owner.prepare({ root: body });
  const rejected = assert.rejects(work, cancelled('stale-assets')); items.length = 0; h.loaders[0].onload(); await rejected; assert.equal(item.src, PNG); h.clean(); h.owner.destroy();
});

test('R14-14 cancellation during draw and construction cannot publish or leave callbacks', async () => {
  for (const boundary of ['draw', 'create']) {
    const h = fixture(), c = createExportTaskController(), task = c.begin('assets'), item = image('https://image.test/a');
    if (boundary === 'draw') h.setDraw(() => c.cancel()); else h.setCreate(() => c.cancel());
    await assert.rejects(h.owner.prepare({ root: root([item]), task }), cancelled('cancelled'));
    assert.equal(item.src, 'https://image.test/a'); h.clean(); c.destroy(); h.owner.destroy();
  }
});

test('R14-14 eight-image progress remains 90-95 and cancellation releases the yield frame', async () => {
  const h = fixture({ autoFrames: false }), c = createExportTaskController(), task = c.begin('assets'), seen = [];
  c.subscribe(snapshot => { if (snapshot.activeTask?.phase === 'images') seen.push(snapshot.activeTask.progress); });
  const work = h.owner.prepare({ root: root(Array.from({ length: 9 }, () => image(PNG))), task });
  await tick(); await tick(); await tick(); assert.equal(h.frames.size, 1); assert.deepEqual(seen, [91,91,92,92,93,93,94,94]);
  const rejected = assert.rejects(work, cancelled('cancelled')); c.cancel(); await rejected; assert.equal(h.loaders.length, 8); h.clean(); c.destroy(); h.owner.destroy();
});

test('R14-14 reentrant progress failure is not concealed as an asset fallback', async () => {
  const h = fixture(), c = createExportTaskController(), task = c.begin('assets'), failure = new Error('view failed');
  c.subscribe(snapshot => { if (snapshot.activeTask?.phase === 'images') throw failure; });
  await assert.rejects(h.owner.prepare({ root: root([image(PNG)]), task }), error => error === failure); h.clean(); c.destroy(); h.owner.destroy();
});

test('R14-14 independent destroy interrupts decode, observes late rejection and refuses reuse', async () => {
  const h = fixture(), item = image(PNG); let reject;
  item.decode = () => new Promise((_resolve, r) => { reject = r; });
  const work = h.owner.prepare({ root: root([item]) }); await tick(); const rejected = assert.rejects(work, cancelled('destroyed'));
  h.owner.destroy(); h.owner.destroy(); await rejected; reject(new Error('late decode')); await tick();
  await assert.rejects(h.owner.prepare({ root: root([]) }), cancelled('destroyed')); h.clean();
});

test('R14-14 scoped port is read-only, independently removable and preserves replacement properties', async () => {
  const h = fixture(), host = {}, mount = mountClassicImageAssetPort(host, h.owner);
  assert.equal(Object.isFrozen(mount.port), true); assert.equal(mount.port.placeholder, EXPORT_IMAGE_PLACEHOLDER);
  assert.throws(() => mountClassicImageAssetPort(host, h.owner), /already mounted/);
  Object.defineProperty(host, 'markdownEditorImageAssetPort', { value: 'replacement', configurable: true });
  mount.destroy(); mount.destroy(); assert.equal(host.markdownEditorImageAssetPort, 'replacement');
  assert.throws(() => mount.port.prepare({ root: root([]) }), /destroyed/);
  assert.equal((await h.owner.prepare({ root: root([]) })).total, 0); h.clean(); h.owner.destroy();
});

test('R14-14 classic command uses the public asset boundary before measurement and encoding', async () => {
  const h = createExportVmHost(); let prepared = false;
  // Observe public call inputs using a mounted capability rather than rewriting the production function.
  const source = readFileSync(new URL('../public/app/export.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /prepareExportImages|IMAGE_PLACEHOLDER|new Image\(|_cors=/);
  assert.match(source, /await exportImageAssetPort\.prepare\(\{ root: clone, task, isCurrent:/);
  const host = h.context.document.getElementById('compatibility-business-ports');
  host.markdownEditorPresentationPort.loadDomToImage = async () => ({ async toPng() {
    prepared = true; assert.equal(h.assetTimers.size, 0); return PNG;
  } });
  await h.invoke('renderExportImagePreview'); assert.equal(prepared, true); assert.equal(h.taskPort.getSnapshot().activeTask, null);
  assert.equal(h.context.document.getElementById('export-image-preview').src, PNG); h.destroy();
});

test('R14-14 document source guard rejects a version change while the asset is loading', async () => {
  const h = fixture({ auto: false }), item = image('https://image.test/a'); let current = true;
  const work = h.owner.prepare({ root: root([item]), isCurrent: () => current });
  const rejected = assert.rejects(work, cancelled('document-changed')); current = false; h.loaders[0].onload(); await rejected;
  assert.equal(item.src, 'https://image.test/a'); h.clean(); h.owner.destroy();
});

for (const boundary of ['fallback', 'success']) {
  test(`R14-14 real classic ${boundary} asset preparation completes before PNG capture`, async () => {
    const h = createExportVmHost(), item = image('https://image.test/a'); const loaders = [];
    const create = h.context.document.createElement; let clone = null;
    h.context.document.createElement = tag => {
      const node = create(tag); if (tag === 'div' && !clone) { clone = node;
        const contains = node.contains.bind(node); node.contains = value => value === item || contains(value);
        const query = node.querySelectorAll.bind(node); node.querySelectorAll = selector => selector === 'img' ? [item] : query(selector); }
      if (tag === 'canvas') { node.getContext = () => ({ drawImage() {} }); node.toDataURL = () => PNG; }
      return node;
    };
    h.context.Image = class { constructor() { this.naturalWidth = 2; this.naturalHeight = 3; loaders.push(this); }
      set src(value) { this.value = value; if (value) queueMicrotask(() => boundary === 'fallback' ? this.onerror?.() : this.onload?.()); }
      get src() { return this.value; } };
    let captured;
    h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort.loadDomToImage = async () => ({ async toPng(_root, options) {
      captured = item.src; assert.equal(h.taskPort.getSnapshot().activeTask.cancelable, false);
      assert.equal(options.imagePlaceholder, EXPORT_IMAGE_PLACEHOLDER); assert.equal(h.assetTimers.size, 0); return PNG;
    } });
    await h.invoke('renderExportImagePreview'); assert.equal(captured, boundary === 'fallback' ? EXPORT_IMAGE_PLACEHOLDER : PNG);
    assert.equal(h.taskPort.getSnapshot().activeTask, null); assert.equal(loaders.every(loader => loader.onload === null && loader.onerror === null), true); h.destroy();
  });
}

test('R14-14 a local Blob URL is read without corrupting its object identity or revoking caller ownership', async () => {
  const h = fixture(), item = image('blob:https://app.test/1234');
  assert.equal((await h.owner.prepare({ root: root([item]) })).loaded, 1);
  assert.equal(h.requests[0].url, 'blob:https://app.test/1234'); assert.equal(item.src, PNG); h.clean(); h.owner.destroy();
});

test('R14-14 cleanup faults still attempt independent callbacks and clear the deadline', async () => {
  const h = fixture({ auto: false }), item = image('https://image.test/a'), work = h.owner.prepare({ root: root([item]) });
  const loader = h.loaders[0], failure = new Error('callback cleanup'); let handler = loader.onload, clearedError = false;
  Object.defineProperty(loader, 'onload', { get: () => handler, set(value) { if (value === null) throw failure; handler = value; } });
  Object.defineProperty(loader, 'onerror', { configurable: true, set(value) { clearedError = value === null; } });
  handler(); assert.equal((await work).failed, 1); assert.equal(clearedError, true); assert.equal(loader.src, ''); assert.equal(h.timers.size, 0);
  assert.equal(item.src, EXPORT_IMAGE_PLACEHOLDER); h.owner.destroy();
});

test('R14-14 publication errors retain the original exception and do not strand preloader jobs', async () => {
  const h = fixture(), failure = new Error('DOM denied'); let src = 'https://image.test/a';
  const item = { get src() { return src; }, set src(value) { if (value.startsWith('data:')) throw failure; src = value; } };
  await assert.rejects(h.owner.prepare({ root: root([item]) }), error => error === failure); h.clean();
  assert.equal((await h.owner.prepare({ root: root([image(PNG)]) })).inline, 1); h.clean(); h.owner.destroy();
});
