import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserFileReadCancelledError,
  createBrowserFileReader
} from '../../../src/platform/index.js';

class FakeFileReader {
  static mode = 'load';
  static result = '';
  static error = null;
  constructor() {
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
  }
  readAsText(file) { this.#finish('text', file); }
  readAsDataURL(file) { this.#finish('data', file); }
  #finish(kind, file) {
    if (FakeFileReader.mode === 'throw') throw FakeFileReader.error;
    if (FakeFileReader.mode === 'error') {
      this.error = FakeFileReader.error;
      this.onerror?.();
      return;
    }
    if (FakeFileReader.mode === 'abort') {
      this.onabort?.();
      return;
    }
    this.result = FakeFileReader.result || `${kind}:${file.name}`;
    this.onload?.();
  }
}

function resetReader() {
  FakeFileReader.mode = 'load';
  FakeFileReader.result = '';
  FakeFileReader.error = null;
}

test('Atomic Task 3.10 FileReader adapter reads text and data URLs without document behavior', async () => {
  resetReader();
  const adapter = createBrowserFileReader({ FileReaderClass: FakeFileReader });
  assert.equal(await adapter.readText({ name: 'note.md' }), 'text:note.md');
  assert.equal(await adapter.readDataUrl({ name: 'image.png' }), 'data:image.png');
  assert.ok(Object.isFrozen(adapter));
});

test('FileReader abort is an explicit cancellation error', async () => {
  resetReader();
  FakeFileReader.mode = 'abort';
  const adapter = createBrowserFileReader({ FileReaderClass: FakeFileReader });
  await assert.rejects(adapter.readText({ name: 'note.md' }), error => {
    assert.ok(error instanceof BrowserFileReadCancelledError);
    assert.equal(error.code, 'BROWSER_FILE_READ_CANCELLED');
    return true;
  });
});

test('FileReader native errors and synchronous throws preserve identity', async () => {
  resetReader();
  const expected = new Error('read failed');
  FakeFileReader.mode = 'error';
  FakeFileReader.error = expected;
  const adapter = createBrowserFileReader({ FileReaderClass: FakeFileReader });
  await assert.rejects(adapter.readDataUrl({ name: 'bad.png' }), error => error === expected);

  FakeFileReader.mode = 'throw';
  FakeFileReader.error = expected;
  await assert.rejects(adapter.readText({ name: 'bad.md' }), error => error === expected);
});

test('FileReader rejects missing files and unavailable implementations explicitly', async () => {
  resetReader();
  const adapter = createBrowserFileReader({ FileReaderClass: FakeFileReader });
  await assert.rejects(adapter.readText(null), /requires a file/);
  assert.throws(() => createBrowserFileReader(null), /options must be an object/);
  assert.throws(() => createBrowserFileReader({ FileReaderClass: {} }), /FileReader is unavailable/);
});

test('FileReader signal cancellation aborts active I/O, detaches handlers and ignores late callbacks', async () => {
  let instance;
  class PendingReader {
    constructor() { instance = this; this.readyState = 0; }
    readAsText() { this.readyState = 1; }
    abort() { this.aborts = (this.aborts || 0) + 1; this.readyState = 2; this.onabort?.(); }
  }
  const adapter = createBrowserFileReader({ FileReaderClass: PendingReader });
  const controller = new AbortController();
  const pending = adapter.readText({ name: 'a.md' }, { signal: controller.signal });
  const lateLoad = instance.onload;
  const rejected = assert.rejects(pending, error => error.code === 'BROWSER_FILE_READ_CANCELLED');
  controller.abort(); await rejected;
  assert.equal(instance.aborts, 1);
  assert.equal(instance.onload, null); assert.equal(instance.onerror, null); assert.equal(instance.onabort, null);
  instance.result = 'late'; lateLoad(); assert.equal(instance.aborts, 1);
});

test('FileReader pre-aborted signal starts no reader and successful completion removes abort listener', async () => {
  let created = 0, aborted = 0;
  class Reader {
    constructor() { created++; }
    readAsText() { this.result = 'ok'; this.readyState = 2; this.onload(); }
    abort() { aborted++; }
  }
  const adapter = createBrowserFileReader({ FileReaderClass: Reader });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.readText({}, { signal: controller.signal }), error => error.code === 'BROWSER_FILE_READ_CANCELLED');
  assert.equal(created, 0);
  const next = new AbortController();
  assert.equal(await adapter.readText({}, { signal: next.signal }), 'ok');
  next.abort(); assert.equal(aborted, 0);
});
