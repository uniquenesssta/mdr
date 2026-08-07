import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const migratedCallers = [
  'src/main.js', 'src/runtime/link-preview.js', 'src/runtime/performance.js',
  'src/sidebar/folder-file-tree.js', 'src/storage/native-document-store.js',
  'src/editor/hybrid/image-source.js', 'public/app/core.js', 'public/app/events.js',
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
    assert.match(source, /markdownEditorPlatformPort/);
    assert.doesNotMatch(source, /window\.markdownEditorPlatform|window\.markdownEditorNative/);
  }
  const bridge = await readFile(new URL('../../../src/platform/compatibility/classic-platform-port.js', import.meta.url), 'utf8');
  assert.match(bridge, /call\(portName, methodName/);
  assert.match(bridge, /supports\(capability\)/);
  assert.doesNotMatch(bridge, /\bwindow\.|\bglobalThis\./);
});

test('ESM consumers receive responsibility-focused ports rather than native DTO facade methods', async () => {
  const store = await readFile(new URL('../../../src/storage/native-document-store.js', import.meta.url), 'utf8');
  const tree = await readFile(new URL('../../../src/sidebar/folder-file-tree.js', import.meta.url), 'utf8');
  const images = await readFile(new URL('../../../src/editor/hybrid/image-source.js', import.meta.url), 'utf8');
  const performance = await readFile(new URL('../../../src/runtime/performance.js', import.meta.url), 'utf8');
  const links = await readFile(new URL('../../../src/runtime/link-preview.js', import.meta.url), 'utf8');
  assert.match(store, /this\.documentStore\.save\(/);
  assert.match(store, /this\.documentStore\.readChunk\(/);
  assert.doesNotMatch(store, /saveDocumentState|readDocumentChunk|nativeApi/);
  assert.match(tree, /files\.listTextTree\(/);
  assert.doesNotMatch(tree, /listTextFileTree|nativeApi/);
  assert.match(images, /platformFiles\.readImage\(/);
  assert.match(performance, /platformLogs\.writePerformance\(/);
  assert.match(links, /platformLinks\.openExternal\(/);
});

test('native drag/drop keeps file classification in application code and MIME decoding outside it', async () => {
  const events = await readFile(new URL('../../../public/app/events.js', import.meta.url), 'utf8');
  assert.match(events, /\['md', 'markdown', 'txt'\]/);
  assert.match(events, /\['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'\]/);
  assert.match(events, /call\('files', 'readText'/);
  assert.match(events, /call\('files', 'readImage'/);
  assert.doesNotMatch(events, /data:image\/png|data:image\/jpeg|image_mime/);
});
