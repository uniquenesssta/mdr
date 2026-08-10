import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const completedEditorModules = Object.freeze([
  'src/features/editor/index.js',
  'src/features/editor/application/editor-controller.js',
  'src/features/editor/infrastructure/codemirror-editor-adapter.js',
  'src/features/editor/infrastructure/codemirror-extension-registry.js',
  'src/features/editor/infrastructure/pointer-selection/precise-pointer-selection.js',
  'src/features/editor/infrastructure/pointer-selection/caret-boundary-reader.js',
  'src/features/editor/infrastructure/pointer-selection/pointer-selection-policy.js'
]);

const retiredInfrastructurePaths = Object.freeze([
  'src/editor/codemirror/index.js',
  'src/editor/codemirror/codemirror-adapter.js',
  'src/editor/codemirror/codemirror-extension-registry.js',
  'src/editor/pointer-selection/precise-pointer-selection.js',
  'src/editor/pointer-selection/caret-boundary-reader.js',
  'src/editor/pointer-selection/pointer-selection-policy.js'
]);

function assertResponsibilityHeader(path, source) {
  const header = source.slice(0, 1600);
  assert.match(header, /Responsibility:/, `${path}: missing Responsibility`);
  assert.match(header, /Imports:/, `${path}: missing Imports contract`);
  assert.match(header, /Exports:/, `${path}: missing Exports contract`);
  assert.match(header, /State\/side effects:/, `${path}: missing State/side effects contract`);
  assert.match(header, /Lifecycle:/, `${path}: missing Lifecycle contract`);
}

test('CR-05 keeps completed Stage 5 editor infrastructure on the taskbook feature paths with explicit module contracts', async () => {
  const failures = [];
  for (const path of completedEditorModules) {
    try {
      await access(path);
      const source = await readFile(path, 'utf8');
      assertResponsibilityHeader(path, source);
    } catch (error) {
      failures.push(`${path}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('CR-05 retires the pre-conformance 5.5-5.7 infrastructure paths instead of keeping forwarding copies', async () => {
  const survivors = [];
  for (const path of retiredInfrastructurePaths) {
    try {
      await access(path);
      survivors.push(path);
    } catch (_) {
      // Expected: the migrated implementation has one production owner only.
    }
  }
  assert.deepEqual(survivors, []);
});

test('CR-05 makes the Stage 5 Editor feature entry the public infrastructure boundary for remaining legacy callers', async () => {
  const [editorIndex, virtualEditor, architectureFixture] = await Promise.all([
    readFile('src/features/editor/index.js', 'utf8'),
    readFile('src/editor/virtual-editor.js', 'utf8'),
    readFile('tests/architecture/fixtures/production-modules.json', 'utf8')
  ]);

  for (const exportedContract of [
    'createCodeMirrorAdapter',
    'CODEMIRROR_EXTENSION_SLOT_NAMES',
    'createCodeMirrorExtensionRegistry',
    'createEditorController'
  ]) {
    assert.match(editorIndex, new RegExp(`\\b${exportedContract}\\b`));
  }
  assert.doesNotMatch(editorIndex, /EditorView|EditorState|Compartment/);

  assert.match(virtualEditor, /from ['"]\.\.\/features\/editor\/index\.js['"]/);
  assert.doesNotMatch(virtualEditor, /\.\/codemirror\/index\.js/);

  for (const path of completedEditorModules.slice(2)) {
    assert.match(architectureFixture, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const path of retiredInfrastructurePaths) {
    assert.doesNotMatch(architectureFixture, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
