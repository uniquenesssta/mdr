import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('application composes one shared presentation namespace into the preview renderer port', async () => {
  const main = await source('../src/main.js');
  const api = await source('../src/rendering/presentation-api.js');
  assert.match(main, /const markdownPresentation\s*=\s*createMarkdownPresentationApi\(\)/);
  assert.match(main, /window\.markdownEditorPresentation\s*=\s*markdownPresentation/);
  assert.match(main, /createPreviewRendererPort\(\{[\s\S]*presentation:\s*markdownPresentation/);
  for (const renderer of ['code', 'math', 'mermaid']) {
    assert.match(api, new RegExp(`\\b${renderer}\\b`));
  }
});

test('hybrid and preview Mermaid rendering use the shared renderer', async () => {
  const widgets = await source('../src/editor/hybrid/widgets.js');
  const previewRenderer = await source('../src/features/preview/render/mermaid-renderer.js');
  const previewTools = await source('../public/app/editor-tools.js');
  const renderer = await source('../src/rendering/mermaid-presentation.js');
  assert.match(widgets, /renderMermaidDiagram/);
  assert.match(previewRenderer, /presentation\?\.mermaid/);
  assert.match(previewRenderer, /mermaid\.renderDiagram/);
  assert.doesNotMatch(previewTools, /renderMermaidBlocks|collectMermaidCodeBlocks|reportMermaidFailure/);
  assert.doesNotMatch(widgets, /mermaidApi\.render|\.mermaid\.render/);
  assert.doesNotMatch(previewRenderer, /mermaidApi\.render/);
  assert.match(renderer, /normalizeMermaidSvg/);
  assert.match(renderer, /renderMermaidDiagram/);
});

test('hybrid preview and export math rendering use the shared math contract', async () => {
  const widgets = await source('../src/editor/hybrid/widgets.js');
  const previewRenderer = await source('../src/features/preview/render/math-renderer.js');
  const preview = await source('../public/app/preview.js');
  const exportSource = await source('../public/app/export.js');
  const math = await source('../src/rendering/math-presentation.js');
  assert.match(widgets, /renderMathFormula/);
  assert.match(previewRenderer, /presentation\?\.math/);
  assert.match(previewRenderer, /math\.renderTree/);
  assert.match(preview, /previewRendererPort\.renderMath/);
  assert.match(exportSource, /markdownEditorPresentation\?\.math/);
  assert.match(math, /MARKDOWN_MATH_DELIMITERS/);
  assert.match(math, /renderMathTree/);
  assert.doesNotMatch(widgets, /katex\.render/);
  const vendor = await source('../src/runtime/vendor.js');
  assert.match(vendor, /window\.katex\s*=\s*katexEngine/);
  assert.match(vendor, /window\.renderMathInElement\s*=\s*autoRenderMathInElement/);
});

test('preview code enhancement delegates to the shared code presentation through Code Renderer', async () => {
  const preview = await source('../public/app/preview.js');
  const codeRenderer = await source('../src/features/preview/render/code-renderer.js');
  assert.match(preview, /previewRendererPort\.renderCode/);
  assert.match(codeRenderer, /presentation\?\.code/);
  assert.match(codeRenderer, /codePresentation\.renderHighlightedCodeRows/);
  assert.doesNotMatch(preview, /markdownEditorCodeHighlighter/);
});
