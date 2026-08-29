import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const expectedRenderers = ['preview-block-view.js','preview-dom-renderer.js','task-list-renderer.js','code-renderer.js','math-renderer.js','mermaid-renderer.js','preview-renderer-port.js'];

test('Atomic 7.8 keeps DOM/block/task/code/math/Mermaid responsibilities split into render modules', async () => {
  const entries = (await readdir(new URL('src/features/preview/render/', root))).sort();
  for (const file of expectedRenderers) assert.ok(entries.includes(file), `missing ${file}`);
  const sources = await Promise.all(expectedRenderers.map(file => source(`src/features/preview/render/${file}`)));
  for (const body of sources) assert.doesNotMatch(body, /window\.|localStorage|sessionStorage|ResizeObserver|IntersectionObserver|getBoundingClientRect|scrollTop|clientWidth|clientHeight|offsetTop|offsetHeight|requestAnimationFrame|markdownEditorScroll|markdownEditorVirtualPreview/);
  for (const file of ['code-renderer.js','math-renderer.js','mermaid-renderer.js']) assert.match(await source(`src/features/preview/render/${file}`), /presentation/);
});

test('Atomic 7.8 composition root owns one shared PreviewRendererPort and destruction', async () => {
  const [main, entry, compatibility] = await Promise.all([
    source('src/main.js'), source('src/features/preview/index.js'),
    source('src/features/preview/compatibility/classic-preview-renderer-port.js')
  ]);
  assert.match(entry, /createPreviewRendererPort/);
  assert.match(entry, /mountClassicPreviewRendererPort/);
  assert.match(main, /createPreviewRendererPort\(\{/);
  assert.match(main, /presentation: markdownPresentation/);
  assert.match(main, /mountClassicPreviewRendererPort\(compatibilityPlatformHost, previewRenderer\)/);
  assert.match(main, /previewRendererPort\?\.destroy\(\)/);
  assert.match(main, /previewRenderer\?\.destroy\(\)/);
  assert.match(compatibility, /markdownEditorPreviewRendererPort/);
});

test('Atomic 7.8 renderer boundary remains intact after Atomic 7.14 RenderEngine replaces classic preview orchestration', async () => {
  const [engine, editorTools] = await Promise.all([
    source('src/features/preview/pipeline/preview-render-engine.js'), source('public/app/editor-tools.js')
  ]);
  for (const call of ['renderer.patchHtml','renderer.patchBlocks','renderer.createBlockNodes','renderer.applyBlockSourceRange']) assert.match(engine, new RegExp(call.replace('.', '\\.')));
  for (const legacy of ['patchPreviewBody','patchIncrementalPreview','createPreviewNodesForBlock','applyPreviewBlockSourceRange','styleTaskLists','enhancePreviewCodeBlocks','renderMathInPreviewNodes','renderMermaidBlocks']) assert.doesNotMatch(engine, new RegExp(`function\\s+${legacy}\\s*\\(`));
  assert.doesNotMatch(editorTools, /function\s+(?:collectMermaidCodeBlocks|reportMermaidFailure|renderMermaidBlocks)\s*\(/);
  const tree = JSON.stringify(await readdir(new URL('src/features/preview/', root), { recursive: true }));
  assert.match(tree, /preview-enhancement-coordinator/);
  assert.match(tree, /preview-render-engine/);
});
