import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createE2EBridge } from '../src/features/e2e/index.js';
import { createApplicationDriver } from './e2e/lib/application-driver.mjs';

test('browser E2E runner stays dependency-free and covers required interactions', async () => {
  const runner = await readFile(new URL('./e2e/run-browser-tests.mjs', import.meta.url), 'utf8');
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
    'feature content releases owned nodes, rolls back invalid construction and leaves App Shell ownership intact',
    'application shell has no structural overflow or clipped focus across required viewports',
    'application Document Session Controller keeps lifecycle model, session and UI coherent',
    'application Recent Files Repository and read-only Menu projection enforce limit, case-insensitive dedupe and clear'
  ]) assert.ok(runner.includes(phrase), `missing browser scenario: ${phrase}`);
  assert.match(runner, /node:assert\/strict/);
  assert.doesNotMatch(runner, /playwright|puppeteer|selenium-webdriver/i);
  assert.match(browserLauncher, /--headless=new/);
  assert.match(browserLauncher, /accessSync/);
  assert.doesNotMatch(browserLauncher, /spawnSync|--version/);
  assert.match(runner, /createApplicationDriver/);
  assert.doesNotMatch(runner, /virtualEditor\.loadDocument|setLayoutMode\('hybrid',false\)/);
});

test('application installs the E2E bridge only through explicit opt-in', () => {
  for (const environment of [{ url: 'http://localhost/', testFlag: false }, { url: 'http://localhost/?e2e=true', testFlag: 'true' },
    { url: 'http://localhost/?e2e=1', testFlag: false }, { url: 'http://localhost/', testFlag: true }]) {
    const host = {}, api = { destroy() {} }; let created = 0;
    const bridge = createE2EBridge({ readEnvironment: () => environment,
      readSlotDescriptor: () => Object.getOwnPropertyDescriptor(host, 'api'),
      defineSlot: descriptor => Object.defineProperty(host, 'api', descriptor), deleteSlot: () => Reflect.deleteProperty(host, 'api') });
    const enabled = environment.testFlag === true || environment.url.endsWith('?e2e=1');
    assert.equal(bridge.configure(() => { created++; return api; }), enabled);
    assert.equal(bridge.install(), enabled ? api : null);
    assert.equal(created, enabled ? 1 : 0);
    bridge.destroy(); assert.equal(Object.hasOwn(host, 'api'), false);
  }
});

test('E2E fixture loading follows the application document lifecycle', async () => {
  const calls = [], result = { ready: true, documentId: 'imported', documentGeneration: 2, documentVersion: 0 };
  const api = { loadMarkdown(...args) { calls.push(JSON.parse(JSON.stringify(args))); return result; } };
  const driver = createApplicationDriver({ evaluate: source => runInNewContext(source, {
    __markdownEditorE2E: api, get document() { assert.fail('Runner bypassed public import'); }
  }) });
  assert.equal(await driver.loadMarkdown('# document', { layout: 'hybrid' }), result);
  assert.deepEqual(calls, [['# document', { layout: 'hybrid' }]]);
});

test('hybrid widgets keep geometry explicit while document pointer listeners are Session-owned', async () => {
  const [widgets, mermaidWidget, tableCellEditor, outsidePointer, session] = await Promise.all([
    readFile(new URL('../src/features/hybrid-editor/widgets/html/html-block-widget.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/hybrid-editor/widgets/table/table-cell-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/hybrid-editor/activation/outside-pointer-closure.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/hybrid-editor/state/hybrid-component-session.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(widgets, /scheduleHybridWidgetGeometry/);
  assert.match(mermaidWidget, /scheduleHybridWidgetGeometry/);
  assert.doesNotMatch(widgets, /from ['"]\.\/widget-lifecycle\.js['"]/);
  assert.match(widgets, /bindWidgetSourceAction/);
  assert.doesNotMatch(widgets, /bindOutsidePointerClosure/);
  assert.match(tableCellEditor, /bindOutsidePointerClosure/);
  assert.doesNotMatch(widgets, /document\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(widgets, /document\.removeEventListener\('pointerdown'/);
  assert.doesNotMatch(mermaidWidget, /document\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(mermaidWidget, /document\.removeEventListener\('pointerdown'/);
  assert.doesNotMatch(tableCellEditor, /document\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(tableCellEditor, /document\.removeEventListener\('pointerdown'/);
  assert.match(outsidePointer, /session\.registerDocumentListener/);
  assert.match(session, /registerDocumentListener\(target, type, listener, options\)/);
  assert.match(session, /#disposeDocumentListeners\(\)/);
});

test('local full-application E2E refuses stale build output', async () => {
  const runner = await readFile(new URL('./e2e/run-browser-tests.mjs', import.meta.url), 'utf8');
  const app = runner.slice(runner.indexOf('async function runAppSuite()'));
  const admission = app.indexOf('await verifyBuiltApplication({ projectRoot })');
  const launch = app.indexOf('await launchChromium(');
  assert.ok(admission >= 0 && launch >= 0 && admission < launch);
  assert.match(app, /r15-12-build-fingerprint\.json/);
  // Byte-level rejection and recovery are exercised in stage-15-stale-dist.test.mjs.
  assert.doesNotMatch(app, /!externalUrl && !bridgeAvailable/);
});
