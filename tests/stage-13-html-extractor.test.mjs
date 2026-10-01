import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mountClassicHtmlExtractorPort } from '../src/features/import/compatibility/classic-html-extractor-port.js';

test('scoped extractor port preserves results/errors, rejects duplicates and releases ownership', () => {
  const host = {};
  const expected = { meta: {}, content: {} };
  const port = mountClassicHtmlExtractorPort(host, html => { if (html === 'bad') throw new Error('parse failure'); return expected; });
  assert.equal(host.markdownEditorHtmlExtractorPort.extract('html'), expected);
  assert.throws(() => port.api.extract('bad'), /parse failure/);
  assert.throws(() => mountClassicHtmlExtractorPort(host, () => {}), /already mounted/);
  port.destroy(); port.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorHtmlExtractorPort'), false);
  assert.throws(() => port.api.extract('html'), /destroyed/);
  const other = mountClassicHtmlExtractorPort(host, () => expected);
  Object.defineProperty(host, 'markdownEditorHtmlExtractorPort', { value: 'new owner' });
  other.destroy(); assert.equal(host.markdownEditorHtmlExtractorPort, 'new owner');
});

test('classic converter consumes sole extractor; fetch UI isolation ends at converter boundary', async () => {
  const source = await readFile(new URL('../public/app/web-clipper.js', import.meta.url), 'utf8');
  assert.match(source, /webClipperHtmlExtractorPort\.extract\(html\)/);
  assert.doesNotMatch(source, /DOMParser|function extractMeta|function extractMainContent|function stripUnwantedElements/);
  assert.match(source, /function htmlToMarkdown/);
});
