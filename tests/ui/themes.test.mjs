import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDefinitions,
  expectedStyleEntry,
  extractRule,
  readImportedStyles,
  readText
} from './style-test-utils.mjs';

function assertOnlyCustomProperties(source, selector) {
  const body = extractRule(source, selector)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[a-z0-9-]+\s*:\s*[^;]+;/gi, '')
    .trim();
  assert.equal(body, '', `${selector} contains non-token declarations: ${body}`);
}

test('Atomic Task 2.8 loads token-only themes before every shell, layout, component and feature module', async () => {
  const [entrySource, tokenSource, lightSource, darkSource, styles] = await Promise.all([
    readText('src/styles/index.css'),
    readText('src/styles/foundation/tokens.css'),
    readText('src/styles/themes/light.css'),
    readText('src/styles/themes/dark.css'),
    readImportedStyles()
  ]);

  assert.equal(entrySource, expectedStyleEntry());
  assert.doesNotMatch(tokenSource, /\[data-theme/);
  assert.match(lightSource, /^:root\s*\{/);
  assert.match(darkSource, /^\[data-theme="dark"\]\s*\{/);
  for (const { path, source } of styles.filter(record => !record.path.includes('/themes/'))) {
    assert.doesNotMatch(source, /\[data-theme/, path);
  }
  assert.ok(entrySource.indexOf("./themes/dark.css") < entrySource.indexOf("./shell/app-shell.css"));
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

test('theme split preserves the 2.8 values while 2.9 adds only named editor color presets', async () => {
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
  assert.equal(light.get('--color-preset-text-blue'), '#2563eb');
  assert.equal(light.get('--color-preset-highlight-yellow'), '#fff3a3');
  assert.doesNotMatch(lightSource + darkSource, /(?:^|\n)\s*(?:\.|#|[a-z][a-z0-9-]*\s+)[^{]*\{/i);
});
