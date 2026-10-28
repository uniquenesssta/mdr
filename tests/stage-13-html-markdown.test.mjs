import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebClipperController, createWebFetchCoordinator } from '../src/features/import/index.js';
import { isSafeDocumentUrl } from '../src/shared/security/document-html.js';

test('public clipper preserves conversion input/results/errors and releases source ownership', () => {
  const input = { content: {} }, inserted = []; let failed = true;
  const fetchCoordinator = createWebFetchCoordinator();
  const controller = createWebClipperController({ fetchCoordinator, extract: () => input,
    convert: value => { assert.equal(value, input); if (failed) throw new Error('conversion failure'); return '# converted'; },
    insertMarkdown: value => inserted.push(value) });
  controller.open(); controller.setInput('manualHtml', 'html');
  assert.deepEqual(controller.insert(), { status: 'error', error: 'conversion failure' });
  assert.deepEqual(inserted, []); failed = false;
  assert.equal(controller.insert().status, 'inserted'); assert.deepEqual(inserted, ['# converted']);
  controller.open(); assert.equal(controller.snapshot.hasContent, false);
  controller.destroy(); controller.destroy();
  assert.throws(() => controller.insert(), /destroyed/); fetchCoordinator.destroy();
});

test('conversion shares the existing document URL policy without widening schemes', () => {
  for (const url of ['javascript:alert(1)', 'java\nscript:bad', '//evil.test', 'https://user:pass@example.test', 'https://ipc.localhost']) {
    assert.equal(isSafeDocumentUrl(url), false); assert.equal(isSafeDocumentUrl(url, true), false);
  }
  assert.equal(isSafeDocumentUrl('https://example.test'), true);
  assert.equal(isSafeDocumentUrl('mailto:a@example.test'), true);
  assert.equal(isSafeDocumentUrl('data:image/png;base64,AAEC', true), true);
});

test('embedded SVG is an image source only, never a document navigation URL', () => {
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  assert.equal(isSafeDocumentUrl(svg, true), true);
  assert.equal(isSafeDocumentUrl(svg), false);
  for (const source of ['data:text/html;base64,PHN2Zy8+', 'data:image/svg+xml;base64,AAEC" onload="bad',
    'data:image/svg+xml;base64,AA\nEC', 'data:image/unknown;base64,AAEC']) {
    assert.equal(isSafeDocumentUrl(source, true), false, source);
  }
});
