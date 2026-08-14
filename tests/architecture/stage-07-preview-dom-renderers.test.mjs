import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

const expectedRenderers = [
  'preview-block-view.js',
  'preview-dom-renderer.js',
  'task-list-renderer.js',
  'code-renderer.js',
  'math-renderer.js',
  'mermaid-renderer.js',
  'preview-renderer-port.js'
];

test('Atomic 7.8 splits DOM/block/task/code/math/Mermaid preview responsibilities into render modules', async () => {
  const entries = (await readdir(new URL('src/features/preview/render/', root))).sort();
  for (const file of expectedRenderers) assert.ok(entries.includes(file), `missing ${file}`);
  const sources = await Promise.all(expectedRenderers.map(file => source(`src/features/preview/render/${file}`)));
  for (const body of sources) {
    assert.doesNotMatch(body, /window\.|localStorage|sessionStorage|ResizeObserver|IntersectionObserver|getBoundingClientRect|scrollTop|clientWidth|clientHeight|offsetTop|offsetHeight|requestAnimationFrame|markdownEditorScroll|markdownEditorVirtualPreview/);
  }
  for (const file of ['code-renderer.js', 'math-renderer.js', 'mermaid-renderer.js']) {
    assert.match(await source(`src/features/preview/render/${file}`), /presentation/);
  }
});

test('Atomic 7.8 composition root mounts one shared PreviewRendererPort and owns destruction', async () => {
  const main = await source('src/main.js');
  const entry = await source('src/features/preview/index.js');
  const compatibility = await source('src/features/preview/compatibility/classic-preview-renderer-port.js');
  assert.match(entry, /createPreviewRendererPort/);
  assert.match(entry, /mountClassicPreviewRendererPort/);
  assert.match(main, /createPreviewRendererPort\(\{/);
  assert.match(main, /presentation: markdownPresentation/);
  assert.match(main, /mountClassicPreviewRendererPort\(compatibilityPlatformHost, previewRenderer\)/);
  assert.match(main, /previewRendererPort\?\.destroy\(\)/);
  assert.match(main, /previewRenderer\?\.destroy\(\)/);
  assert.match(compatibility, /markdownEditorPreviewRendererPort/);
});

test('Atomic 7.8 renderer boundary remains intact while Atomic 7.9-7.11 add layout, virtual-window and focus owners', async () => {
  const preview = await source('public/app/preview.js');
  const editorTools = await source('public/app/editor-tools.js');
  assert.match(preview, /markdownEditorPreviewRendererPort/);
  for (const legacy of [
    'patchPreviewBody','patchIncrementalPreview','createPreviewNodesForBlock','applyPreviewBlockSourceRange',
    'styleTaskLists','enhancePreviewCodeBlocks','renderMathInPreviewNodes','renderMermaidBlocks'
  ]) assert.doesNotMatch(preview, new RegExp(`function\\s+${legacy}\\s*\\(`));
  assert.doesNotMatch(editorTools, /function\s+(?:collectMermaidCodeBlocks|reportMermaidFailure|renderMermaidBlocks)\s*\(/);

  const featureRoot = new URL('src/features/preview/', root);
  const entries = await readdir(featureRoot, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    paths.push(entry.name);
    if (!entry.isDirectory()) continue;
    for (const child of await readdir(new URL(`${entry.name}/`, featureRoot))) paths.push(`${entry.name}/${child}`);
  }
  const tree = paths.join('\n');
  assert.doesNotMatch(tree, /preview-enhancement-coordinator/);
});
