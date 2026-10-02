import assert from 'node:assert/strict';
import test from 'node:test';
import { mountClassicHtmlMarkdownPort } from '../src/features/import/compatibility/classic-html-markdown-port.js';
import { isSafeDocumentUrl } from '../src/shared/security/document-html.js';

test('conversion port preserves input/results/errors and releases scoped ownership', () => {
  const host = {}, input = { content: {} };
  const port = mountClassicHtmlMarkdownPort(host, value => { assert.equal(value, input); return '# converted'; });
  assert.equal(port.api.convert(input), '# converted');
  assert.throws(() => mountClassicHtmlMarkdownPort(host, () => ''), /already mounted/);
  port.destroy(); port.destroy();
  assert.equal(Object.hasOwn(host, 'markdownEditorHtmlMarkdownPort'), false);
  assert.throws(() => port.api.convert(input), /destroyed/);
  const failed = mountClassicHtmlMarkdownPort(host, () => { throw new Error('conversion failure'); });
  assert.throws(() => failed.api.convert(input), /conversion failure/);
  Object.defineProperty(host, 'markdownEditorHtmlMarkdownPort', { value: 'successor' });
  failed.destroy(); assert.equal(host.markdownEditorHtmlMarkdownPort, 'successor');
});

test('conversion shares the existing document URL policy without widening schemes', () => {
  for (const url of ['javascript:alert(1)', 'java\nscript:bad', '//evil.test', 'https://user:pass@example.test', 'https://ipc.localhost']) {
    assert.equal(isSafeDocumentUrl(url), false); assert.equal(isSafeDocumentUrl(url, true), false);
  }
  assert.equal(isSafeDocumentUrl('https://example.test'), true);
  assert.equal(isSafeDocumentUrl('mailto:a@example.test'), true);
  assert.equal(isSafeDocumentUrl('data:image/png;base64,AAEC', true), true);
});
