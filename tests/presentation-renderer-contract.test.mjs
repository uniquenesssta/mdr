import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('application composes one canonical presentation API into Preview without publishing presentation globals', async () => {
  const main = await source('../src/main.js');
  const api = await source('../src/features/preview/render/presentation/presentation-api.js');
  const port = await source('../src/features/preview/compatibility/classic-preview-presentation-port.js');
  assert.match(main, /const markdownPresentation\s*=\s*createMarkdownPresentationApi\(\)/);
  assert.match(main, /createPreviewRendererPort\(\{[\s\S]*presentation:\s*markdownPresentation/);
  assert.match(main, /mountClassicPreviewPresentationPort\(compatibilityPlatformHost, markdownPresentation/);
  assert.doesNotMatch(main, /window\.markdownEditorPresentation\s*=|window\.markdownEditorMath\s*=|window\.markdownEditorCodeHighlighter\s*=/);
  assert.match(port, /markdownEditorPresentationPort/);
  for (const renderer of ['code', 'math', 'mermaid']) {
    assert.match(api, new RegExp(`\\b${renderer}\\b`));
  }
});

test('hybrid and Preview Mermaid rendering use the canonical Preview presentation renderer', async () => {
  const widgets = await source('../src/editor/hybrid/widgets.js');
  const previewRenderer = await source('../src/features/preview/render/mermaid-renderer.js');
  const previewController = await source('../src/features/preview/application/preview-controller.js');
  const previewTools = await source('../public/app/editor-tools.js');
  const renderer = await source('../src/features/preview/render/presentation/mermaid-presentation.js');
  assert.match(widgets, /features\/preview\/render\/presentation\/mermaid-presentation\.js/);
  assert.match(widgets, /renderMermaidDiagram/);
  assert.match(previewRenderer, /presentation\?\.mermaid/);
  assert.match(previewRenderer, /mermaid\.renderDiagram/);
  assert.match(previewController, /renderer\.renderMermaid/);
  assert.doesNotMatch(previewTools, /renderMermaidBlocks|collectMermaidCodeBlocks|reportMermaidFailure/);
  assert.doesNotMatch(widgets, /mermaidApi\.render|\.mermaid\.render/);
  assert.doesNotMatch(previewRenderer, /mermaidApi\.render/);
  assert.match(renderer, /normalizeMermaidSvg/);
  assert.match(renderer, /renderMermaidDiagram/);
  assert.doesNotMatch(renderer, /window\.__markdownEditorMermaidTheme/);
});

test('hybrid Preview and export math rendering use the canonical math presentation contract without vendor globals', async () => {
  const widgets = await source('../src/editor/hybrid/widgets.js');
  const previewRenderer = await source('../src/features/preview/render/math-renderer.js');
  const previewController = await source('../src/features/preview/application/preview-controller.js');
  const exportSource = await source('../public/app/export.js');
  const math = await source('../src/features/preview/render/presentation/math-presentation.js');
  assert.match(widgets, /features\/preview\/render\/presentation\/math-presentation\.js/);
  assert.match(widgets, /renderMathFormula/);
  assert.match(previewRenderer, /presentation\?\.math/);
  assert.match(previewRenderer, /math\.renderTree/);
  assert.match(previewController, /renderer\.renderMath/);
  assert.match(exportSource, /exportPresentationPort\.math/);
  assert.match(math, /MARKDOWN_MATH_DELIMITERS/);
  assert.match(math, /renderMathTree/);
  assert.doesNotMatch(widgets, /katex\.render/);
  assert.doesNotMatch(math, /window\.katex|window\.renderMathInElement|window\.markdownEditorMath/);
});

test('Preview code enhancement delegates to the shared code presentation through Code Renderer', async () => {
  const controller = await source('../src/features/preview/application/preview-controller.js');
  const codeRenderer = await source('../src/features/preview/render/code-renderer.js');
  assert.match(controller, /renderer\.renderCode/);
  assert.match(codeRenderer, /presentation\?\.code/);
  assert.match(codeRenderer, /codePresentation\.renderHighlightedCodeRows/);
  assert.doesNotMatch(controller, /markdownEditorCodeHighlighter/);
});
