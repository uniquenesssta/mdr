import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readText(path) {
  return readFile(resolve(ROOT, path), 'utf8');
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

function extractSection(markdown, heading) {
  const start = markdown.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `Missing README section: ${heading}`);
  const contentStart = start + heading.length + 1;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  return markdown.slice(contentStart, nextHeading === -1 ? markdown.length : nextHeading);
}

const PUBLIC_MODULE_EXPORTS = Object.freeze({
  'src/app/create-application.js': ['createApplication'],
  'src/app/application-lifecycle.js': ['LIFECYCLE_STATES', 'createApplicationLifecycle'],
  'src/app/disposer-registry.js': ['DISPOSER_REGISTRY_STATES', 'createDisposerRegistry'],
  'src/app/commands/command-ids.js': ['assertCommandId', 'defineCommandIds'],
  'src/app/commands/command-registry.js': [
    'CommandNotRegisteredError',
    'DuplicateCommandRegistrationError',
    'createCommandRegistry'
  ],
  'src/app/commands/command-bus.js': ['createCommandBus'],
  'src/app/events/event-types.js': ['assertEventType', 'defineEventTypes'],
  'src/app/events/event-bus.js': [
    'EventBusDestroyedError',
    'InvalidEventPayloadError',
    'createEventBus'
  ]
});

const MODEL_KERNEL_EXPORTS = Object.freeze([
  'DocumentModel',
  'IncrementalPreviewModel',
  'collectBackslashDisplayMathRanges',
  'collectHybridBlocks',
  'collectInlineMathRanges',
  'collectMathBlocks',
  'collectVisibleLines',
  'containsMarkdownMath',
  'createDocumentModel',
  'createMarkdownSourceProjection',
  'createPreviewDomProjection',
  'createPreviewRangesForSourceSelection',
  'encodeTableCell',
  'getEditableRanges',
  'getExpandedVisibleRanges',
  'getSelectionMappingDiagnostics',
  'intersectsRanges',
  'intersectsRevealRanges',
  'mapPreviewDomPointToSource',
  'mergeRanges',
  'overlapsRanges',
  'parseTableRow',
  'protectMarkdownMathSource',
  'restoreMarkdownMathSource',
  'selectionMappingApi',
  'shouldDecorateSourceActiveLine'
]);

test('README exposes the exact Stage 1 architecture handoff without claiming feature migration', async () => {
  const readme = await readText('README.md');
  assert.equal((readme.match(/^## Stage 1 架构交接$/gm) || []).length, 1);
  const section = extractSection(readme, '## Stage 1 架构交接');

  const requiredStatements = [
    '阶段 1 已完成',
    '阶段 2 尚未开始',
    '67 个生产模块',
    'src/main.js',
    'public/app/*.js',
    'public/i18n.js',
    '9 个经典脚本',
    '184 个内联事件',
    '38 个业务全局写入',
    '4 个跟踪运行产物',
    'npm run verify:architecture',
    'npm run verify:no-legacy-runtime',
    'npm run verify:generated-files',
    'npm run verify:readme-record',
    '不得宣称业务功能已经迁移'
  ];

  for (const statement of requiredStatements) {
    assert.match(section, new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const modulePath of [...Object.keys(PUBLIC_MODULE_EXPORTS), 'src/model-kernel/index.js']) {
    assert.match(section, new RegExp(modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('documented Stage 1 public modules expose the exact handoff surface', async () => {
  for (const [modulePath, expectedExports] of Object.entries(PUBLIC_MODULE_EXPORTS)) {
    const module = await import(pathToFileURL(resolve(ROOT, modulePath)).href);
    assert.deepEqual(Object.keys(module).sort(), [...expectedExports].sort(), modulePath);
  }

  const modelKernel = await import(pathToFileURL(resolve(ROOT, 'src/model-kernel/index.js')).href);
  assert.deepEqual(Object.keys(modelKernel).sort(), [...MODEL_KERNEL_EXPORTS].sort());
});

test('handoff counts and local package verification entries match committed architecture facts', async () => {
  const packageJson = await readJson('package.json');
  const baseline = await readJson('tests/architecture/fixtures/architecture-baseline.json');
  const modules = await readJson('tests/architecture/fixtures/production-modules.json');

  assert.equal(modules.length, 67);
  assert.equal(baseline.legacyClassicScripts.reduce((sum, item) => sum + item.count, 0), 9);
  assert.equal(baseline.inlineEvents.reduce((sum, item) => sum + item.count, 0), 184);
  assert.equal(baseline.businessGlobalWrites.reduce((sum, item) => sum + item.count, 0), 38);
  assert.equal(baseline.trackedGeneratedFiles.length, 4);
  assert.equal(baseline.policy.wildcardExemptions, false);

  assert.deepEqual(
    {
      'verify:architecture': packageJson.scripts['verify:architecture'],
      'verify:no-legacy-runtime': packageJson.scripts['verify:no-legacy-runtime'],
      'verify:generated-files': packageJson.scripts['verify:generated-files'],
      'verify:readme-record': packageJson.scripts['verify:readme-record']
    },
    {
      'verify:architecture': 'node scripts/verify-architecture.mjs',
      'verify:no-legacy-runtime': 'node scripts/verify-no-legacy-runtime.mjs',
      'verify:generated-files': 'node scripts/verify-generated-files.mjs',
      'verify:readme-record': 'node scripts/verify-readme-record.mjs'
    }
  );
});
