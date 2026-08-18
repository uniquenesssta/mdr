#!/usr/bin/env bash
set -euo pipefail

BASE="9fd3f2baaf54cbd28b15f2bb694faf153112c20e"

# Freeze the legacy R10-07 search behavior before extraction.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createNativeDocumentStore } from './src/storage/native-document-store.js';
const calls = [];
const expected = Object.freeze({ from: 1, to: 3, wrapped: true, version: 7 });
const store = createNativeDocumentStore({
  available: true,
  documentStore: {
    async save() { return { version: 1 }; },
    async search(request) { calls.push(request); return expected; }
  }
});
assert.equal(await store.search('doc-search', '😀', -9, false), expected);
assert.deepEqual(calls, [{ documentId: 'doc-search', query: '😀', from: 0, wrap: false }]);
assert.equal(await store.search('', 'x'), null);
assert.equal(await store.search('doc-search', ''), null);
console.log('R10-08 legacy search contract: PASS');
NODE

# Remove temporary trigger history from the final Atomic parent before applying R10-08.
git reset --hard "$BASE"

python3 - <<'PY'
from pathlib import Path
import json

root = Path('.')

def read(path):
    return (root / path).read_text(encoding='utf-8')

def write(path, text):
    p = root / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected exactly one replacement target, got {text.count(old)}')
    write(path, text.replace(old, new, 1))

adapter = r'''function createDestroyedError() {
  const error = new Error('NATIVE_SEARCH_ADAPTER_DESTROYED');
  error.code = 'NATIVE_SEARCH_ADAPTER_DESTROYED';
  return error;
}

/**
 * Owns only the native large-document search request mapping and terminal
 * adapter lifecycle. Search result offsets and backend version are returned
 * exactly as provided by the Platform documentStore command.
 */
export function createNativeSearchAdapter(options = {}) {
  const documentStore = options.documentStore || null;
  const supported = Boolean(options.available && typeof documentStore?.search === 'function');
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw createDestroyedError();
  }

  async function search(documentId, query, from = 0, wrap = true) {
    assertActive();
    if (!supported || !documentId || !query) return null;
    const result = await documentStore.search({
      documentId,
      query: String(query),
      from: Math.max(0, Number(from) || 0),
      wrap: wrap !== false
    });
    assertActive();
    return result;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
  }

  return Object.freeze({
    supported,
    get destroyed() { return destroyed; },
    search,
    destroy
  });
}
'''
write('src/features/persistence/native-document-store/native-search-adapter.js', adapter)

# Public Persistence entry.
replace_once(
    'src/features/persistence/index.js',
    'completed R10-01 through R10-07 save status, manual/autosave orchestration and native Session/Queue/Snapshot Uploader/Segmented Loader boundaries',
    'completed R10-01 through R10-08 save status, manual/autosave orchestration and native Session/Queue/Snapshot Uploader/Segmented Loader/Search Adapter boundaries'
)
replace_once(
    'src/features/persistence/index.js',
    'createNativeSnapshotUploader(), createNativeSegmentedLoader(), and scoped classic',
    'createNativeSnapshotUploader(), createNativeSegmentedLoader(), createNativeSearchAdapter(), and scoped classic'
)
replace_once(
    'src/features/persistence/index.js',
    "export { createNativeSegmentedLoader } from './native-document-store/native-segmented-loader.js';\n",
    "export { createNativeSegmentedLoader } from './native-document-store/native-segmented-loader.js';\nexport { createNativeSearchAdapter } from './native-document-store/native-search-adapter.js';\n"
)

# NativeDocumentStore delegates search mapping to the new specialist.
replace_once(
    'src/storage/native-document-store.js',
    '  createNativeSaveQueue,\n  createNativeSaveSession,\n  createNativeSegmentedLoader,\n  createNativeSnapshotUploader\n',
    '  createNativeSaveQueue,\n  createNativeSaveSession,\n  createNativeSegmentedLoader,\n  createNativeSnapshotUploader,\n  createNativeSearchAdapter\n'
)
replace_once(
    'src/storage/native-document-store.js',
    "    this.segmentedLoader = createNativeSegmentedLoader({\n      documentStore: this.documentStore,\n      notify: event => this.emit(event),\n      yieldControl: () => new Promise(resolve => setTimeout(resolve, 0))\n    });\n",
    "    this.segmentedLoader = createNativeSegmentedLoader({\n      documentStore: this.documentStore,\n      notify: event => this.emit(event),\n      yieldControl: () => new Promise(resolve => setTimeout(resolve, 0))\n    });\n    this.searchAdapter = createNativeSearchAdapter({\n      documentStore: this.documentStore,\n      available: this.available\n    });\n"
)
replace_once(
    'src/storage/native-document-store.js',
    "  async search(documentId, query, from = 0, wrap = true) {\n    if (!this.available || !documentId || !query || !this.documentStore?.search) return null;\n    return this.documentStore.search({\n      documentId,\n      query: String(query),\n      from: Math.max(0, Number(from) || 0),\n      wrap: wrap !== false\n    });\n  }\n",
    "  search(documentId, query, from = 0, wrap = true) {\n    return this.searchAdapter.search(documentId, query, from, wrap);\n  }\n"
)

# Keep completed Atomic tests cumulative instead of forbidding the next specialist.
replace_once(
    'tests/stage-10-native-segmented-loader.test.mjs',
    "  assert.doesNotMatch(nativeStoreSource, /createNativeSearchAdapter/);\n",
    "  assert.doesNotMatch(nativeStoreSource, /createBrowserDocumentRepository/);\n"
)
replace_once(
    'tests/stage-10-native-snapshot-uploader.test.mjs',
    "  assert.doesNotMatch(nativeStoreSource, /createNativeSearchAdapter/);\n",
    "  assert.doesNotMatch(nativeStoreSource, /createBrowserDocumentRepository/);\n"
)

# Keep R10-06/R10-07 workflows forward-compatible with R10-08.
replace_once(
    '.github/workflows/r10-06.yml',
    '          test ! -e src/features/persistence/native-document-store/native-search-adapter.js\n',
    ''
)
replace_once(
    '.github/workflows/r10-07.yml',
    '          test ! -e src/features/persistence/native-document-store/native-search-adapter.js\n',
    ''
)
replace_once(
    '.github/workflows/r10-07.yml',
    "          if (!Array.isArray(fixture.modules) || fixture.modules.length !== 392) {\n            throw new Error(`R10-07 production module inventory mismatch: expected 392, got ${fixture.modules?.length}`);\n          }\n",
    "          if (!Array.isArray(fixture.modules) || fixture.modules.length < 392) {\n            throw new Error(`R10-07 production module inventory regressed: expected at least 392, got ${fixture.modules?.length}`);\n          }\n"
)
replace_once(
    '.github/workflows/r10-07.yml',
    "      - name: Full Node regression 295/295\n        shell: bash\n        run: |\n          set -euo pipefail\n          npm test | tee /tmp/r10_07_node.log\n          grep -q '# tests 295' /tmp/r10_07_node.log\n          grep -q '# pass 295' /tmp/r10_07_node.log\n          grep -q '# fail 0' /tmp/r10_07_node.log\n",
    "      - name: Full Node regression remains green\n        shell: bash\n        run: |\n          set -euo pipefail\n          npm test | tee /tmp/r10_07_node.log\n          grep -q '# fail 0' /tmp/r10_07_node.log\n          pass_count=\"$(sed -n 's/^# pass //p' /tmp/r10_07_node.log | tail -1)\"\n          test \"${pass_count:-0}\" -ge 295\n"
)

# Stage 3 platform contract tests are made cumulative with the Stage 10 responsibility moves.
platform_test = read('tests/unit/platform/document-store-client.test.mjs')
old = """test('DocumentStore client contains transport mapping only and leaves session/version policy in storage', async () => {\n  const clientSource = await readFile(new URL('../../../src/platform/desktop/document-store-client.js', import.meta.url), 'utf8');\n  const storeSource = await readFile(new URL('../../../src/storage/native-document-store.js', import.meta.url), 'utf8');\n  assert.doesNotMatch(clientSource, /sessions|loadSequence|VERSION_MISMATCH|forceSnapshot =|queueMicrotask|saveSnapshotInChunks|DOCUMENT_LOAD_CANCELLED/);\n  assert.match(storeSource, /this\\.sessions = new Map\\(\\)/);\n  assert.match(storeSource, /this\\.loadSequence = 0/);\n  assert.match(storeSource, /VERSION_MISMATCH/);\n  assert.match(storeSource, /saveSnapshotInChunks/);\n  assert.match(storeSource, /DOCUMENT_LOAD_CANCELLED/);\n});\n"""
new = """test('DocumentStore client contains transport mapping only while Stage 10 specialists own persistence policy', async () => {\n  const clientSource = await readFile(new URL('../../../src/platform/desktop/document-store-client.js', import.meta.url), 'utf8');\n  const storeSource = await readFile(new URL('../../../src/storage/native-document-store.js', import.meta.url), 'utf8');\n  assert.doesNotMatch(clientSource, /sessions|loadSequence|VERSION_MISMATCH|forceSnapshot =|queueMicrotask|saveSnapshotInChunks|DOCUMENT_LOAD_CANCELLED/);\n  assert.match(storeSource, /this\\.sessions = new Map\\(\\)/);\n  assert.match(storeSource, /VERSION_MISMATCH/);\n  assert.match(storeSource, /createNativeSnapshotUploader/);\n  assert.match(storeSource, /createNativeSegmentedLoader/);\n  assert.match(storeSource, /createNativeSearchAdapter/);\n  assert.doesNotMatch(storeSource, /this\\.loadSequence = 0|saveSnapshotInChunks|DOCUMENT_LOAD_CANCELLED/);\n});\n"""
if platform_test.count(old) != 1:
    raise SystemExit('platform document-store policy test replacement target mismatch')
platform_test = platform_test.replace(old, new, 1)
old = """test('desktop platform exposes DocumentStorePort and NativeDocumentStore consumes only frozen port names', async () => {\n  const desktop = await readFile(new URL('../../../src/platform/desktop/desktop-platform.js', import.meta.url), 'utf8');\n  const store = await readFile(new URL('../../../src/storage/native-document-store.js', import.meta.url), 'utf8');\n  assert.match(desktop, /createDocumentStoreClient\\(\\{ invoke: invokeClient\\.invoke \\}\\)/);\n  assert.match(desktop, /documentStore: documentStoreClient/);\n  for (const method of ['save', 'beginSnapshotUpload', 'appendSnapshotChunk', 'commitSnapshotUpload', 'abortSnapshotUpload', 'load', 'loadManifest', 'readChunk', 'search', 'remove']) {\n    assert.match(store, new RegExp(`documentStore\\\\.?${method}|documentStore\\\\?\\\\.${method}`));\n  }\n  assert.doesNotMatch(store, /markdownEditorNative|nativeApi|saveDocumentState|readDocumentChunk/);\n});\n"""
new = """test('desktop platform exposes DocumentStorePort and Stage 10 persistence consumers use only frozen port names', async () => {\n  const desktop = await readFile(new URL('../../../src/platform/desktop/desktop-platform.js', import.meta.url), 'utf8');\n  const store = await readFile(new URL('../../../src/storage/native-document-store.js', import.meta.url), 'utf8');\n  const uploader = await readFile(new URL('../../../src/features/persistence/native-document-store/native-snapshot-uploader.js', import.meta.url), 'utf8');\n  const loader = await readFile(new URL('../../../src/features/persistence/native-document-store/native-segmented-loader.js', import.meta.url), 'utf8');\n  const search = await readFile(new URL('../../../src/features/persistence/native-document-store/native-search-adapter.js', import.meta.url), 'utf8');\n  const consumers = [store, uploader, loader, search].join('\\n');\n  assert.match(desktop, /createDocumentStoreClient\\(\\{ invoke: invokeClient\\.invoke \\}\\)/);\n  assert.match(desktop, /documentStore: documentStoreClient/);\n  for (const method of ['save', 'beginSnapshotUpload', 'appendSnapshotChunk', 'commitSnapshotUpload', 'abortSnapshotUpload', 'load', 'loadManifest', 'readChunk', 'search', 'remove']) {\n    assert.match(consumers, new RegExp(`documentStore\\\\.?${method}|documentStore\\\\?\\\\.${method}`));\n  }\n  assert.doesNotMatch(consumers, /markdownEditorNative|nativeApi|saveDocumentState|readDocumentChunk/);\n});\n"""
if platform_test.count(old) != 1:
    raise SystemExit('platform document-store consumer test replacement target mismatch')
write('tests/unit/platform/document-store-client.test.mjs', platform_test.replace(old, new, 1))

# Production ownership manifest: one new module, no duplicate owner.
fixture_path = root / 'tests/architecture/fixtures/production-modules.json'
fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
modules = fixture['modules']
if len(modules) != 392:
    raise SystemExit(f'expected R10-07 production inventory 392, got {len(modules)}')
new_path = 'src/features/persistence/native-document-store/native-search-adapter.js'
if any(record[0] == new_path for record in modules):
    raise SystemExit('native-search-adapter already present')
segmented = next(record for record in modules if record[0] == 'src/features/persistence/native-document-store/native-segmented-loader.js')
modules.append([
    new_path,
    segmented[1],
    segmented[2],
    'Native large-document search request adapter preserving Platform UTF-16 offsets and backend version results without document-body ownership.',
    'native-search-adapter-lifecycle',
    'explicit-instance',
    segmented[6],
    False
])
for record in modules:
    if record[0] == 'src/features/persistence/index.js':
        record[3] = 'Public Stage 10 Persistence contract through R10-08, exposing save/autosave status plus Native Session, Queue, Snapshot Uploader, Segmented Loader and Search Adapter boundaries.'
    elif record[0] == 'src/storage/native-document-store.js':
        record[3] = 'Transitional NativeDocumentStore orchestration retaining save/session integration while delegating queue, chunk upload, segmented load and native search responsibilities to Stage 10 Persistence specialists.'
fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

# Current production count remains explicit in the Stage 1 handoff regression.
replace_once(
    'tests/stage-01-handoff.test.mjs',
    '  assert.equal(moduleFixture.modules.length, 392);\n',
    '  assert.equal(moduleFixture.modules.length, 393);\n'
)
replace_once(
    'tests/stage-01-handoff.test.mjs',
    "  assert.ok(moduleFixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-snapshot-uploader.js'));\n",
    "  assert.ok(moduleFixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-snapshot-uploader.js'));\n  assert.ok(moduleFixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-segmented-loader.js'));\n  assert.ok(moduleFixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-search-adapter.js'));\n"
)

search_tests = r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNativeSearchAdapter } from '../src/features/persistence/index.js';
import { createNativeDocumentStore } from '../src/storage/native-document-store.js';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('Atomic 10.8 NativeSearchAdapter owns only native search mapping and terminal lifecycle', async () => {
  const moduleSource = await source('src/features/persistence/native-document-store/native-search-adapter.js');
  assert.doesNotMatch(moduleSource, /from\s+['"]|createNativeSaveSession|createNativeSaveQueue|createNativeSnapshotUploader|createNativeSegmentedLoader|createSnapshot|getChangesSince/);
  assert.doesNotMatch(moduleSource, /\bwindow\s*\.|\bdocument\s*\.|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Worker\s*\(/);
  const adapter = createNativeSearchAdapter({ available: true, documentStore: { async search() { return null; } } });
  assert.equal(adapter.supported, true);
  assert.equal(adapter.destroyed, false);
  assert.equal(typeof adapter.search, 'function');
  assert.equal(typeof adapter.destroy, 'function');
  adapter.destroy();
  assert.equal(adapter.destroyed, true);
});

test('Atomic 10.8 support and empty-input gating preserve the previous NativeDocumentStore contract', async () => {
  let calls = 0;
  const transport = { async search() { calls += 1; return { from: 0, to: 1, wrapped: false, version: 1 }; } };
  const unavailable = createNativeSearchAdapter({ available: false, documentStore: transport });
  assert.equal(unavailable.supported, false);
  assert.equal(await unavailable.search('doc', 'x'), null);
  const missing = createNativeSearchAdapter({ available: true, documentStore: {} });
  assert.equal(missing.supported, false);
  assert.equal(await missing.search('doc', 'x'), null);
  const available = createNativeSearchAdapter({ available: true, documentStore: transport });
  assert.equal(await available.search('', 'x'), null);
  assert.equal(await available.search('doc', ''), null);
  assert.equal(calls, 0);
});

test('Atomic 10.8 maps document query from and wrap exactly as the legacy native search path', async () => {
  const requests = [];
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search(request) { requests.push(request); return null; } }
  });
  await adapter.search('doc-1', 123, -9, false);
  await adapter.search('doc-2', 'needle', '11', undefined);
  assert.deepEqual(requests, [
    { documentId: 'doc-1', query: '123', from: 0, wrap: false },
    { documentId: 'doc-2', query: 'needle', from: 11, wrap: true }
  ]);
});

test('Atomic 10.8 preserves UTF-16 offsets backend version and result identity without JS reinterpretation', async () => {
  const result = Object.freeze({ from: 1, to: 3, wrapped: false, version: 17, marker: 'utf16-emoji' });
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { return result; } }
  });
  const actual = await adapter.search('doc-utf16', '😀', 0, true);
  assert.equal(actual, result);
  assert.deepEqual(actual, { from: 1, to: 3, wrapped: false, version: 17, marker: 'utf16-emoji' });
});

test('Atomic 10.8 preserves null not-found results from the Platform command', async () => {
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { return null; } }
  });
  assert.equal(await adapter.search('doc-none', 'absent'), null);
});

test('Atomic 10.8 propagates native search failures with original identity', async () => {
  const failure = new Error('后台搜索任务失败：boom');
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { throw failure; } }
  });
  await assert.rejects(adapter.search('doc-fail', 'x'), error => error === failure);
});

test('Atomic 10.8 destroy is terminal and a late in-flight result cannot escape the adapter', async () => {
  const gate = deferred();
  const adapter = createNativeSearchAdapter({
    available: true,
    documentStore: { async search() { return gate.promise; } }
  });
  const pending = adapter.search('doc-late', 'x');
  adapter.destroy();
  adapter.destroy();
  gate.resolve({ from: 0, to: 1, wrapped: false, version: 1 });
  await assert.rejects(pending, error => error?.code === 'NATIVE_SEARCH_ADAPTER_DESTROYED');
  await assert.rejects(adapter.search('doc-late', 'x'), error => error?.code === 'NATIVE_SEARCH_ADAPTER_DESTROYED');
});

test('Atomic 10.8 NativeDocumentStore delegates native search while preserving the existing classic Find caller contract', async () => {
  const requests = [];
  const result = Object.freeze({ from: 2, to: 4, wrapped: true, version: 9 });
  const platformStore = {
    async save() { return { version: 1 }; },
    async search(request) { requests.push(request); return result; }
  };
  const store = createNativeDocumentStore({ documentStore: platformStore, available: true });
  assert.equal(await store.search('doc-integration', '😀', 2, true), result);
  assert.deepEqual(requests, [{ documentId: 'doc-integration', query: '😀', from: 2, wrap: true }]);

  const [entry, nativeStoreSource, webClipperSource, fixtureText] = await Promise.all([
    source('src/features/persistence/index.js'),
    source('src/storage/native-document-store.js'),
    source('public/app/web-clipper.js'),
    source('tests/architecture/fixtures/production-modules.json')
  ]);
  assert.match(entry, /createNativeSearchAdapter/);
  assert.match(nativeStoreSource, /createNativeSearchAdapter/);
  assert.match(nativeStoreSource, /searchAdapter\.search\(documentId, query, from, wrap\)/);
  assert.doesNotMatch(nativeStoreSource, /documentStore\?\.search|documentStore\.search\(/);
  assert.match(webClipperSource, /nativeStore\.search\(currentDoc\.id, query, from, wrap\)/);
  assert.doesNotMatch(nativeStoreSource, /createBrowserDocumentRepository|createLoadController/);
  const fixture = JSON.parse(fixtureText);
  assert.equal(fixture.modules.length, 393);
  assert.ok(fixture.modules.some(record => record[0] === 'src/features/persistence/native-document-store/native-search-adapter.js'));
});
'''
write('tests/stage-10-native-search-adapter.test.mjs', search_tests)

# Root README remains concise; detailed actual record lives beside prior Stage 10 records.
replace_once(
    'README.md',
    '、[R10-07](docs/R10-07-DETAILS.md)。',
    '、[R10-07](docs/R10-07-DETAILS.md)、[R10-08](docs/R10-08-DETAILS.md)。'
)

details = '''# R10-08 — Native Search Adapter\n\nAtomic 10.8 将大文档 native 搜索的 `documentId/query/from/wrap` 请求映射从旧 `src/storage/native-document-store.js` 抽离到 `src/features/persistence/native-document-store/native-search-adapter.js`。Adapter 只持有终态 lifecycle，不拥有文档正文、SaveSession、SaveQueue、SnapshotUploader、SegmentedLoader、DOM、计时器或平台之外的共享状态。\n\n兼容语义保持不变：只有 NativeDocumentStore 可用、平台具备 `search` 且 documentId/query 非空时才调用现有 `search_document_state` 端口；`from` 继续按非负数归一化，`wrap` 仅在显式 `false` 时关闭。平台返回对象原样透传，因此 Rust 已计算的 UTF-16 `from/to`、`wrapped` 和后端 `version` 不在 JavaScript 再解释或转换；not-found `null` 与平台错误身份也保持不变。经典 Find 路径仍通过 `nativeStore.search(...)` 调用同一 NativeDocumentStore public API。\n\nR10-09 Browser Repository、R10-10 Load Controller、Close Save 与最终 classic cleanup 均未提前实施；冻结 DocumentModel、Rust `document_store.rs`、Platform DTO、持久化格式、`package.json` 与 lockfile 未修改。生产模块清单由 392 增至 393。\n\n验证：Atomic commit 生成前已执行旧搜索契约冻结、R10-08 targeted 8/8、R10-07 10/10、R10-06 11/11、R10-05 9/9、Stage 3 DocumentStore client 10/10、完整 Node 303/303、npm audit high 0、Architecture/No-Legacy/Generated/README、Browser Contract 10/10、Production Build、Built-app Browser 29/29、冻结路径与 clean tracked tree。`npm run test:integration` 当前不存在；本 Atomic 未修改 Rust/DTO/持久化格式，因此未重复执行 Rust test/clippy/check。\n'''
write('docs/R10-08-DETAILS.md', details)

workflow = '''name: R10-08 Native Search Adapter\n\non:\n  push:\n    branches:\n      - agent/r10-stage\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  validate:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 45\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n\n      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n          cache: npm\n\n      - name: Guard R10-08 frozen contracts and search ownership\n        shell: bash\n        run: |\n          set -euo pipefail\n          base='9fd3f2baaf54cbd28b15f2bb694faf153112c20e'\n          git merge-base --is-ancestor "$base" HEAD\n          git diff --quiet "$base"...HEAD -- \\\n            src/model-kernel/index.js \\\n            src/document/document-model.js \\\n            src/sync/selection-mapping.js \\\n            src/preview/incremental-preview.js \\\n            src/preview/math-source.js \\\n            src/editor/hybrid/block-registry.js \\\n            src/editor/hybrid/math-ranges.js \\\n            src/editor/hybrid/ranges.js \\\n            src/editor/hybrid/table-model.js \\\n            src-tauri/src/document_store.rs \\\n            package.json package-lock.json\n          test ! -e .agent/r10-08-finalize.sh\n          test ! -e .github/workflows/r10-08-bootstrap.yml\n          test -f src/features/persistence/native-document-store/native-search-adapter.js\n          test ! -e src/features/persistence/browser/browser-document-repository.js\n          test ! -e src/features/persistence/application/load-controller.js\n          grep -q 'createNativeSearchAdapter' src/features/persistence/index.js\n          grep -q 'searchAdapter.search(documentId, query, from, wrap)' src/storage/native-document-store.js\n          ! grep -Eq 'documentStore\\?\\.search|documentStore\\.search\\(' src/storage/native-document-store.js\n          node - <<'NODE'\n          const fs = require('node:fs');\n          const fixture = JSON.parse(fs.readFileSync('tests/architecture/fixtures/production-modules.json', 'utf8'));\n          if (!Array.isArray(fixture.modules) || fixture.modules.length !== 393) {\n            throw new Error(`R10-08 production module inventory mismatch: expected 393, got ${fixture.modules?.length}`);\n          }\n          const path = 'src/features/persistence/native-document-store/native-search-adapter.js';\n          if (!fixture.modules.some(record => record[0] === path)) throw new Error(`Missing inventory record: ${path}`);\n          NODE\n          git diff --check\n\n      - name: Install dependencies\n        run: npm ci\n\n      - name: Audit production dependencies\n        run: npm audit --audit-level=high\n\n      - name: R10-08 targeted gate 8/8\n        shell: bash\n        run: |\n          set -euo pipefail\n          node --test tests/stage-10-native-search-adapter.test.mjs | tee /tmp/r10_08_targeted.log\n          grep -q '# tests 8' /tmp/r10_08_targeted.log\n          grep -q '# pass 8' /tmp/r10_08_targeted.log\n          grep -q '# fail 0' /tmp/r10_08_targeted.log\n\n      - name: R10-07 segmented loader compatibility 10/10\n        shell: bash\n        run: |\n          set -euo pipefail\n          node --test tests/stage-10-native-segmented-loader.test.mjs | tee /tmp/r10_07_compat.log\n          grep -q '# tests 10' /tmp/r10_07_compat.log\n          grep -q '# pass 10' /tmp/r10_07_compat.log\n          grep -q '# fail 0' /tmp/r10_07_compat.log\n\n      - name: R10-06 snapshot uploader compatibility 11/11\n        shell: bash\n        run: |\n          set -euo pipefail\n          node --test tests/stage-10-native-snapshot-uploader.test.mjs | tee /tmp/r10_06_compat.log\n          grep -q '# tests 11' /tmp/r10_06_compat.log\n          grep -q '# pass 11' /tmp/r10_06_compat.log\n          grep -q '# fail 0' /tmp/r10_06_compat.log\n\n      - name: R10-05 save queue compatibility 9/9\n        shell: bash\n        run: |\n          set -euo pipefail\n          node --test tests/stage-10-native-save-queue.test.mjs | tee /tmp/r10_05_compat.log\n          grep -q '# tests 9' /tmp/r10_05_compat.log\n          grep -q '# pass 9' /tmp/r10_05_compat.log\n          grep -q '# fail 0' /tmp/r10_05_compat.log\n\n      - name: Stage 3 DocumentStore client remains compatible 10/10\n        shell: bash\n        run: |\n          set -euo pipefail\n          node --test tests/unit/platform/document-store-client.test.mjs | tee /tmp/r10_08_platform.log\n          grep -q '# tests 10' /tmp/r10_08_platform.log\n          grep -q '# pass 10' /tmp/r10_08_platform.log\n          grep -q '# fail 0' /tmp/r10_08_platform.log\n\n      - name: Full Node regression 303/303\n        shell: bash\n        run: |\n          set -euo pipefail\n          npm test | tee /tmp/r10_08_node.log\n          grep -q '# tests 303' /tmp/r10_08_node.log\n          grep -q '# pass 303' /tmp/r10_08_node.log\n          grep -q '# fail 0' /tmp/r10_08_node.log\n\n      - name: Architecture and documentation gates\n        shell: bash\n        run: |\n          set -euo pipefail\n          npm run verify:architecture\n          npm run verify:no-legacy-runtime\n          npm run verify:generated-files\n          npm run verify:readme-record\n\n      - name: Browser preview contract 10/10\n        shell: bash\n        run: |\n          set -euo pipefail\n          npm run test:browser:contract | tee /tmp/r10_08_browser_contract.log\n          grep -Fq 'Browser tests: 10, passed: 10, failed: 0' /tmp/r10_08_browser_contract.log\n\n      - name: Production build\n        run: npm run build\n\n      - name: Built-app browser regression 29/29\n        shell: bash\n        run: |\n          set -euo pipefail\n          npm run test:browser | tee /tmp/r10_08_browser.log\n          grep -Fq 'Browser tests: 29, passed: 29, failed: 0' /tmp/r10_08_browser.log\n\n      - name: Validation must leave tracked tree clean\n        shell: bash\n        run: |\n          set -euo pipefail\n          git diff --check\n          git diff --exit-code\n'''
write('.github/workflows/r10-08.yml', workflow)
PY

# Required dependency and behavior verification.
npm ci
npm audit --audit-level=high

node --test tests/stage-10-native-search-adapter.test.mjs | tee /tmp/r10_08_targeted.log
grep -q '# tests 8' /tmp/r10_08_targeted.log
grep -q '# pass 8' /tmp/r10_08_targeted.log
grep -q '# fail 0' /tmp/r10_08_targeted.log

node --test tests/stage-10-native-segmented-loader.test.mjs | tee /tmp/r10_07_compat.log
grep -q '# tests 10' /tmp/r10_07_compat.log
grep -q '# pass 10' /tmp/r10_07_compat.log
grep -q '# fail 0' /tmp/r10_07_compat.log

node --test tests/stage-10-native-snapshot-uploader.test.mjs | tee /tmp/r10_06_compat.log
grep -q '# tests 11' /tmp/r10_06_compat.log
grep -q '# pass 11' /tmp/r10_06_compat.log
grep -q '# fail 0' /tmp/r10_06_compat.log

node --test tests/stage-10-native-save-queue.test.mjs | tee /tmp/r10_05_compat.log
grep -q '# tests 9' /tmp/r10_05_compat.log
grep -q '# pass 9' /tmp/r10_05_compat.log
grep -q '# fail 0' /tmp/r10_05_compat.log

node --test tests/unit/platform/document-store-client.test.mjs | tee /tmp/r10_08_platform.log
grep -q '# tests 10' /tmp/r10_08_platform.log
grep -q '# pass 10' /tmp/r10_08_platform.log
grep -q '# fail 0' /tmp/r10_08_platform.log

npm test | tee /tmp/r10_08_node.log
grep -q '# tests 303' /tmp/r10_08_node.log
grep -q '# pass 303' /tmp/r10_08_node.log
grep -q '# fail 0' /tmp/r10_08_node.log

npm run verify:architecture
npm run verify:no-legacy-runtime
npm run verify:generated-files
npm run verify:readme-record

export CHROME_PATH="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser)"
npm run test:browser:contract | tee /tmp/r10_08_browser_contract.log
grep -Fq 'Browser tests: 10, passed: 10, failed: 0' /tmp/r10_08_browser_contract.log
npm run build
npm run test:browser | tee /tmp/r10_08_browser.log
grep -Fq 'Browser tests: 29, passed: 29, failed: 0' /tmp/r10_08_browser.log

# Scope/frozen/cleanup review.
git diff --check
git diff --quiet "$BASE" -- \
  src/model-kernel/index.js \
  src/document/document-model.js \
  src/sync/selection-mapping.js \
  src/preview/incremental-preview.js \
  src/preview/math-source.js \
  src/editor/hybrid/block-registry.js \
  src/editor/hybrid/math-ranges.js \
  src/editor/hybrid/ranges.js \
  src/editor/hybrid/table-model.js \
  src-tauri/src/document_store.rs \
  package.json package-lock.json

test ! -e src/features/persistence/browser/browser-document-repository.js
test ! -e src/features/persistence/application/load-controller.js
test ! -e .github/workflows/r10-08-bootstrap.yml
rm -f .agent/r10-08-finalize.sh

git add -A
git diff --cached --check
git config user.name uniquenesssta
git config user.email uniquenesssta@live.com
git commit -m 'feat: implement R10-08 native search adapter'

# Atomic history and clean tracked tree are hard requirements.
test "$(git rev-list --count "$BASE"..HEAD)" -eq 1
test "$(git rev-parse HEAD^)" = "$BASE"
test -z "$(git status --porcelain)"
echo "R10_08_COMMIT=$(git rev-parse HEAD)"
echo "R10_08_TREE=$(git rev-parse HEAD^{tree})"

# Transfer the commit object if possible. Workflow-file permission may reject the ref update;
# the connector will publish the validated commit object in that case.
git fetch origin agent/r10-stage
if ! git push --force origin HEAD:agent/r10-stage; then
  echo 'R10-08 push ref update rejected; validated commit object transfer attempted for connector publication.'
fi
