import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('browser E2E runner stays dependency-free and covers required interactions', async () => {
  const runner = await readFile(new URL('./e2e/run-browser-tests.mjs', import.meta.url), 'utf8');
  const bridge = await readFile(new URL('../src/runtime/e2e-bridge.js', import.meta.url), 'utf8');
  const browserLauncher = await readFile(new URL('./e2e/lib/cdp-browser.mjs', import.meta.url), 'utf8');
  for (const phrase of [
    'single click keeps a component presented',
    'strict double click opens direct editing',
    'real pointer drag selects only the intended characters',
    'shared Mermaid renderer keeps hybrid and preview SVG normalization identical',
    'application code block placeholder never receives a phantom source highlight',
    'application Hybrid table pointer input avoids block decoration dispatch races',
    'application Mermaid presentation stays normalized across hybrid and preview layouts',
    'source editing closes on an outside pointer action',
    'layout switching closes active component editing',
    'application theme switch changes visual tokens without changing shell geometry',
    'application Theme Toggle Controller commits through Settings and Theme Service without rebuilding editor model or preview',
    'application Theme Service applies committed theme without rebuilding editor model or preview',
    'application mounts one App Shell with strict named slots',
    'application Help feature owns first-run visibility, navigation and scoped lifecycle',
    'application Settings Store cancels draft without persisting changes',
    'application Settings UI validates and applies one draft without global dialog functions',
    'application language Settings commit updates I18n without legacy globals',
    'temporary compatibility business port mounts and destroys without owning the App Shell',
    'application shell has no structural overflow or clipped focus across required viewports',
    'application Document Session Controller keeps lifecycle model, session and UI coherent',
    'application Recent Files Repository and read-only Menu projection enforce limit, case-insensitive dedupe and clear'
  ]) assert.ok(runner.includes(phrase), `missing browser scenario: ${phrase}`);
  assert.match(runner, /node:assert\/strict/);
  assert.doesNotMatch(runner, /playwright|puppeteer|selenium-webdriver/i);
  assert.match(browserLauncher, /--headless=new/);
  assert.match(browserLauncher, /accessSync/);
  assert.doesNotMatch(browserLauncher, /spawnSync|--version/);
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

test('E2E fixture loading follows the application document lifecycle', async () => {
  const bridge = await readFile(new URL('../src/runtime/e2e-bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /loadTextContentAsDocument/);
  assert.doesNotMatch(bridge, /virtualEditor\.loadDocument/);
  assert.doesNotMatch(bridge, /dispatchEditorInput/);
});

test('hybrid widgets keep geometry explicit while document pointer listeners are Session-owned', async () => {
  const [widgets, outsidePointer, session] = await Promise.all([
    readFile(new URL('../src/editor/hybrid/widgets.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/hybrid-editor/activation/outside-pointer-closure.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/hybrid-editor/state/hybrid-component-session.js', import.meta.url), 'utf8')
  ]);
  assert.match(widgets, /scheduleHybridWidgetGeometry/);
  assert.match(widgets, /from '\.\/widget-lifecycle\.js'/);
  assert.match(widgets, /bindOutsidePointerClosure/);
  assert.doesNotMatch(widgets, /document\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(widgets, /document\.removeEventListener\('pointerdown'/);
  assert.match(outsidePointer, /session\.registerDocumentListener/);
  assert.match(session, /registerDocumentListener\(target, type, listener, options\)/);
  assert.match(session, /#disposeDocumentListeners\(\)/);
});

test('local full-application E2E refuses stale build output', async () => {
  const runner = await readFile(new URL('./e2e/run-browser-tests.mjs', import.meta.url), 'utf8');
  assert.match(runner, /Built dist is stale or was not produced from the current source/);
  assert.match(runner, /Run npm run build before npm run test:browser/);
});
