import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assessBrowserImage, isAllowedImageMime, classifyBrowserFile, IMPORT_KINDS, mountClassicDropImportPort } from '../src/features/import/index.js';

const MiB = 1024 * 1024;

test('browser MIME compatibility is shared with classification, without reading size or content', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/avif', 'image/']) {
    const file = { name: 'photo.bin', type };
    Object.defineProperty(file, 'size', { get() { assert.fail('classification must not read size'); } });
    assert.equal(isAllowedImageMime(type), true);
    assert.equal(classifyBrowserFile(file), IMPORT_KINDS.IMAGE);
    assert.equal(assessBrowserImage({ type, size: 1 }).allowed, true);
  }
  for (const type of ['', 'text/plain', 'application/pdf', 'IMAGE/PNG', ' image/png', null, 42]) {
    assert.equal(isAllowedImageMime(type), false);
    const file = { type, get size() { assert.fail('unsupported MIME must not read size'); } };
    assert.deepEqual(assessBrowserImage(file), { allowed: false, reason: 'unsupported', requiresConfirmation: false });
  }
  for (const file of [null, undefined, [], 'image/png']) assert.equal(assessBrowserImage(file).reason, 'unsupported');
});

test('drop and dialog share inclusive 5 MiB limit; only dialog above 2 MiB asks for confirmation', () => {
  for (const source of ['drop', 'dialog']) {
    for (const size of [0, 2 * MiB - 1, 2 * MiB, 2 * MiB + 1, 5 * MiB - 1, 5 * MiB, 5 * MiB + 1, 20 * MiB]) {
      const file = Object.freeze({ type: 'image/png', size });
      const result = assessBrowserImage(file, { source });
      assert.deepEqual(result, {
        allowed: size <= 5 * MiB,
        reason: size > 5 * MiB ? 'too-large' : null,
        requiresConfirmation: source === 'dialog' && size > 2 * MiB && size <= 5 * MiB
      }, source + ':' + size);
      assert.equal(Object.isFrozen(result), true);
    }
  }
  assert.throws(() => assessBrowserImage({ type: 'image/png', size: 1 }, { source: 'native' }), /Unknown browser image source/);
});

test('policy is metadata-only and does not override text-first drop routing', () => {
  const file = { name: 'note.md', type: 'image/png', size: 3 * MiB };
  for (const key of ['content', 'dataUrl', 'text', 'arrayBuffer', 'stream']) {
    Object.defineProperty(file, key, { get() { assert.fail('policy read ' + key); } });
  }
  assert.equal(classifyBrowserFile(file), IMPORT_KINDS.TEXT);
  assert.equal(assessBrowserImage(file, { source: 'dialog' }).requiresConfirmation, true);
  assert.equal(assessBrowserImage(file).requiresConfirmation, false);
});

test('existing classic drop port exposes the same policy and rejects calls after teardown', () => {
  const port = mountClassicDropImportPort({}, { start() {}, openPath() {} });
  for (const size of [2 * MiB + 1, 5 * MiB, 5 * MiB + 1]) {
    const file = { type: 'image/png', size };
    assert.deepEqual(port.api.assessImage(file), assessBrowserImage(file));
  }
  port.destroy(); port.destroy();
  assert.throws(() => port.api.assessImage({ type: 'image/png', size: 1 }), /destroyed/);
});

test('production callers use one browser policy while native byte enforcement stays in Rust', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [events, dialog, classifier, rust] = await Promise.all([
    read('public/app/events.js'), read('src/features/editor/ui/image-dialog-view.js'),
    read('src/features/import/files/file-type-classifier.js'), read('src-tauri/src/local_file/image_reader.rs')
  ]);
  assert.match(events, /eventsDropImportPort\.assessImage\(file\)/);
  assert.match(dialog, /assessBrowserImage\(file, \{ source: 'dialog' \}\)/);
  assert.match(dialog, /decision\.requiresConfirmation && !confirmLargeFile\(file\)/);
  assert.doesNotMatch(events + dialog, /file\.size\s*>/);
  assert.match(classifier, /isAllowedImageMime\(file\.type\)/);
  assert.doesNotMatch(classifier, /startsWith\('image\/'\)/);
  assert.match(rust, /MAX_IMAGE_BYTES: u64 = 5 \* 1024 \* 1024/);
  assert.match(rust, /MAX_EMBEDDED_IMAGE_BYTES: u64 = 20 \* 1024 \* 1024/);
});
