import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

const targetPaths = [
  'src/features/hybrid-editor/code/code-highlighter.js',
  'src/features/hybrid-editor/code/code-presentation.js',
  'src/features/hybrid-editor/widgets/code-block/code-block-widget.js',
  'src/features/hybrid-editor/widgets/code-block/code-block-view.js',
  'src/features/hybrid-editor/widgets/code-block/code-block-direct-editor.js',
  'src/features/hybrid-editor/widgets/code-block/code-block-actions.js'
];

test('Atomic 8.8 creates all six responsibility-specific Code Block modules and exposes only cross-boundary capabilities through the public entry', async () => {
  for (const path of targetPaths) await access(file(path));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /from '\.\/code\/code-highlighter\.js'/);
  assert.match(index, /from '\.\/code\/code-presentation\.js'/);
  assert.match(index, /from '\.\/widgets\/code-block\/code-block-direct-editor\.js'/);
  assert.match(index, /from '\.\/widgets\/code-block\/code-block-widget\.js'/);
  const module = await import(new URL('../../src/features/hybrid-editor/index.js', import.meta.url));
  for (const name of ['highlightCode', 'getNormalizedCodeLanguage', 'renderHighlightedCodeRows', 'createCodeBlockDirectEditor', 'createCodeBlockWidgetType']) {
    assert.equal(typeof module[name], 'function', name);
  }
});

test('Atomic 8.8 Code Block feature graph stays browser-direct-safe and owns no application globals or frozen model imports', async () => {
  const sources = await Promise.all(targetPaths.map(path => text(path)));
  const joined = sources.join('\n');
  assert.doesNotMatch(joined, /from '@codemirror\//);
  assert.doesNotMatch(joined, /window\.|globalThis\.window/);
  assert.doesNotMatch(joined, /from ['"][^'"]*(?:model-kernel|document-model|table-model)/);
  assert.match(await text(targetPaths[2]), /createCodeBlockWidgetType\(WidgetType, options = \{\}\)/);
});

test('Atomic 8.8 separates view, direct-edit fence/writeback, actions and widget lifecycle responsibilities', async () => {
  const [widget, view, editor, actions] = await Promise.all([
    text(targetPaths[2]), text(targetPaths[3]), text(targetPaths[4]), text(targetPaths[5])
  ]);
  assert.match(view, /createCodeBlockPresentationBody/);
  assert.match(view, /resolveCodePointerOffset/);
  assert.doesNotMatch(view, /view\.dispatch|clipboard|transitionHybridComponent|bindOutsidePointerClosure/);
  assert.match(editor, /buildCodeBlockWriteback/);
  assert.equal((editor.match(/view\.dispatch\(/g) || []).length, 1);
  assert.match(editor, /event\.key === 'Escape'/);
  assert.match(editor, /__markdownEditorDestroyCodeBlock/);
  assert.doesNotMatch(editor, /createWidgetToolbar|renderHighlightedCodeRows|openWidgetSource/);
  assert.match(actions, /copyCodeBlockText/);
  assert.match(actions, /createCodeBlockToolbar/);
  assert.doesNotMatch(actions, /view\.dispatch|transitionHybridComponent|registerHybridComponentCloser/);
  assert.match(widget, /transitionHybridComponent/);
  assert.match(widget, /registerHybridComponentCloser/);
  assert.match(widget, /bindWidgetSourceAction/);
  assert.match(widget, /attachHybridWidgetLifecycle/);
  assert.doesNotMatch(widget, /function buildCodeBlockWriteback|navigator\.clipboard|renderHighlightedCodeRows/);
});

test('Atomic 8.8 keeps Code Block authority migrated and composes CodeMirror capabilities only in the final editor facade', async () => {
  const [widgets, facade] = await Promise.all([
    text('src/features/hybrid-editor/widgets/html/html-block-widget.js'), text('src/editor/hybrid-markdown.js')
  ]);
  assert.doesNotMatch(widgets, /class CodeBlockWidget|function buildCodeBlockWriteback|function createEditableCodeArea|resolveCodePointerOffset|createCodePresentationBody/);
  assert.doesNotMatch(widgets, /createCodeBlockDirectEditor|reportLegacyFencedEditorFailure/);
  const mermaidWidget = await text('src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js');
  assert.match(mermaidWidget, /createCodeBlockDirectEditor/);
  assert.match(facade, /createCodeBlockWidgetType/);
  assert.match(facade, /const CodeBlockWidget = createCodeBlockWidgetType\(WidgetType/);
  assert.match(facade, /createHistoryAnnotation: \(\) => isolateHistory\.of\('full'\)/);
  assert.match(facade, /from '\.\.\/features\/hybrid-editor\/index\.js'/);
  assert.doesNotMatch(facade, /features\/hybrid-editor\/widgets\/code-block\//);
  await assert.rejects(access(file('src/editor/hybrid/controller.js')));
  await assert.rejects(access(file('src/editor/hybrid/code-highlighter.js')));
  await assert.rejects(access(file('src/editor/hybrid/code-presentation.js')));
});

test('Atomic 8.8 keeps Preview on the public code presentation and gives migrated Mermaid one canonical fenced direct-editor implementation', async () => {
  const [previewApi, mermaidWidget] = await Promise.all([
    text('src/features/preview/render/presentation/presentation-api.js'),
    text('src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js')
  ]);
  assert.match(previewApi, /from '\.\.\/\.\.\/\.\.\/hybrid-editor\/index\.js'/);
  assert.doesNotMatch(previewApi, /editor\/hybrid\/code-(?:highlighter|presentation)/);
  assert.match(mermaidWidget, /from '\.\.\/code-block\/code-block-direct-editor\.js'/);
  assert.doesNotMatch(mermaidWidget, /editor\/hybrid\/code-(?:highlighter|presentation)/);
});

test('Atomic 8.8 Code Block ownership remains intact after Atomic 8.9 Table migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 379);
  const paths = new Set(inventory.modules.map(row => row[0]));
  for (const path of targetPaths) assert.equal(paths.has(path), true, path);
  assert.equal(paths.has('src/editor/hybrid/code-highlighter.js'), false);
  assert.equal(paths.has('src/editor/hybrid/code-presentation.js'), false);
  assert.equal(paths.has('src/features/hybrid-editor/widgets/table/table-widget.js'), true);
});
