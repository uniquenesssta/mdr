import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HYBRID_COMPONENT_MODES,
  HybridComponentSession,
  createHybridComponentKey
} from '../src/features/hybrid-editor/index.js';

const contractUrl = new URL('./fixtures/hybrid-component-contract.json', import.meta.url);

test('every visual component follows the same presentation/source lifecycle', async () => {
  const contract = JSON.parse(await readFile(contractUrl, 'utf8'));
  const machine = new HybridComponentSession();

  for (let index = 0; index < contract.length; index += 1) {
    const component = contract[index];
    const from = 100 + index * 100;
    const key = createHybridComponentKey(component.type, from);

    if (component.direct) {
      machine.transition({
        type: component.type,
        from,
        mode: HYBRID_COMPONENT_MODES.DIRECT,
        reason: 'contract-direct'
      });
      assert.equal(machine.get(key).mode, HYBRID_COMPONENT_MODES.DIRECT);
    }

    machine.transition({
      type: component.type,
      from,
      mode: HYBRID_COMPONENT_MODES.SOURCE,
      reason: 'contract-source'
    });
    assert.equal(machine.get(key).mode, HYBRID_COMPONENT_MODES.SOURCE);

    machine.close(key, 'contract-close');
    assert.equal(machine.get(key).mode, HYBRID_COMPONENT_MODES.PRESENTED);
  }
});

test('component widgets are wired to the shared runtime coordinator', async () => {
  const widgets = await readFile(new URL('../src/editor/hybrid/widgets.js', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../src/editor/hybrid/controller.js', import.meta.url), 'utf8');
  const sourceEditorPort = await readFile(new URL('../src/features/hybrid-editor/compatibility/codemirror-source-editor-port.js', import.meta.url), 'utf8');

  for (const type of ['code', 'mermaid', 'table', 'math', 'html', 'image']) {
    assert.match(widgets, new RegExp(`componentType:\\s*['\"]${type}['\"]`), `${type} is missing a source-edit component type`);
  }
  for (const type of ['code', 'mermaid', 'table']) {
    assert.match(
      widgets,
      new RegExp(`type:\\s*['\"]${type}['\"][\\s\\S]{0,180}mode:\\s*HYBRID_COMPONENT_MODES\\.DIRECT`),
      `${type} is missing direct-edit state coordination`
    );
  }

  assert.match(sourceEditorPort, /mapped\s*=\s*\{\s*\.\.\.mapped,/, 'source range metadata must survive document changes');
  assert.match(sourceEditorPort, /transaction\.changes\.mapPos\(mapped\.from, -1\)/, 'source range positions must map through document changes');
  assert.match(controller, /destroyHybridComponentSession\(this\.view\)/, 'component session must be destroyed with the editor view');
});
