import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { createImageMarkdown } from '../src/features/import/index.js';
import { createImageCommand } from '../src/features/editor/commands/image-command.js';

test('factory preserves normal URLs, Data URLs, defaults and existing closing-bracket escaping', () => {
  for (const [url, options, expected] of [
    [' https://example.test/a.png ', {}, '![图片](https://example.test/a.png)'],
    ['data:image/png;base64,AAEC', { alt: 'a]b' }, '![a\\]b](data:image/png;base64,AAEC)'],
    ['data:image/svg+xml,%3Csvg%3E%3C/svg%3E', { alt: '图' }, '![图](data:image/svg+xml,%3Csvg%3E%3C/svg%3E)'],
    ['blob:opaque', { alt: '', fallbackAlt: '自定义' }, '![自定义](blob:opaque)'],
    ['asset:/photo.png', { alt: 42 }, '![42](asset:/photo.png)'],
    ['a.png', { alt: 'a]b]c' }, '![a\\]b\\]c](a.png)'],
    ['a.png', { alt: 0, fallbackAlt: '' }, '![图片](a.png)'],
    ['a.png', { alt: '中文😀' }, '![中文😀](a.png)']
  ]) assert.equal(createImageMarkdown(url, options), expected);
  for (const value of [undefined, null, false, 0, '', ' \r\n ']) {
    assert.throws(() => createImageMarkdown(value), /Image URL must not be empty/);
  }
});

test('factory preserves URL bytes after outer trim without decoding, fetching or rewriting syntax', () => {
  for (const url of [
    'https://example.test/a.png?a=1&b=2#part', 'https://example.test/a%20b.png',
    'images/photo(1).png', 'images/a b.png', 'C:\\图片\\a.png',
    'data:image/png;base64,AAEC', 'data:image/svg+xml,%3Csvg%3E',
    'https://example.test/a)b(.png'
  ]) assert.equal(createImageMarkdown(url, { alt: '图' }), '![图](' + url + ')');
  const options = Object.freeze({ alt: '不变', fallbackAlt: '默认' });
  assert.equal(createImageMarkdown('a.png', options), createImageMarkdown('a.png', options));
  assert.deepEqual(options, { alt: '不变', fallbackAlt: '默认' });
});

test('supported generated syntax parses as one image with unchanged URL and no title', () => {
  for (const url of ['https://example.test/a.png?x=1&y=2', 'images/photo(1).png', 'a%20b.png', 'data:image/png;base64,AAEC']) {
    for (const alt of ['中文😀', 'a]b']) {
      const tokens = marked.Lexer.lexInline(createImageMarkdown(url, { alt }));
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0].type, 'image');
      assert.equal(tokens[0].href, url);
      assert.equal(tokens[0].title, null);
    }
  }
});

test('image command delegates serialization and retains one selection replacement and error behavior', () => {
  const calls = [];
  let selections = 0;
  const command = createImageCommand({
    getSelection() { selections++; return { start: 2, end: 5 }; },
    replaceRange(...args) { calls.push(args); return 'transaction'; }
  });
  assert.equal(command.insert('photo.png', { alt: 'a]b' }), 'transaction');
  assert.deepEqual(calls, [['![a\\]b](photo.png)', 2, 5, 'end']]);
  command.insert('data:image/png;base64,AAEC', { selection: { start: -2, end: -1 } });
  assert.deepEqual(calls[1], ['![图片](data:image/png;base64,AAEC)', 0, 0, 'end']);
  assert.throws(() => command.insert('  '), /Image URL must not be empty/);
  assert.equal(calls.length, 2);
  assert.equal(selections, 1, 'explicit selection and invalid URL must not read the current selection');
  const error = new Error('adapter failed');
  const failed = createImageCommand({ getSelection: () => ({ start: 0, end: 0 }), replaceRange() { throw error; } });
  assert.throws(() => failed.insert('a.png'), value => value === error);
});

test('production command uses the Import public factory and owns no duplicate image formatting', async () => {
  const command = await readFile(new URL('../src/features/editor/commands/image-command.js', import.meta.url), 'utf8');
  const factory = await readFile(new URL('../src/features/import/images/image-markdown-factory.js', import.meta.url), 'utf8');
  assert.match(command, /from '\.\.\/\.\.\/import\/index\.js'/);
  assert.match(command, /createImageMarkdown\(url, options\)/);
  assert.doesNotMatch(command, /safeAlt|normalizedUrl|fallbackAlt|\.replace\(/);
  assert.doesNotMatch(factory, /document\.|window\.|FileReader|fetch\(|editor\.|replaceRange|addEventListener/);
});
