import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);

async function text(path) {
  return readFile(file(path), 'utf8');
}

test('Atomic 8.2 has one public Component Session owner and removes the legacy state authority', async () => {
  const index = await text('src/features/hybrid-editor/index.js');
  const session = await text('src/features/hybrid-editor/state/hybrid-component-session.js');
  assert.match(index, /state\/hybrid-component-session\.js/);
  assert.match(session, /export class HybridComponentSession/);
  assert.match(session, /this\.current = null/);
  assert.match(session, /this\.version = 0/);
  assert.match(session, /this\.closerBinding = null/);
  assert.doesNotMatch(session, /componentClosers|new WeakMap\(\)[\s\S]*new WeakMap\(\)/);
  await assert.rejects(access(file('src/editor/hybrid/component-state.js')));
});

test('Atomic 8.2 production callers depend on the Hybrid Editor public entry only', async () => {
  const callers = {
    'src/editor/hybrid/widgets.js': '../../features/hybrid-editor/index.js',
    'src/editor/hybrid/controller.js': '../../features/hybrid-editor/index.js',
    'src/editor/virtual-editor.js': '../features/hybrid-editor/index.js'
  };
  for (const [path, publicEntry] of Object.entries(callers)) {
    const source = await text(path);
    assert.match(source, new RegExp(publicEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(source, /component-state\.js|hybrid-component-session\.js/);
  }
});

test('Atomic 8.2 Session lifecycle remains authoritative after Atomic 8.3 Activation migration', async () => {
  const controller = await text('src/editor/hybrid/controller.js');
  assert.match(controller, /getHybridComponentSession\(view, \{ onTransition: recordHybridComponentTransition \}\)/);
  assert.match(controller, /destroyHybridComponentSession\(this\.view\)/);
  assert.doesNotMatch(controller, /clearHybridComponentStates\(this\.view\)/);
  await assert.rejects(access(file('src/editor/hybrid/double-activation.js')));
  await access(file('src/features/hybrid-editor/activation/strict-double-activation.js'));
  await access(file('src/features/hybrid-editor/activation/source-activation.js'));
  await access(file('src/features/hybrid-editor/activation/outside-pointer-closure.js'));
  await access(file('src/features/hybrid-editor/application/hybrid-source-edit-controller.js'));
});

test('Atomic 8.2 production inventory records the facade and sole Session state owner', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  const paths = inventory.modules.map(item => item[0]);
  assert.equal(inventory.modules.length, 355);
  assert.ok(paths.includes('src/features/hybrid-editor/index.js'));
  assert.ok(paths.includes('src/features/hybrid-editor/state/hybrid-component-session.js'));
  assert.ok(!paths.includes('src/editor/hybrid/component-state.js'));
  const session = inventory.modules.find(item => item[0] === 'src/features/hybrid-editor/state/hybrid-component-session.js');
  assert.equal(session[4], 'hybrid-component-session');
});
