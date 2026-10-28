import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewComponentMapping } from '../../../src/features/sync/selection/preview-component-mapping.js';
import { createFinalSelectionController } from '../../helpers/stage-09-selection-controller-harness.mjs';

const source = '```mermaid\nflowchart LR\n A[打开]-->B[保存]\n```\n';
function fixture() {
  const node = {}, svg = {};
  const root = { matches: selector => selector === '.mermaid', querySelector: () => svg, contains: n => n === node };
  return { root, node, mapping: createPreviewComponentMapping() };
}
test('rendered Mermaid syntax corresponds to its source component without claiming character accuracy', () => {
  const f = fixture(); const plan = f.mapping.createPreviewRangesForSourceSelection(f.root, source, 100, 111, 122);
  assert.deepEqual(plan.atomicElements, [f.root]); assert.equal(plan.componentMapping, true);
  assert.deepEqual(plan.ranges, []); assert.equal(plan.sourceCharacters, 11); assert.equal(plan.mappedCharacters, 11);
  assert.equal(f.mapping.mapPreviewDomPointToSource(f.root, source, 100, f.node, 0, 'start').position, 100);
  assert.equal(f.mapping.mapPreviewDomPointToSource(f.root, source, 100, f.node, 3, 'end').position, 100 + source.length);
  assert.equal(f.mapping.mapPreviewDomPointToSource(f.root, source, 100, {}, 0, 'start'), null);
  assert.deepEqual(f.mapping.createPreviewRangesForSourceSelection(f.root, source, 100, 0, 10).atomicElements, []);
});
test('ordinary text, raw HTML and unrendered/error Mermaid preserve the frozen text mapper', () => {
  const f = fixture();
  assert.equal(f.mapping.createPreviewRangesForSourceSelection(f.root, '<div>raw</div>', 0, 0, 3), null);
  f.root.querySelector = () => null;
  assert.equal(f.mapping.mapPreviewDomPointToSource(f.root, source, 0, f.node, 1, 'end'), null);
});
test('component diagnostics stay honest and repeated drag warnings have a stable fingerprint', () => {
  const h = createFinalSelectionController(); const warnings = []; h.controller.diagnostic = (event, options) => warnings.push(options);
  h.controller.recordResult('editor-to-preview', 'editor-select', { status: 'mapping-failed', selectionLength: 1 });
  h.controller.recordResult('editor-to-preview', 'editor-select', { status: 'mapping-failed', selectionLength: 16 });
  h.controller.recordResult('editor-to-preview', 'editor-pointerup', { status: 'mapping-failed', selectionLength: 16 });
  assert.equal(warnings[0].fingerprint, warnings[1].fingerprint);
  assert.notEqual(warnings[1].fingerprint, warnings[2].fingerprint);
});
