import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createApplicationDriver } from './e2e/lib/application-driver.mjs';
import { CdpPage } from './e2e/lib/cdp-browser.mjs';

const pageFor = api => ({ evaluate: source => runInNewContext(source, { __markdownEditorE2E: api }) });

test('R15-11 runner adapter validates its CDP boundary and exposes only frozen public actions', () => {
  assert.throws(() => createApplicationDriver(), /CDP page/);
  const driver = createApplicationDriver(pageFor({}));
  assert.equal(Object.isFrozen(driver), true);
  assert.equal('evaluate' in driver, false);
  assert.equal('destroy' in driver, false);
});

for (const [method, args, result] of [
  ['loadMarkdown', ['` ${content} 中文🧪\n', { layout: 'both', selection: 0 }], { ready: true }],
  ['setLayout', ['preview'], 'preview'], ['setVisualEditing', [{ code: false, table: true }], null],
  ['revealText', ['"; throw new Error("injection") //', { preserveSelection: true }], 17],
  ['revealPosition', [0], 0], ['getEditorValue', [], 'exact\ntext'],
  ['snapshot', [], { documentId: 'owned', documentGeneration: 3, documentVersion: 4 }],
  ['getComponentStates', [], [{ type: 'code', mode: 'presentation' }]],
  ['getPreviewStats', [], { active: false, blocks: 2 }], ['getState', [], { activeOperations: 0 }],
  ['clearStorage', [], true], ['waitForIdle', [{ timeoutMs: 5000 }], true]
]) test('R15-11 runner serializes only public action ' + method, async () => {
  let received;
  const api = { [method](...values) { received = JSON.parse(JSON.stringify(values)); return result; } };
  assert.equal(await createApplicationDriver(pageFor(api))[method](...args), result);
  assert.deepEqual(received, args);
});

test('R15-11 missing or incomplete explicit capability fails without a legacy fallback', async () => {
  for (const api of [undefined, null, {}, { snapshot: false }]) {
    await assert.rejects(createApplicationDriver(pageFor(api)).snapshot(), /Explicit public E2E capability unavailable: snapshot/);
  }
});

test('R15-11 capability accessors are never executed', async () => {
  let reads = 0;
  const host = { get __markdownEditorE2E() { reads++; throw new Error('getter executed'); } };
  const driver = createApplicationDriver({ evaluate: source => runInNewContext(source, host) });
  await assert.rejects(driver.snapshot(), /Explicit public E2E capability unavailable/);
  assert.equal(reads, 0);
});

test('R15-11 unsuccessful idle and public action errors remain failures', async () => {
  await assert.rejects(createApplicationDriver(pageFor({ waitForIdle: () => false })).waitForIdle(), /did not complete/);
  const failure = new Error('E2E document changed');
  await assert.rejects(createApplicationDriver(pageFor({ loadMarkdown() { throw failure; } })).loadMarkdown('x'), error => error === failure);
});

test('R15-11 serialization failure never submits a browser command', async () => {
  let calls = 0;
  const driver = createApplicationDriver({ evaluate() { calls++; } });
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(driver.loadMarkdown('x', cyclic), /circular/i);
  assert.equal(calls, 0);
});

test('R15-11 CDP text insertion preserves Unicode without evaluating DOM setters', async () => {
  const sent = [];
  const page = new CdpPage({ send: async (method, params) => sent.push({ method, params }) });
  await page.insertText('中文🧪\n');
  assert.deepEqual(sent, [{ method: 'Input.insertText', params: { text: '中文🧪\n' } }]);
});

test('R15-11 CDP fill uses pointer focus, select-all, deletion and trusted text insertion', async () => {
  const calls = [];
  const page = new CdpPage({ send: async (method, params) => calls.push([method, params]) });
  page.click = async selector => calls.push(['click', selector]);
  await page.fill('#field', 'new');
  assert.deepEqual(calls.map(row => row[0]), ['click', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.insertText']);
  assert.equal(calls[1][1].modifiers, 2); assert.equal(calls[1][1].windowsVirtualKeyCode, 65);
  assert.equal(calls[3][1].key, 'Backspace'); assert.equal(calls[5][1].text, 'new');
});

test('R15-11 CDP option selection uses keyboard navigation and verifies the committed value', async () => {
  const calls = [];
  const page = new CdpPage({ send: async () => {} });
  let reads = 0;
  page.evaluate = async () => ++reads === 1 ? ['light', 'dark'] : 'dark';
  page.click = async selector => calls.push(selector);
  page.pressKey = async key => calls.push(key);
  await page.selectOption('#theme', 'dark');
  assert.deepEqual(calls, ['#theme', 'Home', 'ArrowDown', 'Enter']);
  reads = 0; page.evaluate = async () => ++reads === 1 ? ['light', 'dark'] : 'light';
  await assert.rejects(page.selectOption('#theme', 'dark'), /did not commit/);
});

test('R15-11 invalid option or failed focus cannot synthesize successful input', async () => {
  const page = new CdpPage({ send: async () => assert.fail('unexpected protocol input') });
  page.evaluate = async () => ['light'];
  await assert.rejects(page.selectOption('#theme', 'missing'), /not found/);
  page.click = async () => { throw new Error('no visible field'); };
  await assert.rejects(page.fill('#missing', 'x'), /no visible field/);
});

test('R15-11 pointer actions wait for hittable geometry and retain native double-click counts', async () => {
  const sent = [], selectors = [];
  const page = new CdpPage({ send: async (method, params) => sent.push({ method, params }) });
  page.waitForElementStable = async selector => { selectors.push(selector); return { x: 10, y: 20, width: 40, height: 60 }; };
  await page.click('#target', { count: 2, intervalMs: 20 });
  assert.deepEqual(selectors, ['#target']);
  assert.deepEqual(sent.map(row => row.params.clickCount), [1, 1, 2, 2]);
  for (const row of sent) { assert.equal(row.method, 'Input.dispatchMouseEvent'); assert.equal(row.params.x, 30); assert.equal(row.params.y, 50); }
  page.waitForElementStable = async () => { throw new Error('hidden target'); };
  await assert.rejects(page.click('#hidden'), /hidden target/);
  assert.equal(sent.length, 4);
});
