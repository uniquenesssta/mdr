import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('application exposes one shared presentation namespace', async () => {
  const main = await source('../src/main.js');
  const api = await source('../src/rendering/presentation-api.js');
  assert.match(main, /window\.markdownEditorPresentation\s*=\s*createMarkdownPresentationApi\(\)/);
  for (const renderer of ['code', 'math', 'mermaid']) {
    assert.match(api, new RegExp(`\\b${renderer}\\b`));
  }
});

test('hybrid and preview Mermaid rendering use the shared renderer', async () => {
  const widgets = await source('../src/editor/hybrid/widgets.js');
  const previewTools = await source('../public/app/editor-tools.js');
  const renderer = await source('../src/rendering/mermaid-presentation.js');
  assert.match(widgets, /renderMermaidDiagram/);
  assert.match(previewTools, /markdownEditorPresentation\?\.mermaid/);
  assert.match(previewTools, /presentation\.renderDiagram/);
  assert.doesNotMatch(widgets, /mermaidApi\.render|\.mermaid\.render/);
  assert.doesNotMatch(previewTools, /mermaidApi\.render/);
  assert.match(renderer, /normalizeMermaidSvg/);
  assert.match(renderer, /renderMermaidDiagram/);
});

test('hybrid preview and export math rendering use the shared math contract', async () => {
  const widgets = await source('../src/editor/hybrid/widgets.js');
  const preview = await source('../public/app/preview.js');
  const exportSource = await source('../public/app/export.js');
  const math = await source('../src/rendering/math-presentation.js');
  assert.match(widgets, /renderMathFormula/);
  assert.match(preview, /markdownEditorPresentation\?\.math/);
  assert.match(exportSource, /markdownEditorPresentation\?\.math/);
  assert.match(math, /MARKDOWN_MATH_DELIMITERS/);
  assert.match(math, /renderMathTree/);
  assert.doesNotMatch(widgets, /katex\.render/);
  const vendor = await source('../src/runtime/vendor.js');
  assert.match(vendor, /window\.katex\s*=\s*katexEngine/);
  assert.match(vendor, /window\.renderMathInElement\s*=\s*autoRenderMathInElement/);
});

test('preview code enhancement resolves the shared code renderer first', async () => {
  const preview = await source('../public/app/preview.js');
  assert.match(preview, /markdownEditorPresentation\?\.code\s*\|\|\s*window\.markdownEditorCodeHighlighter/);
});
