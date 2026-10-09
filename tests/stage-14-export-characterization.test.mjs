import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createExportVmHost } from './support/export-vm-host.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/stage-14-export/contracts.json', import.meta.url), 'utf8'));
const requests = JSON.parse(readFileSync(new URL('./fixtures/stage-14-export/requests.json', import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const operations = { markdown: 'exportFile', html: 'exportHTML', word: 'exportWord', image: 'downloadExportImage' };

// Immutable R14-01 findings stay in contracts.json; current acceptance maps the repaired
// builder to public capabilities and retains later enhancer/print defects as failures.
test('R14-01 records the actual retired preview dependency instead of hiding it behind the VM host', async () => {
  assert.match(fixture.knownFindings.find(x => x.id === 'R14-F04').behavior, /previewWorkerClient/);
  const h = createExportVmHost({ supplyRetiredPreviewBindings: false });
  const body = await h.build();
  assert.ok(body.innerHTML.includes('原文'));
  assert.equal(h.evaluate('typeof previewWorkerClient'), 'undefined');
  assert.equal(h.evaluate('typeof createPreviewNodesForBlock'), 'undefined');
  assert.equal(h.evaluate('typeof escapeHtml'), 'undefined');
  for (const operation of ['exportHTML', 'exportWord']) await h.invoke(operation);
  assert.equal(h.downloads.length, 2, 'R14-06 repairs body construction only.');
  h.downloads.length = 0;
  for (const operation of ['exportPDF', 'renderExportImagePreview']) {
    await h.invoke(operation);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
  }
  assert.equal(h.timers.length, 0);
  assert.equal(h.calls.filter(x => x[0] === 'saveFile' || /^write/.test(x[0])).length, 0);
  assert.ok(h.calls.some(x => x[0] === 'error'));
  h.destroy();
});

for (const [format, operation] of [['html', 'exportHTML'], ['word', 'exportWord']]) {
  test(`R14-06 ${format} serializes an escaped title without retired Preview escapeHtml`, async () => {
    const h = createExportVmHost({ name: "A&B' report.md", supplyRetiredPreviewBindings: false });
    try {
      assert.equal(h.evaluate('typeof escapeHtml'), 'undefined');
      await h.invoke(operation);
      assert.equal(h.downloads.length, 1, JSON.stringify(h.calls));
      const html = await h.downloads[0].blob.text();
      assert.ok(html.includes('<title>A&amp;B&#39; report</title>'));
      assert.equal(h.calls.some(x => x[0] === 'error'), false);
      assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
    } finally { h.destroy(); }
  });
}

for (const item of requests.names) {
  for (const [format, operation] of Object.entries(operations)) {
    test(`R14-02 normalized ${format} desktop dialog name retains R14-01 filter/directory/write coverage: ${JSON.stringify(item.input)}`, async () => {
      const h = createExportVmHost({ desktop: true, sourceText: fixture.source, name: item.input });
      if (format === 'image') h.evaluate("currentImageDataUrl = 'data:image/png;base64,iVBORw0KGgo='");
      await h.invoke(operation);
      const dialog = h.calls.find(x => x[0] === 'saveFile');
      assert.ok(dialog, JSON.stringify(h.calls));
      // R14-01 contracts.json remains the immutable old name baseline.
      // R14-02 requests.json defines the intentional normalized output mapping.
      assert.equal(dialog[1], item[format]);
      assert.deepEqual(plain(dialog[2]), { ...fixture.saveOptions[format], defaultDirectory: 'C:\\custom' });
      const writes = h.calls.filter(x => /^write/.test(x[0]));
      assert.equal(writes.length, 1);
      assert.equal(writes[0][1], 'C:\\exports\\report');
      if (format === 'image') assert.deepEqual(Array.from(writes[0][2]), [137, 80, 78, 71, 13, 10, 26, 10]);
      else if (format === 'markdown') assert.equal(writes[0][2], fixture.source);
      else {
        assert.ok(writes[0][2].startsWith('<!DOCTYPE html>'));
        assert.ok(writes[0][2].includes('<meta charset="utf-8">'));
        if (item.input.includes('<title>')) assert.ok(writes[0][2].includes('<title>A&amp;B _title_</title>'));
      }
      assert.equal(h.downloads.length, 0);
    });
  }
}

for (const format of Object.keys(operations)) {
  test(`R14-01 ${format} dialog cancellation and failed write never fall back to browser download`, async () => {
    for (const mode of ['cancel', 'error']) {
      const h = createExportVmHost({ desktop: true, savePath: mode === 'cancel' ? null : 'C:\\occupied', failWrite: mode === 'error' });
      if (format === 'image') h.evaluate("currentImageDataUrl = 'data:image/png;base64,iVBORw0KGgo='");
      await h.invoke(operations[format]);
      assert.equal(h.downloads.length, 0);
      assert.equal(h.calls.filter(x => /^write/.test(x[0])).length, mode === 'cancel' ? 0 : 1);
      if (mode === 'error') assert.ok(h.calls.some(x => x[0] === 'toast' && String(x[1]).includes('write denied')));
      if (['html', 'word'].includes(format)) assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
    }
  });
}

test('R14-02 browser Markdown uses normalized names and retains exact R14-01 model bytes and URL cleanup', async () => {
  for (const item of requests.names) {
    const h = createExportVmHost({ name: item.input, sourceText: fixture.source });
    await h.invoke('exportFile');
    assert.equal(h.downloads.length, 1);
    assert.equal(h.downloads[0].name, item.markdown);
    assert.equal(h.downloads[0].blob.type, 'text/markdown;charset=utf-8');
    assert.equal(await h.downloads[0].blob.text(), fixture.source);
    assert.deepEqual(h.calls.filter(x => x[0] === 'snapshot'), [['snapshot', 'export-markdown']]);
    assert.equal(h.calls.some(x => x[0] === 'parse'), false);
    assert.ok(h.calls.some(x => x[0] === 'revoke' && x[1] === h.downloads[0].href));
  }
});

for (const [format, mime] of [['html', 'text/html;charset=utf-8'], ['word', 'application/msword;charset=utf-8']]) {
  test(`R14-01 browser ${format} output captures raw math/Mermaid gap without fetching exported CDN assets`, async () => {
    const h = createExportVmHost({ sourceText: fixture.source });
    await h.invoke(operations[format]);
    assert.equal(h.downloads.length, 1);
    assert.equal(h.downloads[0].blob.type, mime);
    const text = await h.downloads[0].blob.text();
    assert.ok(text.includes('$x^2$'));
    assert.ok(text.includes('flowchart TD'));
    assert.equal(h.calls.some(x => ['math', 'mermaid'].includes(x[0])), false, 'Current HTML/Word do not call the enhancer; R14-F01 remains open.');
    if (format === 'html') {
      assert.ok(text.includes('https://cdn.jsdelivr.net/npm/katex@0.16.9/'));
      assert.ok(text.includes('exportPresentationPort.math?.renderTree'), 'R14-F02 records a broken standalone reference, not a supported contract.');
    }
    assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
    assert.ok(h.calls.some(x => x[0] === 'revoke'));
  });
}

for (const size of ['small', 'large']) {
  test(`R14-01 ${size} long document reuses every synchronized Worker block in ordered frame batches`, async () => {
    const spec = fixture.longDocument;
    const blocks = Array.from({ length: spec.blocks }, (_, id) => ({ id, html: `<p>block-${id}</p>` }));
    const h = createExportVmHost({ workerBlocks: blocks, textLength: spec[size + 'Characters'] });
    const task = h.invoke('beginExportTask', 'fixture');
    const body = await h.build(task);
    assert.equal(body.innerHTML, blocks.map(x => x.html).join(''));
    assert.deepEqual(h.calls.filter(x => x[0] === 'block').map(x => x[1]), blocks.map(x => x.id));
    assert.equal(h.calls.some(x => ['snapshot', 'parse'].includes(x[0])), false);
    assert.equal(h.frameCount, spec[size + 'BatchEnds'].length - 1);
    h.invoke('finishExportTask', task);
    assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
  });
}

test('R14-01 stale Worker version/empty blocks use an explicit full snapshot; parser failure preserves raw source', async () => {
  for (const options of [{ workerBlocks: [{ id: 0, html: 'STALE' }], workerVersion: 6 }, { workerBlocks: [] }, { parseError: true }]) {
    const h = createExportVmHost({ ...options, sourceText: '<safe> $x$ 😀' });
    const body = await h.build();
    assert.deepEqual(h.calls.filter(x => x[0] === 'snapshot'), [['snapshot', 'full-preview-export']]);
    assert.equal(h.calls.some(x => x[0] === 'block'), false);
    assert.ok(body.innerHTML.includes('&lt;safe&gt; $x$ 😀'));
    if (options.parseError) assert.ok(body.innerHTML.includes('f-raw-fallback'));
  }
});

test('R14-01 cancellation during a long-document frame prevents all later blocks and file commits', async () => {
  const h = createExportVmHost({ workerBlocks: Array.from({ length: 137 }, (_, id) => ({ id, html: `<p>${id}</p>` })) });
  h.setFrameHook(() => h.cancel());
  await h.invoke('exportHTML');
  assert.equal(h.calls.filter(x => x[0] === 'block').length, 96);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.calls.some(x => x[0] === 'saveFile'), false);
  assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
  assert.ok(h.calls.some(x => x[0] === 'modal' && x[1] === 'markdown-editor:modal-shell-close'));
});

test('R14-01 task replacement, stale progress, explicit noncancelable phase and clamped progress remain observable', () => {
  const h = createExportVmHost();
  const old = h.invoke('beginExportTask', 'old');
  const current = h.invoke('beginExportTask', 'current');
  assert.throws(() => old.token.throwIfCancelled(), { name: 'ExportCancelledError' });
  old.update(100, 'stale');
  assert.notEqual(h.nodes.get('export-progress-status').textContent, 'stale');
  current.update(300, 'current'); assert.equal(h.nodes.get('export-progress-value').style.width, '100%');
  current.update(-1, 'current'); assert.equal(h.nodes.get('export-progress-value').style.width, '0%');
  current.lockCancellation('encoding');
  h.cancel(); assert.equal(current.cancelled, false);
  assert.equal(h.invoke('beginExportTask', 'blocked'), null);
  h.invoke('finishExportTask', old); assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask.id'), current.id);
  h.invoke('finishExportTask', current); assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
});

test('R14-01 PDF afterprint and timeout restore exactly once, preserving the source view', async () => {
  for (const afterprint of [true, false]) {
    const h = createExportVmHost();
    await h.invoke('exportPDF');
    assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
    assert.equal(h.context.observedPreviewBody, null);
    assert.equal(h.timers[0].delay, 80);
    h.timers[0].callback();
    assert.equal(h.calls.filter(x => x[0] === 'print').length, 1);
    assert.equal(h.timers[1].delay, 1200);
    if (afterprint) h.events.get('afterprint')();
    h.timers[1].callback();
    assert.equal(h.calls.filter(x => x[0] === 'reset').length, 1);
    assert.deepEqual(h.calls.filter(x => x[0] === 'view'), [['view', 'preview'], ['view', 'source']]);
  }
});

test('R14-01 cancelled PDF preparation restores view before printing and never schedules print', async () => {
  const h = createExportVmHost(); h.setFrameHook(() => h.cancel());
  await h.invoke('exportPDF');
  assert.equal(h.timers.length, 0);
  assert.equal(h.calls.filter(x => x[0] === 'reset').length, 1);
  assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
});

test('R14-01 PNG ratio/padding/crop/natural height, noncancelable encoding and generated binary are fixed', async () => {
  assert.deepEqual(plain(createExportVmHost().evaluate('exportRequestPort.imageRatios')), fixture.imageRatios);
  for (const [imageHeight, crop, expected] of [[100, false, 1920], [2200, false, 2200], [2200, true, 1920]]) {
    const h = createExportVmHost({ imageHeight }); h.context.document.getElementById('image-crop-fit').checked = crop;
    await h.invoke('renderExportImagePreview');
    const png = h.calls.find(x => x[0] === 'png'); assert.ok(png);
    assert.equal(png[1].width, 1080); assert.equal(png[1].height, expected);
    assert.equal(png[1].cacheBust, true);
    assert.equal(h.nodes.get('export-image-stage').style.height, expected + 'px');
    assert.equal(h.nodes.get('export-progress-cancel').disabled, true);
    assert.equal(h.evaluate('currentImageDataUrl'), 'data:image/png;base64,iVBORw0KGgo=');
    await h.invoke('downloadExportImage');
    assert.equal(h.downloads[0].name, 'report.png');
    assert.equal(h.evaluate('exportTaskPort.getSnapshot().activeTask'), null);
  }
});

test('R14-01 malformed image data errors before write; percent/base64 encodings preserve exact bytes', () => {
  const h = createExportVmHost();
  assert.throws(() => h.invoke('dataUrlToBytes', 'not-data'), /图片数据无效/);
  assert.deepEqual(Array.from(h.invoke('dataUrlToBytes', 'data:text/plain,hello%20world')), Array.from(new TextEncoder().encode('hello world')));
  assert.deepEqual(Array.from(h.invoke('dataUrlToBytes', 'data:image/png;base64,iVBORw0KGgo=')), [137, 80, 78, 71, 13, 10, 26, 10]);
});
