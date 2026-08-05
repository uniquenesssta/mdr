import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import * as modelKernel from '../../src/model-kernel/index.js';
import * as documentModel from '../../src/document/document-model.js';
import * as incrementalPreview from '../../src/preview/incremental-preview.js';
import * as tableModel from '../../src/editor/hybrid/table-model.js';
import * as mathRanges from '../../src/editor/hybrid/math-ranges.js';
import * as hybridRanges from '../../src/editor/hybrid/ranges.js';
import * as selectionMapping from '../../src/sync/selection-mapping.js';
import * as mathSource from '../../src/preview/math-source.js';
import * as blockRegistry from '../../src/editor/hybrid/block-registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const frozenNamespaces = [
  documentModel,
  incrementalPreview,
  tableModel,
  mathRanges,
  hybridRanges,
  selectionMapping,
  mathSource,
  blockRegistry
];
const expectedExports = {};
const exportOwners = new Map();
for (const namespace of frozenNamespaces) {
  for (const [name, value] of Object.entries(namespace)) {
    assert.equal(exportOwners.has(name), false, `duplicate frozen-model export: ${name}`);
    exportOwners.set(name, namespace);
    expectedExports[name] = value;
  }
}

const expectedArities = Object.freeze({
  DocumentModel: 1,
  createDocumentModel: 1,
  IncrementalPreviewModel: 1,
  encodeTableCell: 1,
  parseTableRow: 1,
  collectInlineMathRanges: 2,
  collectMathBlocks: 1,
  collectVisibleLines: 1,
  getEditableRanges: 2,
  getExpandedVisibleRanges: 1,
  intersectsRanges: 2,
  intersectsRevealRanges: 2,
  mergeRanges: 1,
  overlapsRanges: 3,
  shouldDecorateSourceActiveLine: 4,
  createMarkdownSourceProjection: 1,
  createPreviewDomProjection: 1,
  createPreviewRangesForSourceSelection: 5,
  getSelectionMappingDiagnostics: 2,
  mapPreviewDomPointToSource: 5,
  collectBackslashDisplayMathRanges: 1,
  containsMarkdownMath: 1,
  protectMarkdownMathSource: 1,
  restoreMarkdownMathSource: 2,
  collectHybridBlocks: 2
});

const frozenJavaScriptPaths = new Set([
  'src/document/document-model.js',
  'src/preview/incremental-preview.js',
  'src/editor/hybrid/table-model.js',
  'src/editor/hybrid/math-ranges.js',
  'src/editor/hybrid/ranges.js',
  'src/sync/selection-mapping.js',
  'src/preview/math-source.js',
  'src/editor/hybrid/block-registry.js'
]);

function normalizePath(path) {
  return path.split(sep).join('/');
}

async function discoverJavaScriptFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await discoverJavaScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(path);
  }
  return output;
}

function collectModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) specifiers.push(match[1]);
  }
  return specifiers;
}

test('model-kernel exposes the exact frozen JavaScript contract by identity', () => {
  assert.equal(Object.keys(expectedExports).length, 26);
  assert.deepEqual(Object.keys(modelKernel).sort(), Object.keys(expectedExports).sort());
  for (const [name, value] of Object.entries(expectedExports)) {
    assert.equal(modelKernel[name], value, `facade changed export identity: ${name}`);
  }
  for (const [name, arity] of Object.entries(expectedArities)) {
    assert.equal(typeof modelKernel[name], 'function', `${name} must remain callable`);
    assert.equal(modelKernel[name].length, arity, `${name} signature arity changed`);
  }
  assert.equal(modelKernel.selectionMappingApi, selectionMapping.selectionMappingApi);
  assert.equal(Object.isFrozen(modelKernel.selectionMappingApi), true);
});

test('model-kernel is an explicit side-effect-free named re-export facade', async () => {
  const source = await readFile(resolve(root, 'src/model-kernel/index.js'), 'utf8');
  assert.doesNotMatch(source, /\bexport\s*\*/);
  assert.doesNotMatch(source, /\b(?:import|const|let|var|function|class)\b/);
  const statementPattern = /export\s*\{[^}]+\}\s*from\s*['"][^'"]+['"]\s*;/g;
  const statements = source.match(statementPattern) || [];
  assert.equal(statements.length, 8);
  assert.equal(source.replace(statementPattern, '').trim(), '');
});

test('all Stage 0 frozen hashes remain byte-identical', async () => {
  const baseline = JSON.parse(await readFile(
    resolve(root, 'docs/rewrite-progress/stage-00/evidence/frozen-model-hashes.json'),
    'utf8'
  ));
  assert.equal(baseline.length, 9);
  for (const record of baseline) {
    const bytes = await readFile(resolve(root, record.path));
    const actual = createHash('sha256').update(bytes).digest('hex');
    assert.equal(actual, record.sha256, `frozen contract changed: ${record.path}`);
  }
});

test('non-model source modules cannot bypass the stable model-kernel entry', async () => {
  const violations = [];
  for (const absolutePath of await discoverJavaScriptFiles(resolve(root, 'src'))) {
    const modulePath = normalizePath(relative(root, absolutePath));
    if (modulePath === 'src/model-kernel/index.js' || frozenJavaScriptPaths.has(modulePath)) continue;
    const source = await readFile(absolutePath, 'utf8');
    for (const specifier of collectModuleSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const resolvedPath = normalizePath(relative(root, resolve(dirname(absolutePath), specifier)));
      if (frozenJavaScriptPaths.has(resolvedPath)) violations.push(`${modulePath} -> ${resolvedPath}`);
    }
  }
  assert.deepEqual(violations, []);
});
