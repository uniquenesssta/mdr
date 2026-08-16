import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readText(path) {
  return (await readFile(resolve(ROOT, path), 'utf8')).replace(/\r\n?/g, '\n');
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
  'src/app/lifecycle/application-lifecycle.js': ['LIFECYCLE_STATES', 'createApplicationLifecycle'],
  'src/app/lifecycle/disposer-registry.js': ['DISPOSER_REGISTRY_STATES', 'createDisposerRegistry'],
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
  const readme = await readText('docs/README.md');
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

  for (const modulePath of [
    'src/app/lifecycle/startup-sequence.js',
    'src/app/lifecycle/shutdown-sequence.js'
  ]) {
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

test('Stage 1 historical counts and current package verification entries remain explicit', async () => {
  const packageJson = await readJson('package.json');
  const baseline = await readJson('tests/architecture/fixtures/architecture-baseline.json');
  const moduleFixture = await readJson('tests/architecture/fixtures/production-modules.json');

  assert.equal(moduleFixture.modules.length, 378);
  const readme = await readText('docs/README.md');
  assert.match(extractSection(readme, '## Stage 1 架构交接'), /67 个生产模块/);
  assert.equal(baseline.legacyClassicScripts.reduce((sum, item) => sum + item.count, 0), 7);
  assert.equal(baseline.inlineEvents.reduce((sum, item) => sum + item.count, 0), 43);
  assert.equal(baseline.businessGlobalWrites.reduce((sum, item) => sum + item.count, 0), 13);
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
test('Stage 1 completion record is grounded in verified artifacts', async () => {
  const readme = await readText('docs/README.md');
  assert.equal((readme.match(/<!-- stage-01-node:01-10 -->/g) || []).length, 1);
  assert.match(readme, /30986994815/);
  assert.match(readme, /30986994863/);
  assert.match(readme, /阶段 1 已完成，阶段 2 尚未开始/);

  const record = await readText('docs/rewrite-progress/stage-01/01-10-stage-01-handoff.md');
  for (const statement of [
    '结果：**通过**',
    '阶段 1 已完成；阶段 2 尚未开始',
    '30986994815',
    '8922490798',
    'sha256:8b8f93b82d14ee49b8b8cd9e586299f82ac74acb34cd0697954da66174e80e15',
    '30986994863',
    '8922713210',
    'sha256:07e4037f5d63bf7b42c5d2b3f7970e5e2ad6e51f7a4e6c2e40bb2cf15fdb4109',
    'Windows 原生路径仍需要真实平台回归',
    '2 个 audit advisory'
  ]) {
    assert.match(record, new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
