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
