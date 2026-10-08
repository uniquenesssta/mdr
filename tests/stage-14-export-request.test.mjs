import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createExportRequest, EXPORT_IMAGE_RATIOS, ExportRequestValidationError, mountClassicExportRequestPort } from '../src/features/export/index.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/stage-14-export/requests.json', import.meta.url), 'utf8'));
const prior = JSON.parse(readFileSync(new URL('./fixtures/stage-14-export/contracts.json', import.meta.url), 'utf8'));
const base = { format: 'markdown', documentId: 'doc', name: 'report.md', directory: 'C:\\exports' };
const requestError = field => error => error instanceof ExportRequestValidationError && error.code === 'EXPORT_REQUEST_INVALID' && error.field === field;

test('R14-02 all formats have an explicit name mapping from the unchanged R14-01 inputs', () => {
  assert.deepEqual(fixture.names.map(x => x.input), prior.names.map(x => x.input));
  for (const item of fixture.names) {
    for (const format of ['markdown', 'html', 'word', 'pdf', 'image']) {
      const request = createExportRequest({ ...base, format, name: item.input });
      assert.equal(request.name, item[format]);
      assert.equal(request.documentId, 'doc');
      assert.equal(request.directory, 'C:\\exports');
      if (format === 'image') assert.deepEqual(request.imageOptions, { ratio: '9:16', width: 1080, height: 1920, cropFit: false });
      else assert.equal(request.imageOptions, null);
    }
  }
});

test('R14-02 preserves accepted extensions, Unicode and unknown suffixes while cleaning Windows filenames', () => {
  for (const [name, format, expected] of [
    ['中文 😀.MD', 'markdown', '中文 😀.MD'], ['notes.markdown', 'markdown', 'notes.markdown'],
    ['page.HTM', 'html', 'page.HTM'], ['report.DOC', 'word', 'report.DOC'],
    ['report.docx', 'image', 'report.png'], ['data.custom', 'markdown', 'data.custom.md'],
    ['a/b:c?.md', 'markdown', 'a_b_c_.md'], ['CON.txt', 'markdown', '_CON.md'],
    ['LPT2.png', 'image', '_LPT2.png'], ['  ..  ', 'pdf', '未命名文档.pdf'],
    ['notes.md. ', 'markdown', 'notes.md'], ['x'.repeat(252), 'markdown', 'x'.repeat(252) + '.md']
  ]) assert.equal(createExportRequest({ ...base, name, format }).name, expected);
});

test('R14-02 immutable requests detach options and preserve opaque legacy document IDs exactly', () => {
  const input = { format: ' IMAGE ', documentId: ' legacy/id ', name: '图.md', directory: ' C:\\目标\\ ', imageOptions: { ratio: ' 4:5 ', cropFit: true } };
  const request = createExportRequest(input);
  input.name = 'changed'; input.directory = 'changed'; input.imageOptions.ratio = '1:1'; input.imageOptions.cropFit = false;
  assert.equal(request.documentId, ' legacy/id ');
  assert.equal(request.name, '图.png'); assert.equal(request.directory, 'C:\\目标\\');
  assert.deepEqual(request.imageOptions, { ratio: '4:5', width: 1080, height: 1350, cropFit: true });
  assert.ok(Object.isFrozen(request) && Object.isFrozen(request.extensions) && Object.isFrozen(request.imageOptions));
  assert.throws(() => { request.imageOptions.width = 1; }, TypeError);
  assert.throws(() => { request.extensions.push('exe'); }, TypeError);
});

for (const [ratio, dimensions] of Object.entries(prior.imageRatios)) {
  test(`R14-02 canonical ${ratio} image dimensions retain the accepted ratio baseline`, () => {
    assert.deepEqual(EXPORT_IMAGE_RATIOS[ratio], dimensions);
    assert.ok(Object.isFrozen(EXPORT_IMAGE_RATIOS[ratio]));
    assert.deepEqual(createExportRequest({ ...base, format: 'image', imageOptions: { ratio, cropFit: false } }).imageOptions, { ratio, ...dimensions, cropFit: false });
  });
}

for (const [label, input, field] of [
  ['missing request', undefined, 'request'], ['null request', null, 'request'], ['array request', [], 'request'],
  ['unknown format', { ...base, format: 'exe' }, 'format'], ['prototype format', { ...base, format: '__proto__' }, 'format'],
  ['missing document', { ...base, documentId: undefined }, 'documentId'], ['empty document', { ...base, documentId: ' ' }, 'documentId'],
  ['numeric document', { ...base, documentId: 1 }, 'documentId'], ['object name', { ...base, name: {} }, 'name'],
  ['control name', { ...base, name: 'a\0.md' }, 'name'], ['overlong name', { ...base, name: 'x'.repeat(253) }, 'name'],
  ['object directory', { ...base, directory: {} }, 'directory'], ['control directory', { ...base, directory: 'C:\\bad\0' }, 'directory'],
  ['nonimage options', { ...base, imageOptions: {} }, 'imageOptions'],
  ['array image options', { ...base, format: 'image', imageOptions: [] }, 'imageOptions'],
  ['invalid image ratio', { ...base, format: 'image', imageOptions: { ratio: '3:2' } }, 'imageOptions.ratio'],
  ['prototype ratio', { ...base, format: 'image', imageOptions: { ratio: 'constructor' } }, 'imageOptions.ratio'],
  ['string crop option', { ...base, format: 'image', imageOptions: { cropFit: 'false' } }, 'imageOptions.cropFit']
]) test(`R14-02 rejects ${label} with an explicit field error`, () => assert.throws(() => createExportRequest(input), requestError(field)));

test('R14-02 scoped port verifies document existence, preserves identity and has a terminal mount lifecycle', () => {
  const host = {}, existing = new Set([' legacy/id ', 'other']);
  const options = { getActiveDocumentId: () => ' legacy/id ', hasDocument: id => existing.has(id) };
  const mount = mountClassicExportRequestPort(host, options);
  const port = mount.port;
  assert.equal(port.createRequest({ format: 'markdown' }).documentId, ' legacy/id ');
  assert.equal(port.createRequest({ format: 'markdown', documentId: 'other' }).documentId, 'other');
  assert.throws(() => port.createRequest({ format: 'markdown', documentId: 'missing' }), requestError('documentId'));
  existing.delete('other');
  assert.throws(() => port.createRequest({ format: 'markdown', documentId: 'other' }), requestError('documentId'));
  assert.throws(() => port.createRequest(null), requestError('request'));
  assert.throws(() => mountClassicExportRequestPort(host, options), /already mounted/);
  assert.equal(Object.keys(host).length, 0); assert.ok(Object.isFrozen(port));
  mount.destroy(); mount.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorExportRequestPort'), false);
  assert.throws(() => port.createRequest({ format: 'markdown' }), /destroyed/);
  const next = mountClassicExportRequestPort(host, options);
  assert.notEqual(next.port, port); next.destroy();
});

test('R14-02 every actual classic entry rejects invalid inputs before task, snapshot, vendor, print or file effects', async () => {
  const operations = ['exportFile', 'exportHTML', 'exportWord', 'exportPDF', 'renderExportImagePreview', 'downloadExportImage'];
  for (const operation of operations) {
    for (const options of [{ name: 'bad\0.md' }, { documentId: '' }]) {
      const h = createExportVmHost(options);
      h.evaluate("currentImageDataUrl = 'data:image/png;base64,iVBORw0KGgo='");
      await h.invoke(operation);
      assert.equal(h.evaluate('exportTaskId'), 0, operation);
      assert.equal(h.evaluate('activeExportTask'), null);
      assert.deepEqual(h.calls.map(x => x[0]), ['toast'], operation);
      assert.equal(h.downloads.length, 0); assert.equal(h.timers.length, 0);
    }
  }
  const h = createExportVmHost(); h.evaluate("currentImageRatio = 'invalid'");
  await h.invoke('renderExportImagePreview');
  assert.equal(h.evaluate('exportTaskId'), 0); assert.deepEqual(h.calls.map(x => x[0]), ['toast']);
});

test('R14-02 HTML/Word freeze names and directories before long-document frames', async () => {
  for (const [operation, name] of [['exportHTML', 'report.html'], ['exportWord', 'report.doc']]) {
    const h = createExportVmHost({ desktop: true, name: 'report.txt', workerBlocks: Array.from({ length: 137 }, (_, id) => ({ id, html: '<p>body</p>' })) });
    h.setFrameHook(() => { h.context.filenameInput.value = 'late.md'; h.evaluate("exportDirectory = 'C:\\\\late'"); });
    await h.invoke(operation);
    const dialog = h.calls.find(x => x[0] === 'saveFile');
    assert.equal(dialog[1], name); assert.equal(dialog[2].defaultDirectory, 'C:\\custom');
    assert.equal(h.calls.filter(x => x[0] === 'writeText').length, 1);
  }
});

test('R14-02 image ratio and crop remain the pre-task snapshot after asynchronous preparation', async () => {
  const h = createExportVmHost({ imageHeight: 2200, workerBlocks: Array.from({ length: 137 }, (_, id) => ({ id, html: '<p>body</p>' })) });
  h.context.document.getElementById('image-crop-fit').checked = true;
  h.setFrameHook(() => { h.context.document.getElementById('image-crop-fit').checked = false; h.evaluate("currentImageRatio = '1:1'"); });
  await h.invoke('renderExportImagePreview');
  const png = h.calls.find(x => x[0] === 'png');
  assert.equal(png[1].width, 1080); assert.equal(png[1].height, 1920);
});

test('R14-02 context export validates the selected document before read and preserves stale generation rejection', async () => {
  const h = createExportVmHost({ desktop: true, documentIds: ['export-doc', 'other'] });
  const record = { id: 'other', title: 'selected.txt' };
  let reads = 0, current = true;
  h.context.coreDocumentSessionPort = { getRecord: id => id === record.id ? record : null };
  h.context.getCurrentDocument = () => ({ id: 'export-doc', title: 'active.md' });
  h.context.getActiveDocumentId = () => 'export-doc';
  h.context.coreDocumentControllerPort = {
    isCurrentGeneration: () => current,
    async readDocumentContent(id) {
      assert.equal(id, 'other'); reads++;
      record.title = 'late.md'; h.evaluate("exportDirectory = 'C:\\\\late'");
      return { generation: 1, content: 'selected body 😀' };
    }
  };
  for (const id of ['missing', '', null, 0]) await h.invoke('exportContextDocument', id);
  assert.equal(reads, 0); assert.equal(h.calls.some(x => x[0] === 'saveFile'), false);
  await h.invoke('exportContextDocument', 'other');
  const dialog = h.calls.find(x => x[0] === 'saveFile');
  assert.equal(dialog[1], 'selected.md'); assert.equal(dialog[2].defaultDirectory, 'C:\\custom');
  assert.equal(h.calls.find(x => x[0] === 'writeText')[2], 'selected body 😀');
  h.calls.length = 0; current = false;
  await h.invoke('exportContextDocument', 'other');
  assert.equal(reads, 2); assert.equal(h.calls.some(x => x[0] === 'saveFile'), false);
});
