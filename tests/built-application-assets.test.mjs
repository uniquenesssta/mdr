import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBuiltApplicationDocument } from './e2e/lib/built-application-assets.mjs';

test('module-only Vite output delegates stylesheet loading to the module graph', () => {
  const result = prepareBuiltApplicationDocument(
    '<!doctype html><html><head></head><body><div id="app-root"></div><script type="module" crossorigin src="/assets/app.js"></script></body></html>',
    'https://markdown-editor-app.test'
  );

  assert.equal(result.moduleUrl, 'https://markdown-editor-app.test/assets/app.js');
  assert.equal(result.stylesheetUrl, null);
  assert.match(result.html, /<base href="https:\/\/markdown-editor-app\.test\/">/);
  assert.doesNotMatch(result.html, /<script\b[^>]*type=["']module["']/i);
});

test('extracted stylesheet remains supported without becoming mandatory', () => {
  const result = prepareBuiltApplicationDocument(
    '<html><head><link crossorigin rel="stylesheet" href="/assets/app.css"></head><body><script src="/i18n.js"></script><script src="/assets/app.js" type="module"></script></body></html>',
    'https://markdown-editor-app.test/'
  );

  assert.equal(result.moduleUrl, 'https://markdown-editor-app.test/assets/app.js');
  assert.equal(result.stylesheetUrl, 'https://markdown-editor-app.test/assets/app.css');
  assert.doesNotMatch(result.html, /stylesheet/i);
  assert.doesNotMatch(result.html, /i18n\.js/i);
});

test('built application module remains a hard requirement', () => {
  assert.throws(
    () => prepareBuiltApplicationDocument('<html><head></head><body></body></html>', 'https://markdown-editor-app.test'),
    /Unable to locate built application module asset/
  );
});
