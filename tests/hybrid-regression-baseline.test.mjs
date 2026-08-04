import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = new URL('./fixtures/hybrid-regression.md', import.meta.url);

test('hybrid regression fixture keeps every supported component family', async () => {
  const markdown = await readFile(fixture, 'utf8');
  const expectations = [
    '# Hybrid regression baseline',
    '**bold**',
    '[link](https://example.com)',
    '> > nested quote',
    '| A | B |',
    '```text',
    '```mermaid',
    '$$',
    '<div><strong>HTML</strong></div>'
  ];
  for (const token of expectations) assert.ok(markdown.includes(token), `missing regression token: ${token}`);
});
