import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPreviewEnhancer, mountClassicExportEnhancementPort, createExportTaskController,
  ExportCancelledError, ExportDocumentStaleError } from '../src/features/export/index.js';

class Element {
  constructor(tag = 'div', text = '') { this.tagName = tag.toUpperCase(); this.text = text; this.children = []; this.className = ''; this.dataset = {}; }
  get textContent() { return this.text + this.children.map(x => x.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  get classList() { return { add: name => { this.className += ' ' + name; } }; }
  append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
  matches(selector) { return selector.split(',').some(raw => {
    const value = raw.trim();
    if (value === 'pre > code' || value === ':scope > code') return this.tagName === 'CODE' && this.parentElement?.tagName === 'PRE';
    if (value === 'code.language-mermaid') return this.tagName === 'CODE' && this.className.split(/\s+/).includes('language-mermaid');
    if (value === 'input[type="checkbox"]') return this.tagName === 'INPUT' && this.type === 'checkbox';
    return this.tagName.toLowerCase() === value;
  }); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  replaceWith(node) { const parent = this.parentElement; const index = parent.children.indexOf(this); parent.children[index] = node; node.parentElement = parent; this.parentElement = null; }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const cancellation = reason => error => error instanceof ExportCancelledError && error.reason === reason;

function harness(t, { count = 40, diagrams = false } = {}) {
  let version = 7, documentId = 'a', serial = 0;
  const calls = [], frames = new Map(), contexts = new WeakMap(), root = new Element();
  const children = Array.from({ length: count }, () => new Element('div', '$x$'));
  root.append(...children); contexts.set(root, Object.freeze({ documentId, documentVersion: version }));
  const addCode = (parent, language, text) => { const pre = new Element('pre'), code = new Element('code', text); code.className = 'language-' + language; pre.append(code); parent.append(pre); return { pre, code }; };
  const diagram = diagrams ? addCode(children[0], 'mermaid', 'flowchart TD\n A-->B') : null;
  const controller = createExportTaskController(), task = controller.begin('enhance');
  const presentation = {
    code: { renderHighlightedCodeRows(code, source, language, options) { calls.push(['code', source, language, options]); } },
    math: { containsMath: text => text.includes('$'), renderTree(node, options) { calls.push(['math', node, options]); }, delimiters: [] },
    mermaid: { getTheme: () => 'dark', async renderDiagram(container, source, options) { calls.push(['mermaid', source, options]); if (options.isCancelled()) return { status: 'cancelled' }; container.textContent = 'rendered'; return { status: 'rendered' }; } }
  };
  const options = { documentRef: { body: new Element('body'), createElement: tag => new Element(tag) },
    documentModel: { getDocumentVersion: () => version }, getActiveDocumentId: () => documentId,
    builder: { getSourceContext(body) { const source = contexts.get(body); if (!source) throw new TypeError('Unknown body'); return source; } }, presentation,
    requestFrame(callback) { const handle = ++serial; frames.set(handle, callback); return handle; }, cancelFrame: handle => frames.delete(handle) };
  const enhancer = createExportPreviewEnhancer(options);
  t.after(() => { enhancer.destroy(); controller.destroy(); });
  return { root, children, diagram, addCode, calls, frames, options, presentation, enhancer, controller, task,
    setVersion: value => { version = value; }, setDocument: value => { documentId = value; },
    async flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); await Promise.resolve(); } };
}
async function drain(h, work) {
  let settled = false, value, error;
  work.then(result => { value = result; settled = true; }, failure => { error = failure; settled = true; });
  for (let i = 0; i < 2000 && !settled; i++) { await Promise.resolve(); if (h.frames.size) await h.flush(); }
  assert.equal(settled, true, 'Controlled operation must settle.');
  if (error) throw error;
  return value;
}

test('R14-07 detached complete body applies task/code/math/Mermaid in ordered 18-node batches without editor controls', async t => {
  const h = harness(t, { diagrams: true }), progress = [];
  for (const child of h.children) {
    h.addCode(child, 'js', 'const x = "<safe>";\n');
    const list = new Element('ul'), item = new Element('li'), checkbox = new Element('input'); checkbox.type = 'checkbox'; item.append(checkbox); list.append(item); child.append(list);
  }
  const unsubscribe = h.controller.subscribe(s => { if (s.activeTask?.phase === 'enhancing') progress.push(s.activeTask.message); });
  t.after(unsubscribe);
  assert.equal(await drain(h, h.enhancer.enhance({ root: h.root, task: h.task })), h.root);
  assert.equal(h.calls.filter(x => x[0] === 'code').length, 40); assert.equal(h.calls.filter(x => x[0] === 'math').length, 40);
  assert.equal(h.calls.filter(x => x[0] === 'mermaid').length, 1);
  for (const call of h.calls.filter(x => x[0] === 'code')) { assert.equal(call[1], 'const x = "<safe>";\n'); assert.deepEqual(call[3], { variant: 'preview', includeSourceNewlines: true }); }
  assert.ok(h.root.querySelector('li').className.includes('task-item')); assert.ok(h.root.querySelector('ul').className.includes('task-list'));
  assert.equal(h.diagram.pre.parentElement, null); assert.deepEqual(progress.map(x => Number(x.match(/ (\d+)\//)[1])), [18, 36, 40]);
  assert.equal(h.frames.size, 0); assert.equal(h.calls.find(x => x[0] === 'mermaid')[2].theme, 'dark');
});

test('R14-07 empty body remains complete and unknown body is rejected before work', async t => {
  const h = harness(t, { count: 0 }); assert.equal(await h.enhancer.enhance({ root: h.root }), h.root);
  await assert.rejects(h.enhancer.enhance({ root: new Element() }), TypeError); assert.deepEqual(h.calls, []);
});
test('R14-07 top-level fenced code is enhanced once and preserves source newlines', async t => {
  const h = harness(t, { count: 0 }), { pre } = h.addCode(h.root, 'js', 'const x = 1;\n');
  assert.equal(await h.enhancer.enhance({ root: h.root }), h.root);
  assert.equal(h.root.children[0], pre); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], ['code', 'const x = 1;\n', 'js', { variant: 'preview', includeSourceNewlines: true }]);
});
test('R14-07 mixed-case Mermaid language uses the shared diagram renderer rather than code rows', async t => {
  const h = harness(t, { count: 1, diagrams: true }); h.diagram.code.className = 'language-Mermaid';
  assert.equal(await h.enhancer.enhance({ root: h.root }), h.root);
  assert.equal(h.calls.filter(x => x[0] === 'code').length, 0); assert.equal(h.calls.filter(x => x[0] === 'mermaid').length, 1);
  assert.equal(h.root.contains(h.diagram.pre), false);
});
for (const change of ['version', 'document', 'requested']) test(`R14-07 ${change} mismatch rejects before any enhancement`, async t => {
  const h = harness(t); if (change === 'version') h.setVersion(8); if (change === 'document') h.setDocument('b');
  await assert.rejects(h.enhancer.enhance({ root: h.root, documentId: change === 'requested' ? 'b' : 'a' }), ExportDocumentStaleError);
  assert.deepEqual(h.calls, []); assert.equal(h.frames.size, 0);
});
for (const reason of ['cancelled', 'replaced', 'destroyed']) test(`R14-07 ${reason} during a frame drops later batches and releases the owned frame`, async t => {
  const h = harness(t), work = h.enhancer.enhance({ root: h.root, task: h.task });
  const rejected = assert.rejects(work, cancellation(reason)); assert.equal(h.frames.size, 1);
  if (reason === 'cancelled') h.controller.cancel(); if (reason === 'replaced') h.controller.begin('next'); if (reason === 'destroyed') h.controller.destroy();
  await rejected; assert.equal(h.calls.length, 18); assert.equal(h.frames.size, 0);
});
for (const change of ['version', 'document']) test(`R14-07 ${change} change across a frame rejects mixed-generation output`, async t => {
  const h = harness(t), work = h.enhancer.enhance({ root: h.root }); const rejected = assert.rejects(work, ExportDocumentStaleError);
  if (change === 'version') h.setVersion(8); else h.setDocument('b'); await h.flush(); await rejected;
  assert.equal(h.calls.length, 18); assert.equal(h.frames.size, 0);
});
for (const reason of ['cancelled', 'replaced', 'destroyed']) test(`R14-07 ${reason} interrupts Mermaid and prevents a late DOM commit`, async t => {
  const h = harness(t, { count: 1, diagrams: true }), pending = deferred(); let predicate;
  h.presentation.mermaid.renderDiagram = (_node, _source, options) => { predicate = options.isCancelled; return pending.promise; };
  const work = h.enhancer.enhance({ root: h.root, task: h.task }), rejected = assert.rejects(work, cancellation(reason));
  if (reason === 'cancelled') h.controller.cancel(); if (reason === 'replaced') h.controller.begin('next'); if (reason === 'destroyed') h.controller.destroy();
  await rejected; assert.equal(predicate(), true); pending.resolve({ status: 'rendered' }); await Promise.resolve();
  assert.equal(h.root.contains(h.diagram.pre), true); assert.equal(h.diagram.code.textContent, 'flowchart TD\n A-->B');
});
for (const wait of ['frame', 'mermaid']) test(`R14-07 independent enhancer destruction interrupts ${wait} without a task`, async t => {
  const h = harness(t, { count: wait === 'frame' ? 40 : 1, diagrams: wait === 'mermaid' }), pending = deferred();
  if (wait === 'mermaid') h.presentation.mermaid.renderDiagram = () => pending.promise;
  const work = h.enhancer.enhance({ root: h.root }), rejected = assert.rejects(work, cancellation('destroyed'));
  h.enhancer.destroy(); h.enhancer.destroy(); await rejected; assert.equal(h.frames.size, 0);
  if (wait === 'mermaid') pending.reject(new Error('late vendor error')); await Promise.resolve();
  await assert.rejects(h.enhancer.enhance({ root: h.root }), cancellation('destroyed'));
});
for (const change of ['version', 'document', 'source', 'removed']) test(`R14-07 pending diagram rejects changed ${change} before replacement`, async t => {
  const h = harness(t, { count: 1, diagrams: true }), pending = deferred();
  h.presentation.mermaid.renderDiagram = () => pending.promise;
  const work = h.enhancer.enhance({ root: h.root }), rejected = assert.rejects(work, ExportDocumentStaleError);
  if (change === 'version') h.setVersion(8); if (change === 'document') h.setDocument('b');
  if (change === 'source') h.diagram.code.textContent = 'flowchart TD\n C-->D';
  if (change === 'removed') h.children[0].children = [];
  pending.resolve({ status: 'rendered' }); await rejected; assert.equal(h.diagram.pre.parentElement, h.children[0]);
});
test('R14-07 a newer enhancement of the same body releases the older wait and rejects its late diagram', async t => {
  const h = harness(t, { count: 1, diagrams: true }), pending = deferred(); let first = true;
  h.presentation.mermaid.renderDiagram = async (_node, _source, options) => { if (first) { first = false; return pending.promise; } return { status: 'rendered' }; };
  const old = h.enhancer.enhance({ root: h.root }), rejected = assert.rejects(old, cancellation('replaced'));
  assert.equal(await h.enhancer.enhance({ root: h.root }), h.root); await rejected;
  const current = h.children[0].children[0]; pending.resolve({ status: 'rendered' }); await Promise.resolve();
  assert.equal(h.children[0].children[0], current); assert.notEqual(current, h.diagram.pre);
});
for (const kind of ['math', 'mermaid']) test(`R14-07 ${kind} failure propagates and does not prevent an independent retry`, async t => {
  const h = harness(t, { count: 1, diagrams: true }), failure = new Error('render failed');
  const owner = h.presentation[kind], key = kind === 'math' ? 'renderTree' : 'renderDiagram', render = owner[key];
  owner[key] = () => { throw failure; }; await assert.rejects(h.enhancer.enhance({ root: h.root }), error => error === failure);
  assert.equal(h.root.contains(h.diagram.pre), true); owner[key] = render;
  assert.equal(await h.enhancer.enhance({ root: h.root }), h.root); assert.equal(h.frames.size, 0);
});
test('R14-07 cancellation from enhancement progress stops before another frame or batch', async t => {
  const h = harness(t); const unsubscribe = h.controller.subscribe(s => { if (s.activeTask?.phase === 'enhancing') h.controller.cancel(); }); t.after(unsubscribe);
  await assert.rejects(h.enhancer.enhance({ root: h.root, task: h.task }), cancellation('cancelled'));
  assert.equal(h.calls.length, 18); assert.equal(h.frames.size, 0);
});
test('R14-07 enhancement bridge owns only its immutable scoped capability', async t => {
  const h = harness(t, { count: 0 }), host = {}, mount = mountClassicExportEnhancementPort(host, h.enhancer);
  assert.ok(Object.isFrozen(mount.port)); assert.deepEqual(Object.keys(host), []);
  assert.throws(() => mountClassicExportEnhancementPort(host, h.enhancer), /already mounted/);
  assert.equal(await mount.port.enhance({ root: h.root }), h.root); mount.destroy(); mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorExportEnhancementPort'), false); assert.throws(() => mount.port.enhance({ root: h.root }), /destroyed/);
  assert.equal(await h.enhancer.enhance({ root: h.root }), h.root);
  assert.throws(() => mountClassicExportEnhancementPort(null, h.enhancer), TypeError);
});
test('R14-07 required presentation/model/Builder/frame capabilities fail at construction', t => {
  const h = harness(t); for (const key of ['documentRef', 'documentModel', 'getActiveDocumentId', 'builder', 'presentation', 'requestFrame', 'cancelFrame']) {
    assert.throws(() => createExportPreviewEnhancer({ ...h.options, [key]: null }), TypeError);
  }
});
