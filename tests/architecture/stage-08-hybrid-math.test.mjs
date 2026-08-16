import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

const mathPaths = [
  'src/features/hybrid-editor/widgets/math/inline-math-widget.js',
  'src/features/hybrid-editor/widgets/math/block-math-widget.js'
];

test('Atomic 8.11 creates separate inline and block Math modules and exposes only their factories through the Hybrid Editor public entry', async () => {
  for (const path of mathPaths) await access(file(path));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /from '\.\/widgets\/math\/inline-math-widget\.js'/);
  assert.match(index, /from '\.\/widgets\/math\/block-math-widget\.js'/);
  const module = await import(new URL('../../src/features/hybrid-editor/index.js', import.meta.url));
  assert.equal(typeof module.createInlineMathWidgetType, 'function');
  assert.equal(typeof module.createMathBlockWidgetType, 'function');
});

test('Atomic 8.11 Math feature graph is browser-direct-safe and receives presentation rendering only by injection', async () => {
  const sources = await Promise.all(mathPaths.map(path => text(path)));
  const joined = sources.join('\n');
  assert.doesNotMatch(joined, /from '@codemirror\//);
  assert.doesNotMatch(joined, /from ['"][^'"]*(?:model-kernel|document-model|math-ranges|preview)/);
  assert.doesNotMatch(joined, /window\.|globalThis\.window/);
  assert.match(sources[0], /createInlineMathWidgetType\(WidgetType, options = \{\}\)/);
  assert.match(sources[1], /createMathBlockWidgetType\(WidgetType, options = \{\}\)/);
  assert.match(joined, /typeof options\.renderFormula !== 'function'/);
});

test('Atomic 8.11 keeps inline and block delimiter/source semantics separate while reusing the injected presentation API', async () => {
  const [inline, block] = await Promise.all(mathPaths.map(path => text(path)));
  assert.match(inline, /this\.delimiter = descriptor\.delimiter \|\| '\$'/);
  assert.match(block, /this\.delimiter = descriptor\.delimiter \|\| '\$\$'/);
  assert.match(inline, /editFrom: this\.contentFrom/);
  assert.match(inline, /editTo: this\.contentTo/);
  assert.match(block, /componentType: 'math'/);
  assert.match(block, /editFrom: this\.contentFrom/);
  assert.match(block, /editTo: this\.contentTo/);
  assert.match(inline, /displayMode: false/);
  assert.match(block, /displayMode: true/);
  assert.doesNotMatch(inline + block, /katex|renderMathFormula/);
});

test('Atomic 8.11 Math ownership remains intact through the Atomic 8.14 presentation boundary', async () => {
  const [htmlWidget, controller, inlinePresentation] = await Promise.all([
    text('src/features/hybrid-editor/widgets/html/html-block-widget.js'),
    text('src/editor/hybrid-markdown.js'),
    text('src/features/hybrid-editor/presentation/inline-presentation-coordinator.js')
  ]);
  assert.doesNotMatch(htmlWidget, /class InlineMathWidget|class MathBlockWidget|function renderMathInto|reportMathRenderFailure/);
  assert.doesNotMatch(htmlWidget, /math-presentation\.js/);
  assert.match(controller, /createMathBlockWidgetType/);
  assert.match(controller, /renderMathFormula[\s\S]*math-presentation\.js/);
  assert.match(controller, /const MathBlockWidget = createMathBlockWidgetType\(WidgetType/);
  assert.match(controller, /createInlinePresentationCoordinator\(\{[\s\S]*renderFormula:\s*renderMathFormula/);
  assert.doesNotMatch(controller, /MathBlockWidget,[\s\S]*from '\.\/widgets\.js'/);
  assert.match(inlinePresentation, /createInlineMathWidgetType/);
  assert.match(inlinePresentation, /renderFormula/);
  assert.doesNotMatch(inlinePresentation, /features\/preview\/|renderMathFormula|math-presentation\.js/);
  assert.doesNotMatch(inlinePresentation, /InlineMathWidget[\s\S]*from '\.\/widgets\.js'/);
});

test('Atomic 8.11 gives both Math variants explicit source-action cleanup and block Math shared lifecycle teardown', async () => {
  const [inline, block] = await Promise.all(mathPaths.map(path => text(path)));
  assert.match(inline, /bindWidgetSourceAction/);
  assert.match(inline, /__markdownEditorInlineMathCleanup/);
  assert.match(inline, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(inline, /destroy\(dom\) \{[\s\S]*__markdownEditorInlineMathCleanup/);
  assert.match(block, /bindWidgetSourceAction/);
  assert.match(block, /attachHybridWidgetLifecycle/);
  assert.match(block, /__markdownEditorMathBlockCleanup/);
  assert.match(block, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(block, /destroy\(dom\) \{[\s\S]*__markdownEditorMathBlockCleanup[\s\S]*destroyHybridWidgetLifecycle\(dom\)/);
});

test('Atomic 8.11 Math ownership remains intact after Atomic 8.14 Inline Presentation migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 375);
  const paths = new Set(inventory.modules.map(row => row[0]));
  for (const path of mathPaths) assert.equal(paths.has(path), true, path);
  for (const mermaidPath of [
    'src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-render-state.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-actions.js'
  ]) {
    assert.equal(paths.has(mermaidPath), true, mermaidPath);
    await access(file(mermaidPath));
  }
});
