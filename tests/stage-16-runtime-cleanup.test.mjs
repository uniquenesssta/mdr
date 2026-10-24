import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { collectModuleSpecifiers } from '../scripts/architecture/source-analysis.mjs';
import { createTelemetryRuntimeHost } from './support/telemetry-runtime-host.mjs';

const root = new URL('../', import.meta.url);
const baseline = '2b955f8ef69412e7f16bced71c47e9dcb0fb51cc';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
const read = path => readFile(new URL(path, root), 'utf8');
const migrations = [
  ['src/runtime/link-preview.js', 'src/features/link-preview/link-preview-controller.js', 'const SUPPORTED_SCHEMES'],
  ['src/runtime/e2e-bridge.js', 'src/features/e2e/browser-e2e-bridge.js', 'let installation = null;'],
  ['src/runtime/performance.js', 'src/features/telemetry/browser-telemetry.js', 'const sessionId']
];

for (const [old, current, marker] of migrations) {
  test('R16-07 retires ' + old + ' with a single feature owner and preserved behavior', async () => {
    await assert.rejects(access(new URL(old, root)), { code: 'ENOENT' });
    let previous = git(['show', baseline + ':' + old]);
    previous = previous.slice(previous.indexOf(marker));
    if (old.endsWith('/performance.js')) {
      const start = 'if (import.meta.env.DEV) {\n';
      assert.equal(previous.split(start).length, 2);
      previous = previous.replace(start, 'export function mountPerformanceTelemetry() {\n  if (!import.meta.env.DEV || telemetryDestroyed || disconnectRecorder) return false;\n');
      previous = previous.replace(/\n}$/, '\n  return true;\n}');
    }
    const source = await read(current);
    assert.equal(source.slice(source.indexOf(marker)).trimEnd(), previous, current + ': changed beyond imports/header and explicit idempotent mount');
  });
}

function runtimeImports(path, source) {
  return collectModuleSpecifiers(source).filter(({ specifier }) => {
    const target = specifier.startsWith('/') ? specifier.slice(1)
      : posix.normalize(posix.join(posix.dirname(path), specifier));
    return target.startsWith('src/runtime/');
  });
}

test('R16-07 tracked production has no generic runtime files or imports', async () => {
  assert.equal(git(['ls-files', 'src/runtime']), '');
  const paths = git(['ls-files', '-z', 'src', 'public']).split('\0').filter(path => /\.(?:js|mjs)$/.test(path));
  for (const path of paths) assert.deepEqual(runtimeImports(path, await read(path)), [], path);
});

test('R16-07 import admission rejects static, dynamic and re-export resurrection', () => {
  for (const source of [
    "import './runtime/performance.js';",
    "import('./runtime/e2e-bridge.js');",
    "export * from './runtime/link-preview.js';"
  ]) assert.equal(runtimeImports('src/main.js', source).length, 1, source);
  assert.deepEqual(runtimeImports('src/main.js', "import { createLinkPreview } from './features/link-preview/index.js';"), []);
});

test('R16-07 public feature imports are cold without browser globals or an E2E installation', () => {
  const urls = ['telemetry', 'e2e', 'link-preview'].map(name => new URL('src/features/' + name + '/index.js', root).href);
  const script = `
    for (const key of ['window','document']) Object.defineProperty(globalThis,key,{get(){throw Error('read '+key);}});
    const [telemetry,e2e,links] = await Promise.all(${JSON.stringify(urls)}.map(url=>import(url)));
    if (typeof telemetry.mountPerformanceTelemetry!=='function' || typeof e2e.installMarkdownEditorE2EBridge!=='function' || typeof links.createLinkPreview!=='function') throw Error('missing API');
    if (Object.hasOwn(globalThis,'__markdownEditorE2E')) throw Error('implicit E2E installation');
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, stdio: 'pipe' });
});

test('R16-07 explicit DEV mount records bootstrap once, owns one lifecycle and stays terminal after destroy', async t => {
  const h = createTelemetryRuntimeHost({ dev: true, enabled: false, autoMount: false });
  t.after(() => h.dispose());
  assert.equal(h.api.getLifecycleState(), null);
  assert.equal([...h.events.values()].flat().length, 0);
  assert.equal(h.api.mountPerformanceTelemetry(), true);
  assert.equal(h.api.mountPerformanceTelemetry(), false);
  h.configure(true);
  assert.equal(h.api.getLifecycleState().controlListeners, 3);
  assert.equal(h.timers.size, 3);
  await h.api.flush();
  assert.equal(h.entries().filter(entry => entry.operation === 'frontend.bootstrap').length, 1);
  const report = h.api.destroyPerformanceTelemetry();
  assert.equal(h.api.mountPerformanceTelemetry(), false);
  assert.equal(h.api.destroyPerformanceTelemetry(), report);
  assert.equal(h.timers.size + h.frames.size + [...h.events.values()].flat().length, 0);
});

test('R16-07 production mount creates no automatic events, observers, timers or browser listeners', async t => {
  const h = createTelemetryRuntimeHost({ dev: false, autoMount: false });
  t.after(() => h.dispose());
  assert.equal(h.api.mountPerformanceTelemetry(), false);
  assert.equal(h.api.getLifecycleState(), null);
  assert.equal(h.timers.size + h.frames.size + [...h.events.values()].flat().length, 0);
  assert.equal(h.batches.length, 0);
});
