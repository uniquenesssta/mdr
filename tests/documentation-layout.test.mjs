import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('root README is a concise introduction and detailed history lives in docs/README.md', async () => {
  const [rootReadme, docsReadme, checks, persistence] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('docs/README.md', 'utf8'),
    readFile('scripts/architecture/checks.mjs', 'utf8'),
    readFile('scripts/stage-00/persist-results.mjs', 'utf8')
  ]);

  const normalizedRootReadme = rootReadme.replace(/\r\n?/g, '\n');

  assert.match(normalizedRootReadme, /^# Markdown Editor/m);
  assert.match(normalizedRootReadme, /\[docs\/README\.md\]\(docs\/README\.md\)/);
  assert.ok(normalizedRootReadme.length >= 120 && normalizedRootReadme.length <= 360);
  assert.doesNotMatch(normalizedRootReadme, /stage-\d{2}-node|## Change Log/);

  assert.match(docsReadme, /^# Markdown Editor/m);
  assert.match(docsReadme, /## Change Log/);
  assert.match(docsReadme, /<!-- stage-03-node:03-05 -->/);
  assert.match(docsReadme, /<!-- stage-01-node:01-10 -->/);

  assert.match(checks, /const readmePath = 'docs\/README\.md';/);
  assert.match(persistence, /resolve\(root, 'docs\/README\.md'\)/);
});
