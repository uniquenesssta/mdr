import test from 'node:test';
import assert from 'node:assert/strict';
import * as modelKernel from '../src/model-kernel/index.js';
import * as frozenMapping from '../src/sync/selection-mapping.js';

test('R9-11 model-kernel exposes the exact frozen selectionMappingApi reference', () => {
  assert.equal(modelKernel.selectionMappingApi, frozenMapping.selectionMappingApi);
  assert.equal(Object.isFrozen(modelKernel.selectionMappingApi), true);
});

test('R9-11 model-kernel named selection mapping exports preserve exact frozen function identities', () => {
  for (const name of [
    'createMarkdownSourceProjection',
    'createPreviewDomProjection',
    'createPreviewRangesForSourceSelection',
    'getSelectionMappingDiagnostics',
    'mapPreviewDomPointToSource'
  ]) {
    assert.equal(modelKernel[name], frozenMapping[name], name);
    assert.equal(modelKernel.selectionMappingApi[name], frozenMapping[name], `${name} api identity`);
  }
});

test('R9-11 frozen projection behavior remains available through model-kernel without copied implementation', () => {
  const source = '# Alpha **Beta**\n';
  const projection = modelKernel.createMarkdownSourceProjection(source, 0);
  assert.equal(typeof projection?.text, 'string');
  assert.equal(Array.isArray(projection?.entries), true);
  assert.equal(projection.text.includes('Alpha'), true);
  assert.equal(projection.text.includes('Beta'), true);
});

test('R9-11 frozen mapping diagnostics remain the same model-kernel contract object behavior', () => {
  const direct = frozenMapping.getSelectionMappingDiagnostics();
  const viaKernel = modelKernel.getSelectionMappingDiagnostics();
  assert.deepEqual(viaKernel, direct);
});
