from pathlib import Path
import json

BASELINE = '69de06a8131d697f9bb62dd7b76fc332d596fe15'

def read(path):
    return Path(path).read_text(encoding='utf-8')

def write(path, content):
    Path(path).write_text(content, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one marker, found {count}: {old[:80]!r}')
    write(path, text.replace(old, new, 1))

# Composition: preserve the exact frozen API reference from model-kernel, but expose it only
# through the existing scoped classic compatibility host instead of window.*.
replace_once(
    'src/main.js',
    "  compatibilityPlatformPort.destroy();\n  void platform.destroy().catch(error => console.warn('Platform cleanup failed:', error));\n}, { once: true });\n\n\nwindow.markdownEditorSelectionMapping = selectionMappingApi;\n",
    "  compatibilityPlatformPort.destroy();\n  if (compatibilityPlatformHost?.markdownEditorSelectionMapping === selectionMappingApi) {\n    delete compatibilityPlatformHost.markdownEditorSelectionMapping;\n  }\n  void platform.destroy().catch(error => console.warn('Platform cleanup failed:', error));\n}, { once: true });\n\nif (compatibilityPlatformHost) compatibilityPlatformHost.markdownEditorSelectionMapping = selectionMappingApi;\n"
)

# Classic compatibility caller consumes the injected frozen capability and owns no algorithm.
replace_once(
    'public/app/scroll-sync.js',
    "    const selectionHighlightSession = scrollSyncCompatibilityHost?.markdownEditorSelectionHighlightSession;\n",
    "    const selectionHighlightSession = scrollSyncCompatibilityHost?.markdownEditorSelectionHighlightSession;\n    const frozenSelectionMapping = scrollSyncCompatibilityHost?.markdownEditorSelectionMapping;\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "    if (!selectionHighlightSession) throw new Error('Selection Highlight Session compatibility capability is unavailable.');\n",
    "    if (!selectionHighlightSession) throw new Error('Selection Highlight Session compatibility capability is unavailable.');\n    if (!frozenSelectionMapping) throw new Error('Frozen Selection Mapping compatibility capability is unavailable.');\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "      const mapping = window.markdownEditorSelectionMapping;\n      if (!mapping?.createPreviewRangesForSourceSelection\n",
    "      if (!frozenSelectionMapping?.createPreviewRangesForSourceSelection\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "        const result = mapping.createPreviewRangesForSourceSelection(\n",
    "        const result = frozenSelectionMapping.createPreviewRangesForSourceSelection(\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "      const mapping = window.markdownEditorSelectionMapping;\n      const anchorRange = getPreviewAnchorSourceRange(anchor);\n      if (!mapping?.mapPreviewDomPointToSource || !anchorRange) return null;\n",
    "      const anchorRange = getPreviewAnchorSourceRange(anchor);\n      if (!frozenSelectionMapping?.mapPreviewDomPointToSource || !anchorRange) return null;\n"
)
replace_once(
    'public/app/scroll-sync.js',
    "      return mapping.mapPreviewDomPointToSource(\n",
    "      return frozenSelectionMapping.mapPreviewDomPointToSource(\n"
)

# Public Sync facade records the completed integration boundary without re-exporting model-kernel.
replace_once(
    'src/features/sync/index.js',
    " * Responsibility: Public Stage 9 synchronization contract. R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07, R9-08 and R9-09 owners remain frozen while R9-10 adds the canonical SelectionRetryScheduler; R9-11+ mapping/final migration remains unmigrated.\n * Imports: Public synchronization modules only.\n * Exports: Scroll owners/mappers/geometry, Selection Readers, Feedback Guard, Highlight Session and the R9-10 Retry Scheduler classes/factories.\n",
    " * Responsibility: Public Stage 9 synchronization contract. R9-01 through R9-10 owners remain frozen; R9-11 integrates frozen selection mapping exclusively through model-kernel composition while R9-12 legacy-measurement removal remains pending.\n * Imports: Public synchronization modules only; frozen model-kernel contracts are injected by composition and are not re-exported here.\n * Exports: Scroll owners/mappers/geometry, Selection Readers, Feedback Guard, Highlight Session and Retry Scheduler classes/factories.\n"
)

# Inventory descriptions only; production cardinality does not change in R9-11.
inventory_path = Path('tests/architecture/fixtures/production-modules.json')
inventory = json.loads(inventory_path.read_text(encoding='utf-8'))
records = {row[0]: row for row in inventory['modules']}
if len(inventory['modules']) != 381:
    raise SystemExit(f'unexpected production inventory count before R9-11: {len(inventory["modules"])}')
records['public/app/scroll-sync.js'][3] = 'Legacy bidirectional selection mapping compatibility and geometry-change producers; R9-11 consumes the frozen mapping only through the scoped model-kernel capability while R9-12 legacy measurement removal remains pending.'
records['src/features/sync/index.js'][3] = 'Public Stage 9 Sync contract exposing completed scroll/selection owners through R9-10; R9-11 frozen selection mapping is composition-injected from model-kernel and is intentionally not duplicated or re-exported.'
records['src/main.js'][3] = 'Production composition root assembling application features and injecting the exact frozen selectionMappingApi from model-kernel into the scoped classic Sync compatibility host without a window mapping global.'
inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

# Architecture baseline: remove the retired global and recompute src/main.js global line locations
# so the baseline describes the candidate exactly rather than weakening global checks.
baseline_path = Path('tests/architecture/fixtures/architecture-baseline.json')
arch = json.loads(baseline_path.read_text(encoding='utf-8'))
removed = 0

def transform(value):
    global removed
    if isinstance(value, list):
        result = []
        for item in value:
            if isinstance(item, dict) and item.get('path') == 'src/main.js' and item.get('global') == 'window.markdownEditorSelectionMapping':
                removed += 1
                continue
            result.append(transform(item))
        return result
    if isinstance(value, dict):
        return {key: transform(item) for key, item in value.items()}
    return value

arch = transform(arch)
if removed != 1:
    raise SystemExit(f'expected exactly one architecture global mapping record, removed {removed}')
main_lines = read('src/main.js').splitlines()

def update_main_global_locations(value):
    if isinstance(value, list):
        for item in value:
            update_main_global_locations(item)
    elif isinstance(value, dict):
        if value.get('path') == 'src/main.js' and isinstance(value.get('global'), str) and 'count' in value and 'lines' in value:
            token = value['global']
            lines = [index + 1 for index, line in enumerate(main_lines) if token in line]
            value['count'] = len(lines)
            value['lines'] = lines
        for item in value.values():
            update_main_global_locations(item)

update_main_global_locations(arch)
baseline_path.write_text(json.dumps(arch, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

behavior = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import * as modelKernel from '../src/model-kernel/index.js';
import * as frozenMapping from '../src/sync/selection-mapping.js';

test('R9-11 model-kernel exposes the exact frozen selectionMappingApi reference', () => {
  assert.equal(modelKernel.selectionMappingApi, frozenMapping.selectionMappingApi);
  assert.equal(Object.isFrozen(modelKernel.selectionMappingApi), true);
});

test('R9-11 model-kernel named selection mapping exports preserve exact frozen function identities', () => {
  for (const name of [
    'createMarkdownSourceProjection',
    'createPreviewDomProjection',
    'createPreviewRangesForSourceSelection',
    'getSelectionMappingDiagnostics',
    'mapPreviewDomPointToSource'
  ]) {
    assert.equal(modelKernel[name], frozenMapping[name], name);
    assert.equal(modelKernel.selectionMappingApi[name], frozenMapping[name], `${name} api identity`);
  }
});

test('R9-11 frozen projection behavior remains available through model-kernel without copied implementation', () => {
  const source = '# Alpha **Beta**\n';
  const projection = modelKernel.createMarkdownSourceProjection(source, 0);
  assert.equal(typeof projection?.text, 'string');
  assert.equal(Array.isArray(projection?.entries), true);
  assert.equal(projection.text.includes('Alpha'), true);
  assert.equal(projection.text.includes('Beta'), true);
});

test('R9-11 frozen mapping diagnostics remain the same model-kernel contract object behavior', () => {
  const direct = frozenMapping.getSelectionMappingDiagnostics();
  const viaKernel = modelKernel.getSelectionMappingDiagnostics();
  assert.deepEqual(viaKernel, direct);
});
'''
write('tests/stage-09-frozen-selection-mapping-integration.test.mjs', behavior)

architecture = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');

test('R9-11 composition obtains frozen mapping only from model-kernel and never imports the frozen implementation directly', async () => {
  const main = await read('src/main.js');
  assert.match(main, /selectionMappingApi\s*\n?\s*}\s*from '\.\/model-kernel\/index\.js'/);
  assert.doesNotMatch(main, /from ['"][^'"]*sync\/selection-mapping\.js['"]/);
});

test('R9-11 mounts the exact frozen model-kernel API on the scoped compatibility host and owns cleanup', async () => {
  const main = await read('src/main.js');
  assert.match(main, /compatibilityPlatformHost\.markdownEditorSelectionMapping = selectionMappingApi/);
  assert.match(main, /compatibilityPlatformHost\?\.markdownEditorSelectionMapping === selectionMappingApi/);
  assert.match(main, /delete compatibilityPlatformHost\.markdownEditorSelectionMapping/);
});

test('R9-11 removes the window selection mapping global from production and architecture baseline', async () => {
  const main = await read('src/main.js');
  const legacy = await read('public/app/scroll-sync.js');
  const baseline = await read('tests/architecture/fixtures/architecture-baseline.json');
  assert.doesNotMatch(main, /window\.markdownEditorSelectionMapping/);
  assert.doesNotMatch(legacy, /window\.markdownEditorSelectionMapping/);
  assert.doesNotMatch(baseline, /window\.markdownEditorSelectionMapping/);
});

test('R9-11 classic selection mapping call sites consume only the injected frozen capability', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /const frozenSelectionMapping = scrollSyncCompatibilityHost\?\.markdownEditorSelectionMapping/);
  assert.match(legacy, /frozenSelectionMapping\.createPreviewRangesForSourceSelection\(/);
  assert.match(legacy, /frozenSelectionMapping\.mapPreviewDomPointToSource\(/);
  assert.doesNotMatch(legacy, /const mapping = window\.|selectionMappingApi/);
});

test('R9-11 production code has no direct import of frozen selection-mapping outside model-kernel', async () => {
  const paths = [
    'src/main.js',
    'src/features/sync/index.js',
    'src/sync/selection-controller.js',
    'public/app/scroll-sync.js'
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.doesNotMatch(source, /from ['"][^'"]*sync\/selection-mapping\.js['"]/, path);
  }
  const kernel = await read('src/model-kernel/index.js');
  assert.match(kernel, /from '\.\.\/sync\/selection-mapping\.js'/);
});

test('R9-11 does not copy frozen mapping algorithms into Sync modules and does not start R9-12', async () => {
  const facade = await read('src/features/sync/index.js');
  const controller = await read('src/sync/selection-controller.js');
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(facade, /R9-11/);
  assert.match(facade, /R9-12/);
  assert.doesNotMatch(facade + controller, /function\s+(createMarkdownSourceProjection|createPreviewDomProjection|createPreviewRangesForSourceSelection|mapPreviewDomPointToSource)\b/);
  assert.match(legacy, /buildNormalizedTextMap/);
  assert.match(legacy, /editor\.value/);
  await access(file('public/app/scroll-sync.js'));
});
'''
write('tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs', architecture)
