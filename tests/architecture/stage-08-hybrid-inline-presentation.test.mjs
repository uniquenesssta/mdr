
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

const PRESENTATION_FILES = [
  'src/features/hybrid-editor/presentation/inline-presentation-coordinator.js',
  'src/features/hybrid-editor/presentation/heading-presentation.js',
  'src/features/hybrid-editor/presentation/list-presentation.js',
  'src/features/hybrid-editor/presentation/quote-presentation.js',
  'src/features/hybrid-editor/presentation/inline-format-presentation.js',
  'src/features/hybrid-editor/presentation/link-presentation.js',
  'src/features/hybrid-editor/presentation/html-inline-presentation.js'
];

test('Atomic 8.14 creates seven presentation owners and removes the legacy 900-line aggregate', async () => {
  for (const path of PRESENTATION_FILES) await access(file(path));
  await assert.rejects(access(file('src/editor/hybrid/inline-presentation.js')));
  for (const path of PRESENTATION_FILES) {
    const lines = (await read(path)).split(/\r?\n/).length;
    assert.ok(lines < 500, `${path} must stay below 500 lines, got ${lines}`);
  }
});

test('Atomic 8.14 presentation graph has no CodeMirror, Marked, Preview, model-kernel or application-global imports', async () => {
  const sources = await Promise.all(PRESENTATION_FILES.map(read));
  const graph = sources.join('\n');
  assert.doesNotMatch(graph, /from ['"]@codemirror\//);
  assert.doesNotMatch(graph, /from ['"]marked['"]/);
  assert.doesNotMatch(graph, /features\/preview\/|model-kernel/);
  assert.doesNotMatch(graph, /globalThis\.window|\bwindow\./);
  assert.match(await read(PRESENTATION_FILES[0]), /requireFunction\('collectVisibleLines'/);
});

test('Atomic 8.14 Hybrid public entry exposes only the coordinator across the presentation boundary', async () => {
  const index = await read('src/features/hybrid-editor/index.js');
  assert.match(index, /createInlinePresentationCoordinator/);
  for (const internal of [
    'applyAtxHeadingLine',
    'applyListLinePresentation',
    'parseQuotePrefix',
    'applyFallbackInlinePresentation',
    'normalizeReferenceLabel',
    'parseInlineHtmlTag'
  ]) {
    assert.doesNotMatch(index, new RegExp(`\\b${internal}\\b`));
  }
});

test('Atomic 8.14 controller is the sole editor integration boundary for inline presentation capabilities', async () => {
  const controller = await read('src/editor/hybrid-markdown.js');
  assert.doesNotMatch(controller, /\.\/inline-presentation\.js/);
  assert.match(controller, /createInlinePresentationCoordinator\(\{/);
  assert.match(controller, /Decoration,[\s\S]*WidgetType,[\s\S]*marked\.Lexer\.lexInline/);
  assert.match(controller, /renderFormula:\s*renderMathFormula/);
  for (const capability of [
    'collectInlineMathRanges',
    'collectVisibleLines',
    'intersectsRanges',
    'intersectsRevealRanges',
    'overlapsRanges',
    'shouldDecorateSourceActiveLine'
  ]) assert.match(controller, new RegExp(`\\b${capability}\\b`));
});

test('Atomic 8.14 leaf files retain one named presentation responsibility each', async () => {
  const heading = await read(PRESENTATION_FILES[1]);
  const list = await read(PRESENTATION_FILES[2]);
  const quote = await read(PRESENTATION_FILES[3]);
  const format = await read(PRESENTATION_FILES[4]);
  const link = await read(PRESENTATION_FILES[5]);
  const html = await read(PRESENTATION_FILES[6]);
  assert.match(heading, /applyAtxHeadingLine|applySetextHeadingNode/);
  assert.match(list, /applyListLinePresentation/);
  assert.match(quote, /parseQuotePrefix|applyQuoteLinePresentation/);
  assert.match(format, /applyFallbackInlinePresentation|applyInlineTreeNode/);
  assert.match(link, /collectReferenceDefinitions|applyLinkPresentation/);
  assert.match(html, /applyHtmlInlinePresentation|parseInlineHtmlTag/);
  assert.doesNotMatch(heading + list + quote, /parseInlineHtmlTag|collectReferenceDefinitions/);
  assert.doesNotMatch(link + html, /TaskCheckboxWidget|HybridPrefixWidget/);
});

test('Atomic 8.14 production inventory replaces one aggregate with seven presentation records', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const paths = new Set(inventory.modules.map(record => record[0]));
  assert.equal(inventory.modules.length, 380);
  assert.equal(paths.has('src/editor/hybrid/inline-presentation.js'), false);
  for (const path of PRESENTATION_FILES) assert.equal(paths.has(path), true, path);
});

test('Atomic 8.14 presentation ownership remains intact after the Stage 8.15 final controller deletion', async () => {
  await assert.rejects(access(file('src/editor/hybrid/controller.js')));
  await access(file('src/editor/hybrid-markdown.js'));
  await access(file('src/features/hybrid-editor/application/hybrid-decoration-coordinator.js'));
  await access(file('src/features/hybrid-editor/application/hybrid-editor-controller.js'));
});
