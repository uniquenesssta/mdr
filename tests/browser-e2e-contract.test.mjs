import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('browser E2E runner stays dependency-free and covers required interactions', async () => {
  const runner = await readFile(new URL('./e2e/run-browser-tests.mjs', import.meta.url), 'utf8');
  const bridge = await readFile(new URL('../src/runtime/e2e-bridge.js', import.meta.url), 'utf8');
  for (const phrase of [
    'single click keeps a component presented',
    'strict double click opens direct editing',
    'real pointer drag selects only the intended characters',
    'shared Mermaid renderer keeps hybrid and preview SVG normalization identical',
    'application code block placeholder never receives a phantom source highlight',
    'application Mermaid presentation stays normalized across hybrid and preview layouts',
    'source editing closes on an outside pointer action',
    'layout switching closes active component editing'
  ]) assert.ok(runner.includes(phrase), `missing browser scenario: ${phrase}`);
  assert.match(runner, /node:assert\/strict/);
  assert.doesNotMatch(runner, /playwright|puppeteer|selenium-webdriver/i);
  assert.match(bridge, /loadMarkdown/);
  assert.match(bridge, /getHybridComponentStates/);
});

test('application installs the E2E bridge only through explicit opt-in', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const bridge = await readFile(new URL('../src/runtime/e2e-bridge.js', import.meta.url), 'utf8');
  assert.match(main, /installMarkdownEditorE2EBridge\(\)/);
  assert.match(bridge, /__MARKDOWN_EDITOR_E2E__/);
  assert.match(bridge, /searchParams\.get\('e2e'\) === '1'/);
});


test('hybrid widgets keep geometry and outside-pointer lifecycle wiring explicit', async () => {
  const widgets = await readFile(new URL('../src/editor/hybrid/widgets.js', import.meta.url), 'utf8');
  assert.match(widgets, /scheduleHybridWidgetGeometry/);
  assert.match(widgets, /from '\.\/widget-lifecycle\.js'/);
  assert.ok((widgets.match(/document\.addEventListener\('pointerdown', handleOutsidePointer, true\)/g) || []).length >= 2);
  assert.ok((widgets.match(/document\.removeEventListener\('pointerdown', handleOutsidePointer, true\)/g) || []).length >= 2);
});

test('local full-application E2E refuses stale build output', async () => {
  const runner = await readFile(new URL('./e2e/run-browser-tests.mjs', import.meta.url), 'utf8');
  assert.match(runner, /Built dist is stale or was not produced from the current source/);
  assert.match(runner, /Run npm run build before npm run test:browser/);
});
