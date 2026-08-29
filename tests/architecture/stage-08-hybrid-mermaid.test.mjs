import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

const mermaidPaths = [
  'src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js',
  'src/features/hybrid-editor/widgets/mermaid/mermaid-render-state.js',
  'src/features/hybrid-editor/widgets/mermaid/mermaid-actions.js'
];

test('Atomic 8.12 creates widget, render-state and actions Mermaid modules and exposes only the WidgetType factory through the public entry', async () => {
  for (const path of mermaidPaths) await access(file(path));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /from '\.\/widgets\/mermaid\/mermaid-widget\.js'/);
  assert.doesNotMatch(index, /mermaid-render-state\.js|mermaid-actions\.js/);
  const module = await import(new URL('../../src/features/hybrid-editor/index.js', import.meta.url));
  assert.equal(typeof module.createMermaidBlockWidgetType, 'function');
  assert.equal('createMermaidRenderState' in module, false);
  assert.equal('copyMermaidSource' in module, false);
});

test('Atomic 8.12 Mermaid feature graph is browser-direct-safe and receives Preview and CodeMirror capabilities only by injection', async () => {
  const sources = await Promise.all(mermaidPaths.map(path => text(path)));
  const joined = sources.join('\n');
  assert.doesNotMatch(joined, /from '@codemirror\//);
  assert.doesNotMatch(joined, /from ['"][^'"]*(?:model-kernel|document-model|table-model|features\/preview)/);
  assert.doesNotMatch(joined, /window\.|globalThis\.window/);
  assert.match(sources[0], /createMermaidBlockWidgetType\(WidgetType, options = \{\}\)/);
  assert.match(sources[0], /typeof options\.renderDiagram !== 'function'/);
  assert.match(sources[0], /typeof options\.getTheme !== 'function'/);
});

test('Atomic 8.12 render state owns source-theme-position identity and stale async publication guards while the canonical renderer contributes the cache key', async () => {
  const [widget, state, renderer] = await Promise.all([
    text(mermaidPaths[0]),
    text(mermaidPaths[1]),
    text('src/features/preview/render/presentation/mermaid-presentation.js')
  ]);
  assert.match(state, /createMermaidRenderIdentity\(source, theme, sourceFrom\)/);
  assert.match(state, /serial \+= 1/);
  assert.match(state, /request\.identity === currentIdentity/);
  assert.match(state, /commit\(request, publish\)/);
  assert.match(state, /destroyed = true/);
  assert.match(widget, /const request = renderState\.begin\(sourceText, theme\)/);
  assert.match(widget, /renderState\.commit\(request, \(\) => \{/);
  assert.match(widget, /isCancelled: \(\) => !renderState\.isCurrent\(request\) \|\| !container\.isConnected/);
  assert.match(widget, /cacheKey: request\.cacheKey/);
  assert.match(renderer, /const cacheKey = options\.cacheKey \? `\$\{theme\}\\0\$\{options\.cacheKey\}\\0\$\{sourceText\}` : ''/);
});

test('Atomic 8.12 separates Mermaid actions from render state and widget orchestration', async () => {
  const [widget, state, actions] = await Promise.all(mermaidPaths.map(path => text(path)));
  assert.match(actions, /copyMermaidSource/);
  assert.match(actions, /createMermaidToolbar/);
  assert.match(actions, /createWidgetActionGroup/);
  assert.doesNotMatch(actions, /renderDiagram|createMermaidRenderState|transitionHybridComponent|view\.dispatch/);
  assert.doesNotMatch(state, /document\.|Element|createWidgetToolbar|renderDiagram|transitionHybridComponent/);
  assert.match(widget, /createMermaidToolbar/);
  assert.match(widget, /createMermaidRenderState/);
  assert.match(widget, /createCodeBlockDirectEditor/);
  assert.match(widget, /bindStrictDoubleActivation/);
  assert.doesNotMatch(widget, /navigator\.clipboard|document\.execCommand|function copyMermaidSource/);
});

test('Atomic 8.12 removes legacy Mermaid authority and composes Preview presentation plus WidgetType only at the editor integration boundary', async () => {
  const [widgets, controller] = await Promise.all([
    text('src/features/hybrid-editor/widgets/html/html-block-widget.js'),
    text('src/editor/hybrid-markdown.js')
  ]);
  assert.doesNotMatch(widgets, /class MermaidBlockWidget|renderHybridMermaid|reportMermaidRenderFailure|createMermaidStatus/);
  assert.doesNotMatch(widgets, /mermaid-presentation\.js|renderMermaidDiagram|getMermaidTheme/);
  assert.match(controller, /createMermaidBlockWidgetType/);
  assert.match(controller, /renderMermaidDiagram[\s\S]*mermaid-presentation\.js/);
  assert.match(controller, /getMermaidTheme/);
  assert.match(controller, /const MermaidBlockWidget = createMermaidBlockWidgetType\(WidgetType/);
  assert.doesNotMatch(controller, /import\s*\{[^}]*MermaidBlockWidget[^}]*\}\s*from '\.\/widgets\.js'/);
});

test('Atomic 8.12 Mermaid ownership remains intact after Atomic 8.13 HTML migration', async () => {
  const widget = await text(mermaidPaths[0]);
  assert.match(widget, /__markdownEditorMermaidBlockCleanup/);
  assert.match(widget, /if \(cleaned\) return;\s*cleaned = true;/);
  assert.match(widget, /renderState\.destroy\(\)/);
  assert.match(widget, /themeObserver\?\.disconnect\(\)/);
  assert.match(widget, /__markdownEditorDestroyCodeBlock/);
  assert.match(widget, /destroy\(dom\) \{[\s\S]*__markdownEditorMermaidBlockCleanup[\s\S]*destroyHybridWidgetLifecycle\(dom\)/);
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 381);
  const paths = new Set(inventory.modules.map(row => row[0]));
  for (const path of mermaidPaths) assert.equal(paths.has(path), true, path);
  for (const htmlPath of [
    'src/features/hybrid-editor/widgets/html/html-block-widget.js',
    'src/features/hybrid-editor/widgets/html/html-block-view.js'
  ]) {
    assert.equal(paths.has(htmlPath), true, htmlPath);
    await access(file(htmlPath));
  }
});
