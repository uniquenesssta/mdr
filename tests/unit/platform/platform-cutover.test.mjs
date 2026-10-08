import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { classifyBrowserFile, classifyImportPath, IMPORT_KINDS } from '../../../src/features/import/index.js';

const migratedCallers = [
  'src/main.js', 'src/runtime/link-preview.js', 'src/runtime/performance.js',
  'src/features/sidebar/folder-tree/folder-tree-controller.js', 'src/storage/native-document-store.js',
  'src/features/hybrid-editor/image/image-source-resolver.js', 'public/app/core.js', 'public/app/events.js',
  'public/app/export.js', 'public/app/web-clipper.js'
];

test('Atomic Task 3.12 deletes the legacy Tauri facade and removes every native-global caller', async () => {
  await assert.rejects(access(new URL('../../../src/runtime/tauri.js', import.meta.url)));
  for (const path of migratedCallers) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /markdownEditorNative|runtime\/tauri\.js/);
  }
  const main = await readFile(new URL('../../../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /createPlatform\(/);
  assert.match(main, /mountClassicPlatformPort\(/);
  assert.doesNotMatch(main, /window\.markdownEditorPlatform|window\.platform\s*=/);
});

test('classic callers use the scoped compatibility host instead of a replacement global facade', async () => {
  for (const path of ['public/app/core.js', 'public/app/events.js', 'public/app/export.js', 'public/app/web-clipper.js']) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    assert.match(source, /compatibility-business-ports/);
    assert.match(source, path === 'public/app/web-clipper.js' ? /markdownEditorDocumentUiCommandPort/ : /markdownEditorPlatformPort/);
    assert.doesNotMatch(source, /window\.markdownEditorPlatform|window\.markdownEditorNative/);
  }
  const bridge = await readFile(new URL('../../../src/platform/compatibility/classic-platform-port.js', import.meta.url), 'utf8');
  assert.match(bridge, /call\(portName, methodName/);
  assert.match(bridge, /supports\(capability\)/);
  assert.doesNotMatch(bridge, /\bwindow\.|\bglobalThis\./);
});

test('ESM consumers receive responsibility-focused ports rather than native DTO facade methods', async () => {
  const store = await readFile(new URL('../../../src/storage/native-document-store.js', import.meta.url), 'utf8');
  const loader = await readFile(new URL('../../../src/features/persistence/native-document-store/native-segmented-loader.js', import.meta.url), 'utf8');
  const tree = await readFile(new URL('../../../src/features/sidebar/folder-tree/folder-tree-controller.js', import.meta.url), 'utf8');
  const images = await readFile(new URL('../../../src/features/hybrid-editor/image/image-source-resolver.js', import.meta.url), 'utf8');
  const performance = await readFile(new URL('../../../src/runtime/performance.js', import.meta.url), 'utf8');
  const links = await readFile(new URL('../../../src/runtime/link-preview.js', import.meta.url), 'utf8');
  assert.match(store, /this\.documentStore\.save\(/);
  assert.match(store, /createNativeSegmentedLoader\(\{\s*documentStore: this\.documentStore/);
  assert.match(loader, /documentStore\.readChunk\(/);
  assert.doesNotMatch(store, /saveDocumentState|readDocumentChunk|nativeApi/);
  assert.match(tree, /files\.listTextTree\(/);
  assert.doesNotMatch(tree, /listTextFileTree|nativeApi/);
  assert.match(images, /platformFiles\.readImage\(/);
  assert.match(performance, /platformLogs\.writePerformance\(/);
  assert.match(links, /platformLinks\.openExternal\(/);
});

test('native drag/drop keeps file classification in application code and MIME decoding outside it', async () => {
  const events = await readFile(new URL('../../../public/app/events.js', import.meta.url), 'utf8');
  // R13.4 moves event routing into Import; Platform still only transports paths.
  const drop = await readFile(new URL('../../../src/features/import/files/drop-import-controller.js', import.meta.url), 'utf8');
  assert.match(drop, /classifyBrowserFile\(file\)/);
  assert.match(drop, /classifyImportPath\(resolvedPath\)/);
  for (const extension of ['md', 'markdown', 'txt']) {
    assert.equal(classifyImportPath('C:\\docs\\note.' + extension), IMPORT_KINDS.TEXT);
    assert.equal(classifyBrowserFile({ name: 'note.' + extension, type: 'image/png' }), IMPORT_KINDS.TEXT);
  }
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']) {
    assert.equal(classifyImportPath('C:\\images\\photo.' + extension), IMPORT_KINDS.IMAGE);
  }
  assert.equal(classifyImportPath('C:\\images\\photo.bmp'), IMPORT_KINDS.UNSUPPORTED);
  assert.equal(classifyBrowserFile({ name: 'photo.bmp', type: 'image/bmp' }), IMPORT_KINDS.IMAGE);
  const main = await readFile(new URL('../../../src/main.js', import.meta.url), 'utf8');
  const importer = await readFile(new URL('../../../src/features/import/application/import-document-controller.js', import.meta.url), 'utf8');
  assert.match(main, /openNativeText: \(path, request\) => importDocumentController\.openNativeText\(path, request\)/);
  assert.match(importer, /files\.readPath\(path, \{ signal \}\)/);
  assert.match(main, /readNativeText: path => platform\.files\.readText\(path\)/);
  assert.match(main, /openNativeImage: \(path, request\) => importDocumentController\.insertNativeImage\(path, request\)/);
  assert.match(importer, /images\.readPath\(path, \{ signal \}\)/);
  assert.doesNotMatch(events, /eventsFileImportPort|eventsDropImportPort/);
  assert.doesNotMatch(events, /data:image\/png|data:image\/jpeg|image_mime/);
});

test('Stage 3 evidence keeps 174 as historical context while enforcing the exact 36-module Platform surface', async () => {
  const evidencePaths = [
    'scripts/stage-03/record-platform-evidence.mjs',
    'scripts/stage-03/record-create-platform-evidence.mjs',
    'scripts/stage-03/record-platform-cutover-evidence.mjs'
  ];
  for (const path of evidencePaths) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    assert.match(source, /HISTORICAL_STAGE_3_PRODUCTION_MODULE_COUNT\s*=\s*174/);
    assert.match(source, /STAGE_3_PLATFORM_MODULE_COUNT\s*=\s*36/);
    assert.match(source, /platformModules\.length\s*!==\s*STAGE_3_PLATFORM_MODULE_COUNT/);
    assert.doesNotMatch(source, /moduleFixture\.modules\.length\s*!==\s*174|fixture\.modules\.length\s*!==\s*174/);
  }
});
