import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const file = path => new URL(path, root);
const text = path => readFile(file(path), 'utf8');

const imagePaths = [
  'src/features/hybrid-editor/image/image-source-resolver.js',
  'src/features/hybrid-editor/image/image-source-cache.js',
  'src/features/hybrid-editor/widgets/image/image-widget.js',
  'src/features/hybrid-editor/widgets/image/image-error-view.js'
];

test('Atomic 8.10 creates four responsibility-specific Image modules and exposes only cross-boundary capabilities through the public entry', async () => {
  for (const path of imagePaths) await access(file(path));
  const index = await text('src/features/hybrid-editor/index.js');
  assert.match(index, /from '\.\/image\/image-source-resolver\.js'/);
  assert.match(index, /from '\.\/widgets\/image\/image-widget\.js'/);
  assert.doesNotMatch(index, /image-source-cache|image-error-view|createImageLoadVersionGuard/);
  const module = await import(new URL('../../src/features/hybrid-editor/index.js', import.meta.url));
  for (const name of [
    'configureHybridImageSourcePlatform',
    'invalidateHybridImageSource',
    'resolveHybridImageSource',
    'createImageBlockWidgetType'
  ]) assert.equal(typeof module[name], 'function', name);
});

test('Atomic 8.10 Image feature graph is browser-direct-safe and has no hidden application or frozen-model dependency', async () => {
  const sources = await Promise.all(imagePaths.map(path => text(path)));
  const joined = sources.join('\n');
  assert.doesNotMatch(joined, /from '@codemirror\//);
  assert.doesNotMatch(joined, /from ['"][^'"]*(?:model-kernel|document-model|table-model)/);
  assert.doesNotMatch(joined, /window\.|globalThis\.window|markdownEditorRuntimeContext/);
  assert.match(await text(imagePaths[2]), /createImageBlockWidgetType\(WidgetType, options = \{\}\)/);
});

test('Atomic 8.10 separates path resolution, cache state, failure/retry presentation and widget lifecycle', async () => {
  const [resolver, cache, widget, errorView] = await Promise.all(imagePaths.map(path => text(path)));
  assert.match(resolver, /configureHybridImageSourcePlatform/);
  assert.match(resolver, /platformFiles\.readImage/);
  assert.match(resolver, /getHybridImageSourceCacheEntry/);
  assert.doesNotMatch(resolver, /document\.|createElement|cm-hybrid-image/);
  assert.match(cache, /const imageSourceCache = new Map\(\)/);
  assert.match(cache, /MAX_CACHE_CHARACTERS/);
  assert.doesNotMatch(cache, /readImage|documentId|filePath|createElement/);
  assert.match(errorView, /createImageErrorView/);
  assert.match(errorView, /cm-hybrid-image-retry/);
  assert.doesNotMatch(errorView, /resolveHybridImageSource|invalidateHybridImageSource|attachHybridWidgetLifecycle/);
  assert.match(widget, /createImageErrorView/);
  assert.match(widget, /attachHybridWidgetLifecycle/);
  assert.match(widget, /__markdownEditorImageBlockCleanup/);
  assert.match(widget, /createImageLoadVersionGuard/);
});

test('Atomic 8.10 async image completion validates the current component version before DOM publication', async () => {
  const widget = await text(imagePaths[2]);
  assert.match(widget, /const version = loadVersion\.begin\(\)/);
  assert.ok((widget.match(/loadVersion\.isCurrent\(version\)/g) || []).length >= 4);
  assert.match(widget, /loadVersion\.destroy\(\)/);
  assert.match(widget, /clearActiveImage\(\)/);
  assert.match(widget, /removeEventListener\('load'/);
  assert.match(widget, /removeEventListener\('error'/);
});

test('Atomic 8.10 removes legacy Image authority and composes platform plus WidgetType only through the Hybrid Editor public entry', async () => {
  const [main, controller, widgets] = await Promise.all([
    text('src/main.js'), text('src/editor/hybrid/controller.js'), text('src/editor/hybrid/widgets.js')
  ]);
  await assert.rejects(access(file('src/editor/hybrid/image-source.js')));
  assert.doesNotMatch(widgets, /class ImageBlockWidget|resolveHybridImageSource|invalidateHybridImageSource|cm-hybrid-image-error/);
  assert.match(main, /configureHybridImageSourcePlatform[\s\S]*from '\.\/features\/hybrid-editor\/index\.js'/);
  assert.doesNotMatch(main, /editor\/hybrid\/image-source\.js/);
  assert.match(main, /getDocumentContext:\s*\(\) => window\.markdownEditorRuntimeContext/);
  assert.match(controller, /createImageBlockWidgetType/);
  assert.match(controller, /const ImageBlockWidget = createImageBlockWidgetType\(WidgetType\)/);
  assert.doesNotMatch(controller, /ImageBlockWidget,[\s\S]*from '\.\/widgets\.js'/);
});

test('Atomic 8.10 Image ownership remains intact after Atomic 8.12 Mermaid migration', async () => {
  const inventory = JSON.parse(await text('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 363);
  const paths = new Set(inventory.modules.map(row => row[0]));
  for (const path of imagePaths) assert.equal(paths.has(path), true, path);
  assert.equal(paths.has('src/editor/hybrid/image-source.js'), false);
  for (const mathPath of [
    'src/features/hybrid-editor/widgets/math/inline-math-widget.js',
    'src/features/hybrid-editor/widgets/math/block-math-widget.js'
  ]) assert.equal(paths.has(mathPath), true, mathPath);
  for (const mermaidPath of [
    'src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-render-state.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-actions.js'
  ]) {
    assert.equal(paths.has(mermaidPath), true, mermaidPath);
    await access(file(mermaidPath));
  }
});
