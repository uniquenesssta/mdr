import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
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

async function listSourceFiles(directory) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSourceFiles(relative));
    else if (['.css', '.html', '.js'].includes(extname(entry.name))) files.push(relative);
  }
  return files;
}

const legacyTokens = [
  '--bg', '--panel-bg', '--surface', '--surface-hover', '--text', '--text-secondary',
  '--text-muted', '--border', '--border-strong', '--accent', '--accent-hover',
  '--accent-soft', '--accent-strong-soft', '--danger', '--editor-text-color',
  '--editor-active-line-color', '--chrome-bg', '--card-bg', '--shadow-sm', '--shadow',
  '--shadow-md', '--shadow-lg', '--font-sans', '--font-mono', '--font-editor', '--font-ui'
];

const requiredTokens = {
  color: [
    '--color-canvas', '--color-surface-raised', '--color-text-primary',
    '--color-border-subtle', '--color-accent', '--color-danger'
  ],
  typography: [
    '--font-family-ui', '--font-family-editor', '--font-family-mono',
    '--font-size-xs', '--font-size-md', '--font-size-2xl'
  ],
  spacing: ['--space-2xs', '--space-md', '--space-2xl', '--space-8xl'],
  radius: ['--radius-xs', '--radius-md', '--radius-xl', '--radius-pill'],
  shadow: ['--shadow-low', '--shadow-raised', '--shadow-floating', '--shadow-overlay'],
  layer: ['--layer-below', '--layer-menu', '--layer-modal', '--layer-link-preview'],
  motion: [
    '--motion-duration-fast', '--motion-duration-moderate',
    '--motion-ease-standard', '--motion-ease-emphasized'
  ],
  code: [
    '--code-background', '--code-text', '--code-border', '--code-token-keyword',
    '--code-token-string', '--code-token-comment'
  ]
};

test('Atomic Task 2.7 exposes one ordered stylesheet entry and one token authority', async () => {
  const [entrySource, mainEntrySource, tokenSource, legacySource] = await Promise.all([
    readText('src/styles/index.css'),
    readText('src/main.js'),
    readText('src/styles/foundation/tokens.css'),
    readText('src/styles/main.css')
  ]);

  assert.equal(entrySource, "@import './foundation/tokens.css';\n@import './main.css';\n");
  assert.match(mainEntrySource, /^import '\.\/styles\/index\.css';/);
  assert.doesNotMatch(mainEntrySource, /styles\/main\.css/);
  assert.match(tokenSource, /^:root\s*\{/);
  assert.match(tokenSource, /\[data-theme="dark"\]\s*\{/);
  assert.doesNotMatch(legacySource, /(^|\n):root\s*\{/);
  assert.doesNotMatch(legacySource, /(^|\n)\[data-theme="dark"\]\s*\{\s*--/);
});

test('token contract separates required semantic categories without page-position names', async () => {
  const tokenSource = await readText('src/styles/foundation/tokens.css');
  const rootDefinitions = collectDefinitions(extractRule(tokenSource, ':root'));
  const darkDefinitions = collectDefinitions(extractRule(tokenSource, '[data-theme="dark"]'));

  for (const [category, names] of Object.entries(requiredTokens)) {
    for (const name of names) assert.ok(rootDefinitions.has(name), `${category} token missing: ${name}`);
  }
  for (const name of darkDefinitions.keys()) {
    assert.ok(rootDefinitions.has(name), `dark override has no base token: ${name}`);
  }
  for (const name of rootDefinitions.keys()) {
    assert.doesNotMatch(name, /(?:left|right|top|bottom|sidebar|workspace|header|footer)/, name);
  }

  assert.equal(rootDefinitions.get('--color-canvas'), '#eef1f5');
  assert.equal(rootDefinitions.get('--color-editor-text'), '#202530');
  assert.equal(rootDefinitions.get('--radius-md'), '7px');
  assert.equal(rootDefinitions.get('--motion-duration-moderate'), '0.20s');
  assert.equal(rootDefinitions.get('--code-background'), '#f5f7fb');
  assert.equal(darkDefinitions.get('--color-canvas'), '#0c1017');
  assert.equal(darkDefinitions.get('--code-background'), '#0b0f15');
});

test('production callers use semantic tokens and consolidated CSS has no color literals', async () => {
  const [tokenSource, mainSource, sourceFiles] = await Promise.all([
    readText('src/styles/foundation/tokens.css'),
    readText('src/styles/main.css'),
    Promise.all(['src', 'public'].map(listSourceFiles))
  ]);
  const tokenDefinitions = collectDefinitions(tokenSource);
  const mainDefinitions = collectDefinitions(mainSource);
  const available = new Set([...tokenDefinitions.keys(), ...mainDefinitions.keys()]);
  const runtimeOwned = new Set([
    '--editor-font-size', '--indicator-color', '--sidebar-width', '--swatch-color', '--tree-depth'
  ]);

  assert.doesNotMatch(mainSource, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  const productionFiles = sourceFiles.flat();
  for (const path of productionFiles) {
    const source = await readText(path);
    for (const name of legacyTokens) {
      assert.doesNotMatch(source, new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`, 'i'), `${path}: ${name}`);
    }
    for (const match of source.matchAll(/var\((--[a-z0-9-]+)/gi)) {
      assert.ok(available.has(match[1]) || runtimeOwned.has(match[1]), `${path}: undefined ${match[1]}`);
    }
  }
});
