import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createExportRequest, createExportTaskController, createHtmlFontStyle, createHtmlFontAssets,
  createHtmlDocumentSerializer, createHtmlExporter, mountClassicHtmlExportPort, isExportCancelledError } from '../src/features/export/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';
import config from '../vite.config.js';

const css = '@font-face {font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/old.woff) format("woff");font-weight:normal;font-style:normal;}';
const font = 'data:font/woff2;base64,AA==';
const fontCss = createHtmlFontStyle({ mathCss: css, fonts: { 'KaTeX_Main-Regular.woff2': font } });
const source = '<h1>中文 😀</h1><p>complete body</p>';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const cancelled = reason => error => isExportCancelledError(error) && error.reason === reason;
function setup({ desktop = true, body = source, path = 'C:\\exports\\chosen.html' } = {}) {
  const calls = [], tasks = createExportTaskController(), state = { generation: 1, activeId: 'doc', version: 7, removed: false };
  const docs = { get generation() { return state.generation; }, get activeId() { return state.activeId; },
    getRecord: id => !state.removed && ['doc', 'other'].includes(id) ? { id } : null,
    isCurrentGeneration: value => value === state.generation };
  const model = { getDocumentVersion: () => state.version };
  const root = { innerHTML: body };
  const builder = { async build(options) { calls.push(['build', options]); return root; }, getSourceContext: () => ({ documentId: 'doc', documentVersion: 7 }) };
  const enhancer = { async enhance(options) { calls.push(['enhance', options]); return options.root; } };
  const assets = { async load() { calls.push(['assets']); return fontCss; } };
  const styles = { getCss(format) { assert.equal(format, 'html'); return '.export-document {color:#212529}'; } };
  const serializer = createHtmlDocumentSerializer({ styles });
  const platform = { capabilities: { desktop: { dialogs: desktop, fileSystem: desktop }, browser: { fileDownload: !desktop } },
    dialogs: { async saveFile(name, options) { calls.push(['save', name, options]); return path; } },
    files: { async writeText(path, content, options) { calls.push(['write', path, content, options]); } } };
  const owner = createHtmlExporter({ documentModel: model, documents: docs, builder, enhancer, assets, serializer, taskController: tasks, platform });
  const request = input => createExportRequest({ format: 'html', documentId: 'doc', name: 'report.docx', directory: 'C:\\custom', ...input });
  return { owner, tasks, state, docs, model, root, builder, enhancer, assets, styles, serializer, platform, calls, request };
}

test('R14-10 font package is detached, cached, complete and retries a failed import', async () => {
  let loads = 0, fail = true;
  const loaders = { 'KaTeX_Main-Regular.woff2': async () => { loads++; if (fail) throw new Error('font unavailable'); return font; } };
  const assets = createHtmlFontAssets({ mathCss: css, loaders });
  loaders['KaTeX_Main-Regular.woff2'] = () => { throw new Error('mutated'); };
  await assert.rejects(assets.load(), /font unavailable/); fail = false;
  assert.equal(await assets.load(), fontCss); assert.equal(await assets.load(), fontCss); assert.equal(loads, 2);
  assert.doesNotMatch(fontCss, /fonts\/|old\.woff/); assert.match(fontCss, /font-weight:normal;font-style:normal/);
});

test('R14-10 font package rejects missing, remote, duplicate or unsafe assets without hiding failures', () => {
  for (const fonts of [{}, { 'KaTeX_Main-Regular.woff2': 'https://font.invalid/file.woff2' },
    { 'a/KaTeX_Main-Regular.woff2': font, 'b/KaTeX_Main-Regular.woff2': font }]) assert.throws(() => createHtmlFontStyle({ mathCss: css, fonts }), TypeError);
  for (const mathCss of ['', '</style><script>bad()</script>']) assert.throws(() => createHtmlFontStyle({ mathCss, fonts: {} }), TypeError);
  assert.throws(() => createHtmlFontAssets({ mathCss: css, loaders: {} }), TypeError);
});

test('R14-10 standalone template escapes the full title and preserves trusted body/shared CSS without scripts', () => {
  const h = setup(), name = '<title>&\'" 😀.HTM';
  const html = h.serializer.serialize({ name, bodyHtml: source, fontCss });
  assert.ok(html.startsWith('<!DOCTYPE html>')); assert.ok(html.includes('<html lang="zh-CN">'));
  assert.ok(html.includes('<meta charset="utf-8">')); assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('<title>&lt;title&gt;&amp;&#39;&quot; 😀</title>')); assert.ok(html.includes(source));
  assert.ok(html.includes('<style>'+h.styles.getCss('html')+'</style>'));
  assert.doesNotMatch(html, /<script[\s>]|<link[\s>]|cdn\.jsdelivr|exportPresentationPort/i);
  assert.throws(() => h.serializer.serialize({ name: 'x', bodyHtml: source, fontCss: '</style>' }), TypeError);
  assert.throws(() => h.serializer.serialize({ name: 'x', bodyHtml: null, fontCss }), TypeError);
});

for (const desktop of [true, false]) for (const body of ['', source, '<p>中文 😀</p>\r\n'.repeat(30000)]) {
  test(`R14-10 ${desktop ? 'native' : 'browser'} retains complete empty/Unicode/large HTML body (${body.length})`, async () => {
    const h = setup({ desktop, body });
    const result = await h.owner.export({ request: h.request() });
    assert.equal(result.status, desktop ? 'written' : 'downloaded');
    const write = h.calls.find(x => x[0] === 'write');
    assert.ok(write[2].includes('\n'+body+'\n</body>')); assert.ok(write[2].includes(font));
    assert.deepEqual(write[3], { extension: 'html', reason: 'export', ...(!desktop ? { mimeType: 'text/html;charset=utf-8' } : {}) });
    assert.deepEqual(h.calls.map(x => x[0]), desktop ? ['build', 'enhance', 'assets', 'save', 'write'] : ['build', 'enhance', 'assets', 'write']);
    assert.equal(h.tasks.getSnapshot().activeTask, null);
  });
}

test('R14-10 all retained request names and directories are frozen before body/asset waits', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/stage-14-export/requests.json', import.meta.url)));
  for (const row of fixture.names) {
    const h = setup(), input = { format: 'html', documentId: 'doc', name: row.input, directory: 'C:\\custom' };
    h.builder.build = async () => { input.name = 'late.md'; input.directory = 'C:\\late'; return h.root; };
    await h.owner.export({ request: input });
    const save = h.calls.find(x => x[0] === 'save'); assert.equal(save[1], row.html);
    assert.deepEqual(save[2], { title: '导出 HTML', extension: 'html', extensions: ['html', 'htm'], filterName: 'HTML 文档', defaultDirectory: 'C:\\custom' });
  }
});

test('R14-10 invalid identity/format/options are rejected before task or body effects', async () => {
  const h = setup();
  for (const input of [undefined, { format: 'html', documentId: 'doc', name: 'x\0' }, h.request({ documentId: 'missing' }), h.request({ format: 'word' })]) {
    await assert.rejects(h.owner.export({ request: input })); assert.equal(h.tasks.getSnapshot().lastTaskId, 0); assert.deepEqual(h.calls, []);
  }
  await assert.rejects(h.owner.export({ request: h.request({ documentId: 'other' }) }), cancelled('document-changed'));
  assert.equal(h.tasks.getSnapshot().lastTaskId, 0);
});

test('R14-10 wrong Builder source identity/version cannot reach enhancement or serialization', async () => {
  for (const source of [{ documentId: 'other', documentVersion: 7 }, { documentId: 'doc', documentVersion: 8 }]) {
    const h = setup(); h.builder.getSourceContext = () => source;
    await assert.rejects(h.owner.export({ request: h.request() }), cancelled('document-changed'));
    assert.deepEqual(h.calls.map(x => x[0]), ['build']); assert.equal(h.tasks.getSnapshot().activeTask, null);
  }
});

for (const phase of ['build', 'enhance', 'assets', 'save']) for (const action of ['cancel', 'replace', 'destroy']) {
  test(`R14-10 ${action} during ${phase} rejects promptly and observes late failures without output`, async () => {
    const h = setup(), gate = deferred(), reached = deferred();
    const replacementFn = () => { reached.resolve(); return gate.promise; };
    if (phase === 'build') h.builder.build = replacementFn;
    if (phase === 'enhance') h.enhancer.enhance = replacementFn;
    if (phase === 'assets') h.assets.load = replacementFn;
    if (phase === 'save') h.platform.dialogs.saveFile = replacementFn;
    const operation = h.owner.export({ request: h.request() }); await reached.promise;
    let next; if (action === 'cancel') h.tasks.cancel(); else if (action === 'replace') next = h.tasks.begin('new'); else h.owner.destroy();
    await assert.rejects(operation, cancelled(action === 'cancel' ? 'user' : action === 'replace' ? 'replaced' : 'destroyed'));
    assert.equal(h.calls.some(x => x[0] === 'write'), false);
    assert.equal(h.tasks.getSnapshot().activeTask?.id ?? null, next?.id ?? null);
    gate.reject(new Error('late failure')); await Promise.resolve();
    if (next) h.tasks.finish(next); h.owner.destroy(); h.tasks.destroy();
  });
}

for (const mutation of ['generation', 'activeId', 'version', 'removed']) {
  test(`R14-10 ${mutation} change during dialog prevents publication`, async () => {
    const h = setup(), gate = deferred(), reached = deferred();
    h.platform.dialogs.saveFile = () => { reached.resolve(); return gate.promise; };
    const operation = h.owner.export({ request: h.request() }); await reached.promise;
    h.state[mutation] = mutation === 'removed' ? true : mutation === 'activeId' ? 'other' : 99; gate.resolve('C:\\chosen.html');
    await assert.rejects(operation, cancelled('document-changed'));
    assert.equal(h.calls.some(x => x[0] === 'write'), false); assert.equal(h.tasks.getSnapshot().activeTask, null);
  });
}

test('R14-10 synchronous serialization/locking progress reentry cannot publish stale output', async () => {
  for (const phase of ['serializing', 'writing']) {
    const h = setup(), unsubscribe = h.tasks.subscribe(snapshot => { if (snapshot.activeTask?.phase === phase) h.state.version++; });
    await assert.rejects(h.owner.export({ request: h.request() }), cancelled('document-changed')); unsubscribe();
    assert.equal(h.calls.some(x => x[0] === 'write'), false); assert.equal(h.tasks.getSnapshot().activeTask, null);
  }
});

test('R14-10 null/empty picker cancellation and invalid/partial platform capabilities never fall back', async () => {
  for (const path of [null, '', 17, false]) {
    const h = setup({ path });
    if (path === null || path === '') assert.equal((await h.owner.export({ request: h.request() })).status, 'cancelled');
    else await assert.rejects(h.owner.export({ request: h.request() }), /保存路径/);
    assert.equal(h.calls.some(x => x[0] === 'write'), false);
  }
  for (const [dialogs, files, download] of [[true, false, true], [false, true, true], [false, false, false]]) {
    const h = setup(); h.platform.capabilities.desktop = { dialogs, fileSystem: files }; h.platform.capabilities.browser.fileDownload = download;
    await assert.rejects(h.owner.export({ request: h.request() }), /不可用/); assert.equal(h.calls.some(x => ['save', 'write'].includes(x[0])), false);
  }
});

test('R14-10 body/enhancement/assets/serializer/dialog/write errors preserve identity and release the task', async () => {
  for (const phase of ['build', 'enhance', 'load', 'serialize', 'saveFile', 'writeText']) {
    const h = setup(), error = new Error(phase), bad = () => { throw error; };
    const deps = { documentModel: h.model, documents: h.docs, builder: h.builder, enhancer: h.enhancer,
      assets: h.assets, serializer: h.serializer, taskController: h.tasks, platform: h.platform };
    if (phase === 'serialize') deps.serializer = { serialize: bad };
    else ({ build: h.builder, enhance: h.enhancer, load: h.assets, saveFile: h.platform.dialogs, writeText: h.platform.files })[phase][phase] = bad;
    const owner = createHtmlExporter(deps); await assert.rejects(owner.export({ request: h.request() }), e => e === error);
    assert.equal(h.tasks.getSnapshot().activeTask, null);
  }
});

test('R14-10 accepted native write locks cancellation and competing requests until completion', async () => {
  const h = setup(), gate = deferred(), reached = deferred();
  h.platform.files.writeText = (...args) => { h.calls.push(['write', ...args]); reached.resolve(); return gate.promise; };
  const operation = h.owner.export({ request: h.request() }); await reached.promise;
  assert.equal(h.tasks.cancel(), false); assert.equal(h.tasks.begin('other'), null);
  assert.equal((await h.owner.export({ request: h.request() })).status, 'busy'); assert.equal(h.calls.filter(x => x[0] === 'write').length, 1);
  gate.resolve(); assert.equal((await operation).status, 'written'); assert.equal(h.tasks.getSnapshot().activeTask, null);
});

test('R14-10 destroy during an issued write rejects late completion without retrying or claiming rollback', async () => {
  const h = setup(), gate = deferred(), reached = deferred();
  h.platform.files.writeText = (...args) => { h.calls.push(['write', ...args]); reached.resolve(); return gate.promise; };
  const operation = h.owner.export({ request: h.request() }); await reached.promise;
  h.owner.destroy(); h.owner.destroy(); await assert.rejects(operation, cancelled('destroyed'));
  gate.reject(new Error('late write')); await Promise.resolve();
  assert.equal(h.calls.filter(x => x[0] === 'write').length, 1); assert.equal(h.tasks.getSnapshot().activeTask, null);
});

test('R14-10 scoped HTML port unloads independently and preserves a replacement property', async () => {
  const h = setup(), host = {}, mount = mountClassicHtmlExportPort(host, h.owner);
  assert.equal(Object.keys(host).length, 0); assert.equal(Object.isFrozen(mount.port), true);
  assert.throws(() => mountClassicHtmlExportPort(host, h.owner), /already/);
  const next = {}; Object.defineProperty(host, 'markdownEditorHtmlExportPort', { configurable: true, value: next });
  mount.destroy(); mount.destroy(); assert.equal(host.markdownEditorHtmlExportPort, next);
  assert.throws(() => mount.port.export({ request: h.request() }), /destroyed/);
  assert.equal((await h.owner.export({ request: h.request() })).status, 'written');
});

test('R14-10 actual classic HTML entry delegates without template CDN, direct blob or document authority', async () => {
  const h = createExportVmHost();
  try {
    await h.invoke('exportHTML'); assert.equal(h.downloads.length, 1);
    const html = await h.downloads[0].blob.text(); assert.doesNotMatch(html, /<script[\s>]|cdn\.jsdelivr|exportPresentationPort/i);
    assert.ok(html.includes('data:font/woff2;base64,')); assert.equal(h.taskPort.getSnapshot().activeTask, null);
    const classic = readFileSync(new URL('../public/app/export.js', import.meta.url), 'utf8').split('async function exportHTML()')[1].split('async function exportPDF()')[0];
    assert.doesNotMatch(classic, /new Blob|URL\.|\.build\(|\.enhance\(|<html|exportTextContent/);
  } finally { h.destroy(); }
});

test('R14-10 embedded font assets have their own lazy chunk and existing budgets remain enforced', () => {
  const chunks = config.build.rollupOptions.output.manualChunks;
  assert.equal(chunks('/parent/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2?inline'), 'katex-export-fonts');
  assert.equal(chunks('/parent/node_modules/katex/dist/katex.mjs'), 'katex-vendor');
  assert.equal(config.build.chunkSizeWarningLimit, 700); assert.equal(config.plugins.some(x => x.name === 'bundle-budget'), true);
});
