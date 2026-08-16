import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EditorState, Facet } from '@codemirror/state';
import {
  CODEMIRROR_EXTENSION_SLOT_NAMES,
  createCodeMirrorExtensionRegistry
} from '../../../src/features/editor/index.js';
import {
  hybridCodeVisualEditingFacet,
  hybridTableVisualEditingFacet
} from '../../../src/editor/hybrid-markdown.js';

function createStateHarness(registry, doc = 'alpha') {
  let state = EditorState.create({ doc, extensions: registry.getExtensions() });
  const effects = [];
  const detach = registry.attach(effect => {
    effects.push(effect);
    state = state.update({ effects: effect }).state;
    return true;
  });
  return {
    get state() { return state; },
    effects,
    detach
  };
}

test('Atomic 5.6 builds the required base, Markdown, theme, read-only and hybrid slots behind one registry', () => {
  const registry = createCodeMirrorExtensionRegistry({ placeholder: 'Write here' });
  assert.deepEqual(CODEMIRROR_EXTENSION_SLOT_NAMES, ['base', 'markdown', 'theme', 'readOnly', 'hybrid']);
  const extensions = registry.getExtensions();
  assert.equal(Array.isArray(extensions), true);
  assert.equal(extensions.length, 6, 'five required slots plus the isolated placeholder compartment are expected');
  const state = EditorState.create({ doc: '# Title', extensions });
  assert.equal(state.facet(EditorState.readOnly), false);
  assert.equal(registry.snapshot.placeholder, 'Write here');
  assert.equal(registry.snapshot.presentationMode, 'source');
  registry.destroy();
});

test('Atomic 5.6 read-only changes are compartment effects with no-op suppression', () => {
  const registry = createCodeMirrorExtensionRegistry();
  const harness = createStateHarness(registry);
  assert.equal(harness.state.facet(EditorState.readOnly), false);
  assert.equal(registry.setReadOnly(true), true);
  assert.equal(harness.state.facet(EditorState.readOnly), true);
  assert.equal(registry.snapshot.readOnly, true);
  assert.equal(registry.setReadOnly(true), false);
  assert.equal(harness.effects.length, 1);
  harness.detach();
  registry.destroy();
});

test('Atomic 5.6 hybrid mode and visual-editing flags share one compartment-owned configuration', () => {
  const registry = createCodeMirrorExtensionRegistry();
  const harness = createStateHarness(registry);
  assert.equal(harness.state.facet(hybridTableVisualEditingFacet), false);
  assert.equal(harness.state.facet(hybridCodeVisualEditingFacet), false);

  assert.equal(registry.setHybridConfiguration({
    presentationMode: 'hybrid',
    tableVisualEditing: true,
    codeVisualEditing: true
  }), true);
  assert.equal(registry.snapshot.presentationMode, 'hybrid');
  assert.equal(harness.state.facet(hybridTableVisualEditingFacet), true);
  assert.equal(harness.state.facet(hybridCodeVisualEditingFacet), true);
  assert.equal(harness.effects.length, 1);

  assert.equal(registry.setPresentationMode('source'), true);
  assert.equal(registry.snapshot.presentationMode, 'source');
  assert.equal(registry.setHybridTableVisualEditing(false), true);
  assert.equal(registry.setHybridCodeVisualEditing(false), true);
  harness.detach();
  registry.destroy();
});

test('Atomic 5.6 theme slot reconfigures through its compartment without exposing a CodeMirror view', () => {
  const themeFacet = Facet.define({ combine: values => values.at(-1) || 'none' });
  const light = themeFacet.of('light');
  const dark = themeFacet.of('dark');
  const registry = createCodeMirrorExtensionRegistry({ themeExtensions: light });
  const harness = createStateHarness(registry);
  assert.equal(harness.state.facet(themeFacet), 'light');
  assert.equal(registry.setThemeExtensions(dark), true);
  assert.equal(harness.state.facet(themeFacet), 'dark');
  assert.equal(registry.snapshot.themeExtensionCount, 1);
  assert.equal(registry.setThemeExtensions(dark), false);
  harness.detach();
  registry.destroy();
});

test('Atomic 5.6 current slot configuration survives document-state recreation without manual reconfigure replay', () => {
  const themeFacet = Facet.define({ combine: values => values.at(-1) || 'none' });
  const dark = themeFacet.of('dark');
  const registry = createCodeMirrorExtensionRegistry({ placeholder: 'Initial' });
  const harness = createStateHarness(registry);
  registry.setPlaceholder('Current placeholder');
  registry.setReadOnly(true);
  registry.setThemeExtensions(dark);
  registry.setHybridConfiguration({
    presentationMode: 'hybrid',
    tableVisualEditing: true,
    codeVisualEditing: true
  });

  const recreated = EditorState.create({
    doc: 'replacement',
    extensions: registry.getExtensions()
  });
  assert.equal(recreated.facet(EditorState.readOnly), true);
  assert.equal(recreated.facet(themeFacet), 'dark');
  assert.equal(recreated.facet(hybridTableVisualEditingFacet), true);
  assert.equal(recreated.facet(hybridCodeVisualEditingFacet), true);
  assert.equal(registry.snapshot.placeholder, 'Current placeholder');
  assert.equal(registry.snapshot.presentationMode, 'hybrid');
  harness.detach();
  registry.destroy();
});

test('Atomic 5.6 failed effect dispatch does not commit registry state', () => {
  const registry = createCodeMirrorExtensionRegistry();
  registry.attach(() => { throw new Error('dispatch failed'); });
  assert.throws(() => registry.setReadOnly(true), /dispatch failed/);
  assert.equal(registry.snapshot.readOnly, false);
  assert.throws(() => registry.attach(() => true), /already attached/i);
  registry.destroy();
});

test('Atomic 5.6 registry destroy is idempotent and makes configuration operations terminal', () => {
  const registry = createCodeMirrorExtensionRegistry();
  const detach = registry.attach(() => true);
  registry.destroy();
  registry.destroy();
  detach();
  assert.throws(() => registry.getExtensions(), /destroyed/i);
  assert.throws(() => registry.setPlaceholder('later'), /destroyed/i);
  assert.throws(() => registry.attach(() => true), /destroyed/i);
});

test('Atomic 5.6 production integration removes extension and Compartment ownership from virtual-editor', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  const virtualEditor = fs.readFileSync(path.join(repositoryRoot, 'src/editor/virtual-editor.js'), 'utf8');
  const registry = fs.readFileSync(path.join(repositoryRoot, 'src/features/editor/infrastructure/codemirror-extension-registry.js'), 'utf8');
  const index = fs.readFileSync(path.join(repositoryRoot, 'src/features/editor/index.js'), 'utf8');

  assert.match(virtualEditor, /createCodeMirrorExtensionRegistry/);
  assert.match(virtualEditor, /extensionRegistry\.attach\(codeMirrorIntegration\.dispatchEffects\)/);
  assert.match(virtualEditor, /extensions:\s*extensionRegistry\.getExtensions\(\)/);
  assert.match(virtualEditor, /extensionRegistry\.destroy\(\)/);
  assert.doesNotMatch(virtualEditor, /@codemirror\//);
  assert.doesNotMatch(virtualEditor, /\bCompartment\b/);
  assert.doesNotMatch(virtualEditor, /\.reconfigure\s*\(/);
  assert.doesNotMatch(virtualEditor, /\b(?:placeholderCompartment|presentationCompartment|hybridConfigurationCompartment|editorExtensions)\b/);
  assert.doesNotMatch(virtualEditor, /let\s+(?:presentationMode|hybridTableVisualEditing|hybridCodeVisualEditing)\b/);

  assert.match(index, /createCodeMirrorExtensionRegistry/);
  assert.equal((registry.match(/new Compartment\(\)/g) || []).length, 6);
  for (const slot of CODEMIRROR_EXTENSION_SLOT_NAMES) {
    assert.match(registry, new RegExp(slot + 'Compartment'));
  }
  assert.match(registry, /EditorState\.readOnly\.of/);
  assert.match(registry, /EditorView\.editable\.of/);
  assert.match(registry, /createHybridMarkdownConfiguration/);
  assert.match(registry, /markdown\(\{ extensions: GFM, addKeymap: false \}\)/);
});
