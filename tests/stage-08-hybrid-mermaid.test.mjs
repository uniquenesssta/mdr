import test from 'node:test';
import assert from 'node:assert/strict';

import { createMermaidBlockWidgetType } from '../src/features/hybrid-editor/index.js';
import { copyMermaidSource } from '../src/features/hybrid-editor/widgets/mermaid/mermaid-actions.js';
import {
  createMermaidRenderIdentity,
  createMermaidRenderState
} from '../src/features/hybrid-editor/widgets/mermaid/mermaid-render-state.js';

test('Atomic 8.12 render identity contains Mermaid source, theme and source position', () => {
  const identity = createMermaidRenderIdentity('graph TD; A-->B', 'dark', 42);
  assert.equal(identity, '42\0dark\0graph TD; A-->B');
  assert.notEqual(identity, createMermaidRenderIdentity('graph TD; B-->A', 'dark', 42));
  assert.notEqual(identity, createMermaidRenderIdentity('graph TD; A-->B', 'default', 42));
  assert.notEqual(identity, createMermaidRenderIdentity('graph TD; A-->B', 'dark', 43));
});

test('Atomic 8.12 newer Mermaid render requests supersede older requests monotonically', () => {
  const state = createMermaidRenderState({ sourceFrom: 21, source: 'graph TD; A-->B' });
  const first = state.begin(undefined, 'default');
  const second = state.begin('graph TD; B-->C', 'dark');
  assert.equal(first.cacheKey, 'hybrid:21');
  assert.equal(second.serial, first.serial + 1);
  assert.equal(state.isCurrent(first), false);
  assert.equal(state.isCurrent(second), true);
  assert.equal(state.source, 'graph TD; B-->C');
});

test('Atomic 8.12 stale Mermaid completion cannot publish after a newer request exists', () => {
  const state = createMermaidRenderState({ sourceFrom: 8 });
  const published = [];
  const first = state.begin('graph TD; A-->B', 'default');
  const second = state.begin('graph TD; A-->C', 'default');
  assert.equal(state.commit(first, () => published.push('stale')), false);
  assert.equal(state.commit(second, () => published.push('current')), true);
  assert.deepEqual(published, ['current']);
});

test('Atomic 8.12 invalidation rejects an in-flight Mermaid completion before direct editing', () => {
  const state = createMermaidRenderState({ sourceFrom: 5 });
  const request = state.begin('sequenceDiagram\nA->>B: hi', 'default');
  assert.equal(state.invalidate(), true);
  assert.equal(state.isCurrent(request), false);
  assert.equal(state.commit(request, () => assert.fail('stale request published')), false);
  const next = state.begin('sequenceDiagram\nB->>A: ok', 'default');
  assert.equal(next.serial > request.serial, true);
  assert.equal(state.isCurrent(next), true);
});

test('Atomic 8.12 Mermaid render-state destroy is terminal and rejects post-destroy work', () => {
  const state = createMermaidRenderState({ sourceFrom: 7, source: 'graph TD; A-->B' });
  const request = state.begin(undefined, 'dark');
  state.destroy();
  state.destroy();
  assert.equal(state.destroyed, true);
  assert.equal(state.isCurrent(request), false);
  assert.equal(state.begin('graph TD; X-->Y', 'dark'), null);
  assert.equal(state.setSource('changed'), false);
  assert.equal(state.commit(request, () => assert.fail('destroyed state published')), false);
});

test('Atomic 8.12 Mermaid copy uses the provided clipboard capability without DOM fallback', async () => {
  const writes = [];
  await copyMermaidSource('graph TD; A-->B', {
    navigatorRef: { clipboard: { async writeText(value) { writes.push(value); } } }
  });
  assert.deepEqual(writes, ['graph TD; A-->B']);
});

test('Atomic 8.12 Mermaid widget factory requires injected presentation capabilities and preserves descriptor equality', () => {
  class StubWidgetType {}
  assert.throws(() => createMermaidBlockWidgetType(StubWidgetType), /presentation renderer/);
  assert.throws(
    () => createMermaidBlockWidgetType(StubWidgetType, { renderDiagram: async () => ({ status: 'rendered' }) }),
    /theme reader/
  );
  const MermaidWidget = createMermaidBlockWidgetType(StubWidgetType, {
    renderDiagram: async () => ({ status: 'rendered' }),
    getTheme: () => 'default'
  });
  const descriptor = {
    from: 10,
    to: 40,
    contentFrom: 20,
    contentTo: 36,
    code: 'graph TD; A-->B',
    fingerprint: 'fingerprint',
    fenceCharacter: '~',
    fenceLength: 4,
    infoRaw: ' mermaid '
  };
  const left = new MermaidWidget(descriptor, { visualEditing: true });
  const right = new MermaidWidget(descriptor, { visualEditing: true });
  assert.equal(left.eq(right), true);
  assert.equal(left.editFrom, 20);
  assert.equal(left.editTo, 36);
  assert.equal(left.fenceCharacter, '~');
  assert.equal(left.fenceLength, 4);
  assert.equal(left.infoRaw, ' mermaid ');
});
