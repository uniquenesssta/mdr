import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildDependencyGraph, collectJavaScriptDependencies, findDependencyCycles } from '../scripts/architecture/dependency-graph.mjs';
import { checkDependencyBoundaries, writeArchitectureBaseline } from '../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord } from './architecture/helpers.mjs';
import { discoverProductionFiles } from '../scripts/stage-01/module-inventory-core.mjs';

const fixture = files => createArchitectureFixture(files, Object.keys(files).filter(path =>
  /^(?:src|public|src-tauri\/src)\/.+\.(?:js|css|html|rs)$/.test(path)
    || ['index.html', 'vite.config.js', 'src-tauri/build.rs'].includes(path)).map(path => moduleRecord(path)));
const has = (report, rule) => report.issues.some(row => row.rule === rule);

test('R16-12 AST records static imports, namespace re-exports and folded dynamic imports', () => {
  const report = collectJavaScriptDependencies(`import './a.js'; export * as api from './b.js'; const lazy = () => import('./' + 'c.js');`);
  assert.deepEqual(report.references.map(row => row.specifier), ['./a.js', './b.js', './c.js']);
  assert.deepEqual(report.unresolved, []);
});

test('R16-12 comments, strings and regex text cannot fabricate imports', () => {
  const source = String.raw`// import './absent.js';
    const text = "export * from './absent.js'";
    const pattern = /import\('fake'\)/;
    /* import('../private.js') */ export const ready = true;`;
  assert.deepEqual(collectJavaScriptDependencies(source).references, []);
});

test('R16-12 source locations retain exact importer lines across Unicode text', () => {
  const report = collectJavaScriptDependencies(`const title = '中文 😀';\n  import './a.js';`);
  assert.equal(report.references[0].line, 2);
  assert.equal(report.references[0].column, 3);
});

test('R16-12 cross-feature public entries remain valid for literal lazy imports', async () => {
  const root = await fixture({ 'src/features/a/index.js': `export const lazy = () => import('../b/index.js');`,
    'src/features/b/index.js': 'export const value = 1;' });
  assert.deepEqual((await buildDependencyGraph({ root })).issues, []);
});

test('R16-12 dynamic imports and namespace re-exports cannot cross feature internals', async () => {
  const root = await fixture({ 'src/features/a/index.js': `export * as api from '../b/private.js'; export const lazy = () => import('../b/private.js');`,
    'src/features/b/private.js': 'export const value = 1;' });
  const report = await buildDependencyGraph({ root });
  assert.equal(report.issues.filter(row => row.rule === 'cross-feature-internal-import').length, 2);
});

test('R16-12 missing, case-mismatched and escaping paths fail instead of disappearing', async () => {
  const root = await fixture({ 'src/main.js': `import './missing.js'; import './ACTUAL.js'; import '../../outside.js';`, 'src/actual.js': 'export const value = 1;' });
  const report = await buildDependencyGraph({ root });
  for (const rule of ['unresolved-local-dependency', 'dependency-path-case-mismatch', 'dependency-outside-repository']) assert.ok(has(report, rule));
});

test('R16-12 computed module loaders fail while ordinary runtime URL parsing remains valid', async () => {
  const root = await fixture({ 'src/main.js': `export const load = path => import(path); new URL(path, import.meta.url); import.meta.glob(pattern); new URL(userInput);` });
  assert.equal((await buildDependencyGraph({ root })).issues.filter(row => row.rule === 'computed-module-dependency').length, 3);
});

test('R16-12 Worker URLs are explicit cross-realm edges and still enforce feature boundaries', async () => {
  const root = await fixture({ 'src/features/a/client.js': `export const create = () => new Worker(new URL('./worker.js', import.meta.url));`,
    'src/features/a/worker.js': `import './client.js';`, 'src/features/b/private.js': 'export const b = 1;' });
  const graph = await buildDependencyGraph({ root });
  assert.deepEqual(graph.cycles, []);
  assert.ok(graph.edges.some(row => row.kind === 'module-url' && row.to.endsWith('/worker.js') && row.domain === null));
  await writeFile(join(root, 'src/features/a/worker.js'), `new URL('../b/private.js', import.meta.url);`);
  assert.ok(has(await buildDependencyGraph({ root }), 'cross-feature-internal-import'));
});

test('R16-12 static and dynamic ESM cycles cannot evade normalization with query strings', async () => {
  const root = await fixture({ 'src/a.js': `export const load = () => import('./b.js?revision=1');`, 'src/b.js': `import './a.js';` });
  const graph = await buildDependencyGraph({ root });
  assert.ok(has(graph, 'circular-dependency'));
  assert.equal(graph.cycles[0].domain, 'esm');
  assert.deepEqual(findDependencyCycles(new Map([['a', ['a']], ['b', ['c']], ['c', ['b']]])), [['a', 'a'], ['b', 'c', 'b']]);
});

test('R16-12 CSS imports and asset URLs are nodes while fragment references stay local', async () => {
  const root = await fixture({ 'src/styles/index.css': `@import './base.css'; .image { background: url('../../public/icon.svg'); mask: url(#local); }`,
    'src/styles/base.css': '.base { color: red; }', 'public/icon.svg': '<svg/>' });
  const graph = await buildDependencyGraph({ root });
  assert.deepEqual(graph.issues, []);
  assert.ok(graph.edges.some(row => row.kind === 'css-import' && row.to === 'src/styles/base.css'));
  assert.ok(graph.edges.some(row => row.kind === 'css-url' && row.to === 'public/icon.svg'));
});

test('R16-12 stylesheet import cycles are independently rejected', async () => {
  const root = await fixture({ 'src/a.css': `@import './b.css';`, 'src/b.css': `@import './a.css';` });
  assert.ok((await buildDependencyGraph({ root })).cycles.some(row => row.domain === 'css'));
});

test('R16-12 HTML tracks real resources and inline modules without data-attribute or inert-script decoys', async () => {
  const root = await fixture({ 'index.html': `<!-- <script src="/absent.js"></script> -->
    <img data-src="/absent.svg"><script type="application/json">"import './absent.js'"</script>
    <script type="module">import './src/main.js';</script><link rel="stylesheet" href="/src/main.css">`,
    'src/main.js': 'export const value = 1;', 'src/main.css': 'body { color: black; }' });
  const graph = await buildDependencyGraph({ root });
  assert.deepEqual(graph.issues, []);
  assert.ok(graph.edges.some(row => row.from === 'index.html' && row.to === 'src/main.js'));
  assert.ok(graph.edges.some(row => row.from === 'index.html' && row.to === 'src/main.css'));
});

test('R16-12 npm declarations, lock versions, Node builtins and undeclared imports are distinct', async () => {
  const root = await fixture({ 'package.json': JSON.stringify({ dependencies: { katex: '0.18.2' } }),
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/katex': { version: '0.18.2' } } }),
    'src/main.js': `import 'katex/dist/katex.css?raw'; import 'unknown-package'; import 'node:path';` });
  const graph = await buildDependencyGraph({ root });
  assert.ok(has(graph, 'undeclared-package-import'));
  assert.equal(graph.nodes.find(row => row.id === 'npm:katex').lockedVersion, '0.18.2');
  assert.equal(graph.nodes.find(row => row.id === 'builtin:node:path').kind, 'node-builtin');
});

test('R16-12 build-only imports follow their complete chain without authorizing runtime test imports', async () => {
  const root = await fixture({ 'vite.config.js': `import './scripts/build/a.mjs';`,
    'scripts/build/a.mjs': `import './b.cjs';`, 'scripts/build/b.cjs': `module.exports = require('node:crypto');`,
    'src/main.js': `import '../tests/runtime.mjs'; import '../tests/hidden.cjs';`,
    'tests/runtime.mjs': 'export const value = 1;', 'tests/hidden.cjs': 'module.exports = 1;' });
  const graph = await buildDependencyGraph({ root });
  assert.ok(graph.edges.some(row => row.from === 'scripts/build/a.mjs' && row.to === 'scripts/build/b.cjs'));
  assert.ok(graph.edges.some(row => row.from === 'scripts/build/b.cjs' && row.to === 'builtin:node:crypto'));
  assert.equal(graph.issues.filter(row => row.rule === 'unowned-local-dependency').length, 2);
});

test('R16-12 raw resource imports retain the resolved file and their separate execution role', async () => {
  const root = await fixture({ 'src/main.js': `import html from './snippet.html?raw';`, 'src/snippet.html': '<p>content</p>' });
  const graph = await buildDependencyGraph({ root });
  assert.deepEqual(graph.issues, []);
  assert.equal(graph.edges.find(row => row.specifier.endsWith('?raw')).domain, null);
});

test('R16-12 literal local glob arrays enumerate every matched production dependency', async () => {
  const root = await fixture({ 'src/main.js': `const modules = import.meta.glob(['./parts/*.js', './extras/*.js'], { query: '?raw' });`,
    'src/parts/a.js': 'export const a = 1;', 'src/extras/b.js': 'export const b = 2;' });
  const graph = await buildDependencyGraph({ root });
  assert.deepEqual(graph.issues, []);
  assert.deepEqual(graph.edges.filter(row => row.kind === 'glob-match').map(row => row.to).sort(), ['src/extras/b.js', 'src/parts/a.js']);
});

test('R16-12 vendor font globs retain package boundaries and reject path traversal', async () => {
  const root = await fixture({ 'package.json': JSON.stringify({ dependencies: { katex: '0.18.2' } }),
    'src/main.js': `const fonts = import.meta.glob('../../node_modules/katex/dist/fonts/*.woff2', { query: '?inline' });` });
  const graph = await buildDependencyGraph({ root });
  assert.deepEqual(graph.issues, []);
  assert.ok(graph.nodes.some(row => row.kind === 'npm-asset-glob' && row.package === 'katex'));
  for (const specifier of ['../../../node_modules/katex/../../src/features/b/private.js',
    String.raw`../../../node_modules/katex/..\..\src/features/b/private.js`]) {
    await writeFile(join(root, 'src/main.js'), `import.meta.glob(${JSON.stringify(specifier)});`);
    assert.ok(has(await buildDependencyGraph({ root }), 'dependency-outside-package'));
  }
});

test('R16-12 native declarations distinguish module files, test inputs, comments and raw strings', async () => {
  const root = await fixture({ 'src-tauri/src/main.rs': `/* nested /* mod ghost; */ comment */ mod data;
    const TEXT: &str = r##"mod absent;"##; const BYTES: &[u8] = b"\\xff\\x00";
    #[cfg(test)] #[path = "../tests/case.rs"] mod case;`,
    'src-tauri/src/data.rs': 'pub const VALUE: u8 = 1;', 'src-tauri/tests/case.rs': 'fn test_case() {}' });
  const graph = await buildDependencyGraph({ root });
  assert.deepEqual(graph.issues, []);
  assert.ok(graph.edges.some(row => row.kind === 'rust-module' && row.to === 'src-tauri/src/data.rs'));
  assert.equal(graph.nodes.find(row => row.id === 'src-tauri/tests/case.rs').kind, 'native-test-input');
});

test('R16-12 native include concatenation resolves manifest-relative input and unknown computed includes fail', async () => {
  const root = await fixture({ 'src-tauri/src/main.rs': `const TEXT: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/input.txt")); include!(unknown());`,
    'src-tauri/tests/input.txt': 'fixed input' });
  const graph = await buildDependencyGraph({ root });
  assert.ok(graph.edges.some(row => row.to === 'src-tauri/tests/input.txt' && row.kind === 'rust-include'));
  assert.ok(has(graph, 'computed-module-dependency'));
});

test('R16-12 malformed source and orphan ownership records cannot produce an accepted graph', async () => {
  const root = await createArchitectureFixture({ 'src/main.js': 'export {' }, [moduleRecord('src/main.js'), moduleRecord('src/absent.js')]);
  const graph = await buildDependencyGraph({ root });
  assert.ok(has(graph, 'dependency-source-parse'));
  assert.ok(has(graph, 'production-inventory'));
});

test('R16-12 existing platform, model and feature dependency directions remain enforced', async () => {
  const root = await fixture({ 'src/features/a/index.js': `import '../../app/bootstrap.js';`,
    'src/app/bootstrap.js': 'export const ready = true;', 'src/platform/index.js': `import '../features/a/index.js';`,
    'src/model-kernel/index.js': `import '../features/a/index.js';` });
  const graph = await buildDependencyGraph({ root });
  for (const rule of ['platform-imports-feature', 'model-kernel-import-direction', 'feature-imports-composition-root']) assert.ok(has(graph, rule));
});

test('R16-12 native parent namespace references are valid but recursive file declarations are rejected', async () => {
  const root = await fixture({ 'src-tauri/src/main.rs': 'mod child; pub const VALUE: u8 = 1;',
    'src-tauri/src/child.rs': 'use super::VALUE; pub const CHILD: u8 = VALUE;' });
  assert.deepEqual((await buildDependencyGraph({ root })).cycles, []);
  await writeFile(join(root, 'src-tauri/src/child.rs'), '#[path = "main.rs"] mod parent;');
  assert.ok((await buildDependencyGraph({ root })).cycles.some(row => row.domain === 'rust-declaration'));
});

test('R16-12 baseline rewriting and graph output cannot exempt computed dependencies', async () => {
  const source = 'export const load = path => import(path);';
  const root = await fixture({ 'src/main.js': source });
  await writeArchitectureBaseline({ root });
  assert.ok((await checkDependencyBoundaries({ root })).some(row => row.rule === 'computed-module-dependency'));
  const result = spawnSync(process.execPath, [resolve('scripts/architecture/dependency-graph.mjs'), '--root=' + root, '--write'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(JSON.parse(await readFile(join(root, 'docs/audit/r16-12-dependency-graph.json'), 'utf8')).issues.length);
  assert.equal(await readFile(join(root, 'src/main.js'), 'utf8'), source);
});

test('R16-12 the complete current graph covers actual production, has closed edges and matches recorded evidence', async () => {
  const graph = await buildDependencyGraph();
  const production = await discoverProductionFiles(process.cwd()), nodes = new Set(graph.nodes.map(row => row.id));
  assert.ok(production.every(path => nodes.has(path)));
  assert.ok(graph.edges.every(row => nodes.has(row.from) && nodes.has(row.to)));
  assert.deepEqual(graph.issues, []); assert.deepEqual(graph.cycles, []);
  assert.ok(graph.edges.some(row => row.kind === 'module-url' && row.to.endsWith('/preview-worker.js')));
  assert.ok(graph.nodes.some(row => row.kind === 'npm-asset-glob'));
  const { baselineCommit, ...frozen } = JSON.parse(await readFile('docs/audit/r16-12-dependency-graph.json', 'utf8'));
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', baselineCommit, 'HEAD']).status, 0);
  assert.deepEqual(graph, frozen);
});
