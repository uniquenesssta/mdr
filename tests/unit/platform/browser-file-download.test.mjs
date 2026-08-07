import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserFileDownload } from '../../../src/platform/index.js';

function createDownloadSurface({ clickError = null } = {}) {
  const log = [];
  const body = {
    appendChild(node) { node.parentNode = body; log.push(['append', node]); },
    removeChild(node) { node.parentNode = null; log.push(['remove', node]); }
  };
  const documentObject = {
    body,
    createElement(tag) {
      assert.equal(tag, 'a');
      return {
        href: '',
        download: '',
        parentNode: null,
        click() {
          log.push(['click', this.href, this.download]);
          if (clickError) throw clickError;
        },
        remove() {
          if (this.parentNode) body.removeChild(this);
        }
      };
    }
  };
  const urlApi = {
    createObjectURL(blob) { log.push(['createObjectURL', blob]); return 'blob:evidence'; },
    revokeObjectURL(url) { log.push(['revokeObjectURL', url]); }
  };
  return { documentObject, urlApi, log };
}

test('Atomic Task 3.10 browser download owns anchor and object URL cleanup only', () => {
  const surface = createDownloadSurface();
  const adapter = createBrowserFileDownload(surface);
  const blob = { type: 'text/plain' };

  adapter.downloadBlob(blob, 'notes.txt');

  assert.deepEqual(surface.log.map(entry => entry[0]), [
    'createObjectURL', 'append', 'click', 'remove', 'revokeObjectURL'
  ]);
  assert.deepEqual(surface.log[2], ['click', 'blob:evidence', 'notes.txt']);
  assert.ok(Object.isFrozen(adapter));
});

test('direct URL downloads do not allocate object URLs', () => {
  const surface = createDownloadSurface();
  const adapter = createBrowserFileDownload(surface);
  adapter.downloadUrl('data:image/png;base64,AAAA', 'image.png');
  assert.deepEqual(surface.log.map(entry => entry[0]), ['append', 'click', 'remove']);
  assert.deepEqual(surface.log[1], ['click', 'data:image/png;base64,AAAA', 'image.png']);
});

test('download cleanup runs when the browser click fails and preserves the original error', () => {
  const expected = new Error('download blocked');
  const surface = createDownloadSurface({ clickError: expected });
  const adapter = createBrowserFileDownload(surface);
  assert.throws(() => adapter.downloadBlob({}, 'x.bin'), error => error === expected);
  assert.deepEqual(surface.log.map(entry => entry[0]), [
    'createObjectURL', 'append', 'click', 'remove', 'revokeObjectURL'
  ]);
});

test('browser download rejects incomplete platform surfaces', () => {
  assert.throws(() => createBrowserFileDownload(null), /options must be an object/);
  assert.throws(
    () => createBrowserFileDownload({ documentObject: {}, urlApi: {} }),
    /download document surface is unavailable/
  );
});
