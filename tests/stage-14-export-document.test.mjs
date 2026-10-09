import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportDocumentBuilder, mountClassicExportDocumentPort, createExportTaskController,
  ExportDocumentStaleError, ExportCancelledError } from '../src/features/export/index.js';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function harness({ count = 137, length = 399999, synchronized = true, parser = true, parseError = false } = {}) {
  const calls = [], frames = new Map();
  let nextFrame = 0, version = 7, documentId = 'a', sourceCurrent = synchronized;
  const node = () => ({ children: [], className: '', textContent: '', html: '',
    append(...items) { for (const item of items) item.fragment ? this.children.push(...item.children) : this.children.push(item); },
    get innerHTML() { return this.html + escape(this.textContent) + this.children.map(x => x.innerHTML).join(''); }
  });
  const blocks = Array.from({ length: count }, (_, i) => `<p>block-${i}</p>`);
  const documentRef = { createElement: node, createDocumentFragment() { return { ...node(), fragment: true }; } };
  const documentModel = {
    getDocumentVersion: () => version, getTextLength: () => length,
    createSnapshot(reason) { calls.push(['snapshot', reason]); return '<safe> $x$ 😀'; }
  };
  const presentation = {
    markdown: parser ? { parse(value) { calls.push(['parse', value]); if (parseError) throw new Error('parse failed'); return '<p>' + escape(value) + '</p>'; } } : {},
    math: { protectSource(text, prefix) { calls.push(['protect', prefix]); return { text, placeholders: ['sentinel'] }; },
      restoreSource(html, placeholders) { calls.push(['restore', placeholders]); return html; } }
  };
  const preview = { capture() {
    calls.push(['capture']);
    if (!synchronized) return null;
    return Object.freeze({ blockCount: blocks.length, isCurrent: () => sourceCurrent,
      createBlockNodes(index) { calls.push(['block', index]); const result = node(); result.html = blocks[index]; return [result]; } });
  } };
  const options = { documentRef, documentModel, getActiveDocumentId: () => documentId, preview, presentation,
    createHtmlNodes(html) { calls.push(['materialize', html]); const result = node(); result.html = html; return [result]; },
    requestFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); }, reportError: (message, error) => calls.push(['error', message, error.message]) };
  const builder = createExportDocumentBuilder(options);
  const controller = createExportTaskController(), task = controller.begin('build');
  return { builder, controller, task, calls, frames, blocks, options,
    setVersion: value => { version = value; }, setDocument: value => { documentId = value; },
    invalidateSource: () => { sourceCurrent = false; },
    async flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(x => x()); await Promise.resolve(); await Promise.resolve(); },
    dispose() { builder.destroy(); controller.destroy(); } };
}
async function drain(h, work) {
  while (h.frames.size) await h.flush();
  return work;
}
const cancelled = reason => error => error instanceof ExportCancelledError && error.reason === reason;

for (const [length, ends] of [[399999, [96, 137]], [400000, [48, 96, 137]]]) {
  test(`R14-06 ${length} characters reuse all synchronized blocks in ordered batches without a full snapshot`, async () => {
    const h = harness({ length }), progress = [];
    const unsubscribe = h.controller.subscribe(s => { if (s.activeTask?.phase === 'building') progress.push(s.activeTask.message); });
    const body = await drain(h, h.builder.build({ task: h.task }));
    assert.equal(body.className, 'markdown-body'); assert.equal(body.innerHTML, h.blocks.join(''));
    assert.deepEqual(h.calls.filter(x => x[0] === 'block').map(x => x[1]), Array.from({length:137},(_,i)=>i));
    assert.deepEqual(progress.map(x => Number(x.match(/ (\d+)\//)[1])), ends);
    assert.equal(h.calls.some(x => ['snapshot','parse','materialize'].includes(x[0])), false);
    assert.equal(h.frames.size, 0); unsubscribe(); h.dispose();
  });
}

for (const options of [{ synchronized:false }, { count:0 }, { parser:false, synchronized:false }, { parseError:true, synchronized:false }]) {
  test(`R14-06 explicit snapshot fallback retains source and safe parser failure: ${JSON.stringify(options)}`, async () => {
    const h = harness(options), work = h.builder.build({ task:h.task });
    assert.equal(h.calls.some(x => x[0] === 'snapshot'), false, 'Snapshot follows a cancelable frame.');
    const body = await drain(h, work);
    assert.deepEqual(h.calls.filter(x => x[0] === 'snapshot'), [['snapshot','full-preview-export']]);
    assert.equal(h.calls.some(x => x[0] === 'block'), false);
    assert.ok(body.innerHTML.includes('&lt;safe&gt; $x$ 😀'));
    if (options.parseError || options.parser === false) {
      assert.equal(body.children[0].className, 'f-raw-fallback');
      assert.equal(body.children[0].textContent, '<safe> $x$ 😀');
    } else {
      assert.deepEqual(h.calls.find(x => x[0] === 'protect'), ['protect','EXPORT_MATH']);
      assert.deepEqual(h.calls.find(x => x[0] === 'restore'), ['restore',['sentinel']]);
      assert.equal(h.calls.filter(x => x[0] === 'materialize').length, 1);
    }
    assert.equal(h.frames.size, 0); h.dispose();
  });
}

for (const reason of ['cancelled','replaced','destroyed']) {
  test(`R14-06 ${reason} stops a pending Worker batch, drops later blocks and frees the frame`, async () => {
    const h = harness(), work = h.builder.build({task:h.task});
    const rejected = assert.rejects(work, cancelled(reason));
    assert.equal(h.calls.filter(x => x[0] === 'block').length, 96);
    if (reason === 'cancelled') h.controller.cancel();
    if (reason === 'replaced') h.controller.begin('replacement');
    if (reason === 'destroyed') h.controller.destroy();
    await rejected; assert.equal(h.frames.size, 0);
    assert.equal(h.calls.filter(x => x[0] === 'block').length, 96);
    assert.equal(h.calls.some(x => x[0] === 'snapshot'), false); h.dispose();
  });
}

test('R14-06 cancellation before snapshot consumes a late frame and permits the next build', async () => {
  const h = harness({synchronized:false}), work = h.builder.build({task:h.task});
  const callback = [...h.frames.values()][0], rejected = assert.rejects(work, cancelled('cancelled'));
  h.controller.cancel(); await rejected; callback(); await Promise.resolve();
  assert.equal(h.frames.size,0);assert.equal(h.calls.some(x=>x[0]==='snapshot'),false);
  h.controller.finish(h.task);
  const body=await drain(h,h.builder.build());assert.ok(body.innerHTML.includes('&lt;safe&gt;'));h.dispose();
});

for (const invalidation of ['version','document','preview']) {
  test(`R14-06 changed ${invalidation} rejects incomplete body rather than returning mixed generations`, async () => {
    const h=harness(), work=h.builder.build({task:h.task}), rejected=assert.rejects(work,ExportDocumentStaleError);
    if(invalidation==='version')h.setVersion(8);
    if(invalidation==='document')h.setDocument('b');
    if(invalidation==='preview')h.invalidateSource();
    await h.flush();await rejected;
    assert.equal(h.calls.filter(x=>x[0]==='block').length,96);assert.equal(h.frames.size,0);h.dispose();
  });
}

test('R14-06 wrong requested document fails before any capture, snapshot or DOM build', async () => {
  const h=harness();await assert.rejects(h.builder.build({documentId:'b'}),ExportDocumentStaleError);
  assert.deepEqual(h.calls,[]);h.dispose();
});

test('R14-06 model changes during explicit snapshot reject before parsing', async () => {
  const h=harness({synchronized:false});h.options.documentModel.createSnapshot=()=>{h.setVersion(8);return 'changed';};
  const work=h.builder.build(),rejected=assert.rejects(work,ExportDocumentStaleError);await h.flush();await rejected;
  assert.equal(h.calls.some(x=>x[0]==='parse'),false);h.dispose();
});

for (const synchronized of [true,false]) {
  test(`R14-06 builder destruction interrupts ${synchronized?'Worker':'snapshot'} waits without a task and is idempotent`, async () => {
    const h=harness({synchronized}),work=h.builder.build(),rejected=assert.rejects(work,cancelled('destroyed'));
    h.builder.destroy();h.builder.destroy();await rejected;assert.equal(h.frames.size,0);
    await assert.rejects(h.builder.build(),/destroyed/);h.dispose();
  });
}

test('R14-06 materialization errors propagate, release frames and do not replace failed output with raw HTML', async () => {
  const h=harness({synchronized:false});const failure=new Error('DOM failed');
  const builder=createExportDocumentBuilder({...h.options,createHtmlNodes(){throw failure;}});
  const work=builder.build(),rejected=assert.rejects(work,error=>error===failure);await h.flush();await rejected;
  assert.equal(h.frames.size,0);builder.destroy();h.dispose();
});

test('R14-06 public bridge is immutable, scoped, duplicate-safe and releases only its own capability', async () => {
  const h=harness({count:1}),host={},mount=mountClassicExportDocumentPort(host,h.builder);
  assert.ok(Object.isFrozen(mount.port));assert.equal(Object.keys(host).length,0);
  assert.throws(()=>mountClassicExportDocumentPort(host,h.builder),/already mounted/);
  assert.equal((await mount.port.build()).children.length,1);
  mount.destroy();mount.destroy();assert.equal(Object.hasOwn(host,'markdownEditorExportDocumentPort'),false);
  assert.throws(()=>mount.port.build(),/destroyed/);
  assert.equal((await h.builder.build()).children.length,1,'Bridge does not destroy its owner.');
  const next=mountClassicExportDocumentPort(host,h.builder);next.destroy();h.dispose();
});

test('R14-06 missing public dependencies and invalid bridge fail at construction', () => {
  const h=harness();
  for(const key of ['documentRef','documentModel','getActiveDocumentId','preview','createHtmlNodes','requestFrame','cancelFrame']) {
    assert.throws(()=>createExportDocumentBuilder({...h.options,[key]:null}),TypeError);
  }
  assert.throws(()=>mountClassicExportDocumentPort(null,h.builder),TypeError);
  assert.throws(()=>mountClassicExportDocumentPort({},{}),TypeError);h.dispose();
});
