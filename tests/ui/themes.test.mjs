import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const readText = path => readFile(resolve(root, path), 'utf8');

function extractRule(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`unclosed CSS rule: ${selector}`);
}

function collectDefinitions(source) {
  return new Map([...source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)]
    .map(match => [match[1], match[2].trim()]));
}

function assertOnlyCustomProperties(source, selector) {
  const body = extractRule(source, selector)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[a-z0-9-]+\s*:\s*[^;]+;/gi, '')
    .trim();
  assert.equal(body, '', `${selector} contains non-token declarations: ${body}`);
}

test('Atomic Task 2.8 loads separate light and dark token themes before component rules', async () => {
  const [entrySource, tokenSource, lightSource, darkSource, mainSource] = await Promise.all([
    readText('src/styles/index.css'),
    readText('src/styles/foundation/tokens.css'),
    readText('src/styles/themes/light.css'),
    readText('src/styles/themes/dark.css'),
    readText('src/styles/main.css')
  ]);

  assert.equal(entrySource, [
    "@import './foundation/tokens.css';",
    "@import './themes/light.css';",
    "@import './themes/dark.css';",
    "@import './main.css';",
    ''
  ].join('\n'));
  assert.doesNotMatch(tokenSource, /\[data-theme/);
  assert.match(lightSource, /^:root\s*\{/);
  assert.match(darkSource, /^\[data-theme="dark"\]\s*\{/);
  assert.doesNotMatch(mainSource, /\[data-theme/);
});

test('theme styles contain only visual token declarations and dark overrides have light defaults', async () => {
  const [lightSource, darkSource] = await Promise.all([
    readText('src/styles/themes/light.css'),
    readText('src/styles/themes/dark.css')
  ]);
  const light = collectDefinitions(extractRule(lightSource, ':root'));
  const dark = collectDefinitions(extractRule(darkSource, '[data-theme="dark"]'));
  const allowed = /^(?:--color-|--code-|--shadow-(?:low|raised|floating|overlay)$|--content-image-opacity$)/;

  assertOnlyCustomProperties(lightSource, ':root');
  assertOnlyCustomProperties(darkSource, '[data-theme="dark"]');
  for (const name of light.keys()) assert.match(name, allowed, `layout or component token in light theme: ${name}`);
  for (const name of dark.keys()) {
    assert.match(name, allowed, `layout or component token in dark theme: ${name}`);
    assert.ok(light.has(name), `dark override has no light default: ${name}`);
  }
  assert.doesNotMatch(lightSource + darkSource, /(?:--font-|--space-|--radius-|--layer-|--motion-)/);
});

test('theme split preserves existing light and dark values without duplicating component selectors', async () => {
  const [lightSource, darkSource] = await Promise.all([
    readText('src/styles/themes/light.css'),
    readText('src/styles/themes/dark.css')
  ]);
  const light = collectDefinitions(lightSource);
  const dark = collectDefinitions(darkSource);

  assert.equal(light.get('--color-canvas'), '#eef1f5');
  assert.equal(light.get('--color-editor-text'), '#202530');
  assert.equal(light.get('--shadow-floating'), '0 14px 36px rgba(15, 23, 42, 0.10)');
  assert.equal(light.get('--code-background'), '#f5f7fb');
  assert.equal(light.get('--content-image-opacity'), '1');
  assert.equal(dark.get('--color-canvas'), '#0c1017');
  assert.equal(dark.get('--color-editor-text'), '#e8edf5');
  assert.equal(dark.get('--shadow-floating'), '0 18px 42px rgba(0, 0, 0, 0.34)');
  assert.equal(dark.get('--code-background'), '#0b0f15');
  assert.equal(dark.get('--content-image-opacity'), '0.95');
  assert.doesNotMatch(lightSource + darkSource, /(?:^|\n)\s*(?:\.|#|[a-z][a-z0-9-]*\s+)[^{]*\{/i);
});
