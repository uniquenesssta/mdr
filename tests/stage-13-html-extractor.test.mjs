import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createWebClipperController, createWebFetchCoordinator } from '../src/features/import/index.js';

test('public clipper preserves extraction result identity and parse errors before insertion', () => {
  const expected = { meta: {}, content: {} }, inserted = [];
  const fetchCoordinator = createWebFetchCoordinator();
  const controller = createWebClipperController({ fetchCoordinator,
    extract: html => { if (html === 'bad') throw new Error('parse failure'); return expected; },
    convert: value => { assert.equal(value, expected); return '# extracted'; },
    insertMarkdown: value => inserted.push(value) });
  controller.open(); controller.setInput('manualHtml', 'bad');
  assert.deepEqual(controller.insert(), { status: 'error', error: 'parse failure' });
  assert.deepEqual(inserted, []);
  controller.setInput('manualHtml', 'html');
  assert.equal(controller.insert().status, 'inserted'); assert.deepEqual(inserted, ['# extracted']);
  controller.destroy(); controller.destroy();
  assert.throws(() => controller.insert(), /destroyed/); fetchCoordinator.destroy();
});

test('ESM composition injects the sole extractor and converter; classic code retains no conversion authority', async () => {
  const source = await readFile(new URL('../public/app/web-clipper.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /extract: html => extractHtml\(html, document\), convert: convertExtractedHtml/);
  assert.match(main, /insertMarkdown: markdown => importDocumentController\.insertWebMarkdown\(markdown\)/);
  assert.doesNotMatch(source, /DOMParser|function extractMeta|function extractMainContent|function stripUnwantedElements/);
  assert.doesNotMatch(source, /function htmlToMarkdown|function convertTable/);
  const controller = await readFile(new URL('../src/features/import/web-clipper/web-clipper-controller.js', import.meta.url), 'utf8');
  assert.match(controller, /convert\(extract\(source\)\)/);
});
