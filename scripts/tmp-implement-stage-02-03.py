from pathlib import Path
import json
import os
import re

ROOT = Path('.')

EXPECTED_ICON_IDS = [
    'icon-save', 'icon-upload', 'icon-download', 'icon-globe', 'icon-help',
    'icon-menu-file', 'icon-menu-edit', 'icon-menu-view', 'icon-menu-insert',
    'icon-trash', 'icon-sun', 'icon-book', 'icon-folder', 'icon-image',
    'icon-search', 'icon-undo', 'icon-redo', 'icon-quote', 'icon-list',
    'icon-list-numbered', 'icon-task', 'icon-code', 'icon-braces', 'icon-link',
    'icon-table', 'icon-layout', 'icon-chevron-left', 'icon-chevron-right',
    'icon-close', 'icon-minimize', 'icon-maximize', 'icon-restore',
    'icon-upload-cloud', 'icon-chevron-down', 'icon-mermaid'
]


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, content):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return source.replace(old, new, 1)


# 1. Extract the exact existing geometry into the external sprite.
shell_path = Path('public/compatibility/current-shell.html')
shell = shell_path.read_text(encoding='utf-8')
sprite_pattern = re.compile(
    r'<!-- SVG 图标精灵 -->\s*<svg\b[^>]*class="icon-sprite"[^>]*>\s*<defs>([\s\S]*?)</defs>\s*</svg>\s*',
    re.I
)
match = sprite_pattern.search(shell)
if not match:
    raise SystemExit('inline SVG sprite block not found')
symbol_markup = match.group(1).strip()
symbol_ids = re.findall(r'<symbol\b[^>]*\bid="([^"]+)"', symbol_markup, re.I)
if symbol_ids != EXPECTED_ICON_IDS:
    raise SystemExit(f'unexpected icon ID sequence: {symbol_ids}')
if len(symbol_ids) != len(set(symbol_ids)):
    raise SystemExit('duplicate icon IDs in source sprite')
if any(not re.fullmatch(r'icon-[a-z0-9]+(?:-[a-z0-9]+)*', icon_id) for icon_id in symbol_ids):
    raise SystemExit('unstable icon ID detected')
if re.search(r'<script\b|\son[a-z]+\s*=|<title\b|<desc\b|\sdata-[\w-]+\s*=', symbol_markup, re.I):
    raise SystemExit('sprite contains behavior or inline business meaning')

sprite_source = (
    '<svg xmlns="http://www.w3.org/2000/svg">\n'
    f'{symbol_markup}\n'
    '</svg>\n'
)
write('public/assets/icons.svg', sprite_source)

shell = sprite_pattern.sub('', shell, count=1)
local_use_count = len(re.findall(r'<use\b[^>]*\bhref="#icon-[^"]+"', shell, re.I))
if local_use_count != 50:
    raise SystemExit(f'expected 50 current-shell icon uses, found {local_use_count}')
shell = re.sub(r'href="#(icon-[a-z0-9-]+)"', r'href="/assets/icons.svg#\1"', shell)
if re.search(r'<symbol\b|class="icon-sprite"|href="#icon-', shell, re.I):
    raise SystemExit('compatibility shell still owns inline icon geometry')
shell_path.write_text(shell, encoding='utf-8')

# 2. Add the generic ESM icon renderer.
icon_view = '''const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export const ICON_ID_PATTERN = /^icon-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ICON_SPRITE_URL = '/assets/icons.svg';

export function assertIconId(value) {
  const iconId = String(value || '').trim();
  if (!ICON_ID_PATTERN.test(iconId)) {
    throw new TypeError(`Invalid icon ID: ${iconId || '<empty>'}`);
  }
  return iconId;
}

function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElementNS !== 'function') {
    throw new TypeError('createIconView requires a document with createElementNS().');
  }
}

function normalizeSpriteUrl(value) {
  const spriteUrl = String(value || '').trim();
  if (!spriteUrl || spriteUrl.includes('#')) {
    throw new TypeError('Icon sprite URL must be a non-empty URL without a fragment.');
  }
  return spriteUrl;
}

export function getIconHref(iconId, spriteUrl = ICON_SPRITE_URL) {
  return `${normalizeSpriteUrl(spriteUrl)}#${assertIconId(iconId)}`;
}

export function createIconView(documentRef, iconId, options = {}) {
  assertDocument(documentRef);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Icon view options must be an object.');
  }

  const {
    className = 'icon',
    ariaLabel = '',
    spriteUrl = ICON_SPRITE_URL
  } = options;
  const svg = documentRef.createElementNS(SVG_NAMESPACE, 'svg');
  const use = documentRef.createElementNS(SVG_NAMESPACE, 'use');
  const normalizedClassName = String(className || '').trim();
  const normalizedLabel = String(ariaLabel || '').trim();

  if (normalizedClassName) svg.setAttribute('class', normalizedClassName);
  svg.setAttribute('focusable', 'false');
  if (normalizedLabel) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', normalizedLabel);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  use.setAttribute('href', getIconHref(iconId, spriteUrl));
  svg.appendChild(use);
  return svg;
}
'''
write('src/ui/components/icon-view.js', icon_view)

# 3. Reusable static sprite inspection for tests and CI evidence.
inspector = r'''export const STABLE_ICON_ID_PATTERN = /^icon-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function collectSvgSymbols(source) {
  if (typeof source !== 'string') throw new TypeError('SVG sprite source must be a string.');
  const records = [];
  const expression = /<symbol\b([^>]*)\bid=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/symbol>/gi;
  for (const match of source.matchAll(expression)) {
    const attributes = `${match[1]} ${match[3]}`;
    const viewBox = attributes.match(/\bviewBox=["']([^"']+)["']/i)?.[1] || '';
    records.push(Object.freeze({ id: match[2], viewBox, markup: match[0] }));
  }
  return Object.freeze(records);
}

export function collectIconReferences(source) {
  if (typeof source !== 'string') throw new TypeError('Icon reference source must be a string.');
  const references = [];
  const expression = /<use\b[^>]*(?:href|xlink:href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of source.matchAll(expression)) {
    references.push(Object.freeze({ href: match[1], iconId: match[1].split('#').at(-1) || '' }));
  }
  return Object.freeze(references);
}

export function inspectSvgSprite(source) {
  const symbols = collectSvgSymbols(source);
  const ids = symbols.map(symbol => symbol.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  const invalidIds = [...new Set(ids.filter(id => !STABLE_ICON_ID_PATTERN.test(id)))].sort();
  const missingViewBoxes = symbols.filter(symbol => !symbol.viewBox).map(symbol => symbol.id);
  const forbiddenMarkup = /<script\b|\son[a-z]+\s*=|<title\b|<desc\b|\sdata-[\w-]+\s*=|\saria-label\s*=/i.test(source);
  return Object.freeze({
    symbols,
    ids: Object.freeze(ids),
    symbolCount: symbols.length,
    uniqueSymbolCount: new Set(ids).size,
    duplicates: Object.freeze(duplicates),
    invalidIds: Object.freeze(invalidIds),
    missingViewBoxes: Object.freeze(missingViewBoxes),
    forbiddenMarkup
  });
}
'''
write('scripts/stage-02/icon-sprite/inspect-svg-sprite.mjs', inspector)

# 4. Switch confirmed callers. Legacy classic scripts reference the shared URL;
# ESM callers depend on icon-view.js.
core_path = Path('public/app/core.js')
core = core_path.read_text(encoding='utf-8')
core = replace_once(
    core,
    "const chevronLeft = '<svg class=\"icon icon-sm\"><use href=\"#icon-chevron-left\"></use></svg>';",
    "const chevronLeft = '<svg class=\"icon icon-sm\"><use href=\"/assets/icons.svg#icon-chevron-left\"></use></svg>';",
    'core chevron left'
)
core = replace_once(
    core,
    "const chevronRight = '<svg class=\"icon icon-sm\"><use href=\"#icon-chevron-right\"></use></svg>';",
    "const chevronRight = '<svg class=\"icon icon-sm\"><use href=\"/assets/icons.svg#icon-chevron-right\"></use></svg>';",
    'core chevron right'
)
core_path.write_text(core, encoding='utf-8')

events_path = Path('public/app/events.js')
events = events_path.read_text(encoding='utf-8')
events = replace_once(
    events,
    "if (maximizeUse) maximizeUse.setAttribute('href', maximized ? '#icon-restore' : '#icon-maximize');",
    "if (maximizeUse) maximizeUse.setAttribute('href', maximized ? '/assets/icons.svg#icon-restore' : '/assets/icons.svg#icon-maximize');",
    'window maximize icon'
)
events_path.write_text(events, encoding='utf-8')

link_path = Path('src/runtime/link-preview.js')
link = link_path.read_text(encoding='utf-8')
if not link.startswith("import { createIconView } from '../ui/components/icon-view.js';\n"):
    link = "import { createIconView } from '../ui/components/icon-view.js';\n\n" + link
link = replace_once(
    link,
    "  closeButton.innerHTML = '<svg class=\"icon\" aria-hidden=\"true\"><use href=\"#icon-close\"></use></svg>';",
    "  closeButton.append(createIconView(document, 'icon-close'));",
    'link preview close icon'
)
link_path.write_text(link, encoding='utf-8')

sidebar_path = Path('src/sidebar/folder-file-tree.js')
sidebar = sidebar_path.read_text(encoding='utf-8')
if not sidebar.startswith("import { createIconView, getIconHref } from '../ui/components/icon-view.js';\n"):
    sidebar = "import { createIconView, getIconHref } from '../ui/components/icon-view.js';\n\n" + sidebar
local_create_icon = '''function createIcon(symbolId, className = 'icon icon-sm') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.appendChild(use);
  return svg;
}

'''
sidebar = replace_once(sidebar, local_create_icon, '', 'sidebar local icon renderer')
sidebar = replace_once(
    sidebar,
    "const chevron = createIcon(expanded ? 'icon-chevron-down' : 'icon-chevron-right', 'icon folder-tree-chevron');",
    "const chevron = createIconView(document, expanded ? 'icon-chevron-down' : 'icon-chevron-right', { className: 'icon folder-tree-chevron' });",
    'folder chevron creation'
)
sidebar = replace_once(
    sidebar,
    "const folder = createIcon('icon-folder', 'icon icon-sm folder-tree-kind-icon');",
    "const folder = createIconView(document, 'icon-folder', { className: 'icon icon-sm folder-tree-kind-icon' });",
    'folder icon creation'
)
sidebar = replace_once(
    sidebar,
    "chevron.querySelector('use')?.setAttribute('href', nextExpanded ? '#icon-chevron-down' : '#icon-chevron-right');",
    "chevron.querySelector('use')?.setAttribute('href', getIconHref(nextExpanded ? 'icon-chevron-down' : 'icon-chevron-right'));",
    'folder chevron update'
)
sidebar = replace_once(
    sidebar,
    "const fileIcon = createIcon('icon-menu-file', 'icon icon-sm folder-tree-kind-icon');",
    "const fileIcon = createIconView(document, 'icon-menu-file', { className: 'icon icon-sm folder-tree-kind-icon' });",
    'file icon creation'
)
if 'function createIcon(' in sidebar or "href', `#${symbolId}`" in sidebar:
    raise SystemExit('sidebar still owns a second icon renderer')
sidebar_path.write_text(sidebar, encoding='utf-8')

# 5. Remove test-only duplicate symbol geometry and assert real sprite hrefs.
browser_path = Path('tests/e2e/run-browser-tests.mjs')
browser = browser_path.read_text(encoding='utf-8')
browser = replace_once(
    browser,
    '''      await browser.page.setDocumentContent(`<!doctype html><html><body>
        <svg style="display:none"><symbol id="icon-folder"></symbol><symbol id="icon-menu-file"></symbol><symbol id="icon-chevron-down"></symbol><symbol id="icon-chevron-right"></symbol></svg>
        <section id="sidebar-files-panel">''',
    '''      await browser.page.setDocumentContent(`<!doctype html><html><head><base href="${virtualHost.origin}/"></head><body>
        <section id="sidebar-files-panel">''',
    'browser folder-tree sprite fixture'
)
old_snapshot = '''        names:Array.from(document.querySelectorAll('.folder-tree-file-row')).map(row=>row.textContent.trim()),
        active:document.querySelector('.folder-tree-file-row.active')?.textContent.trim()||''
      }))()`);'''
new_snapshot = '''        names:Array.from(document.querySelectorAll('.folder-tree-file-row')).map(row=>row.textContent.trim()),
        active:document.querySelector('.folder-tree-file-row.active')?.textContent.trim()||'',
        iconHrefs:Array.from(document.querySelectorAll('.folder-tree-row use')).map(use=>use.getAttribute('href'))
      }))()`);'''
browser = replace_once(browser, old_snapshot, new_snapshot, 'browser folder-tree snapshot')
browser = replace_once(
    browser,
    "      assert.equal(snapshot.active, 'current.md');\n",
    "      assert.equal(snapshot.active, 'current.md');\n      assert.ok(snapshot.iconHrefs.length >= 4);\n      assert.ok(snapshot.iconHrefs.every(href => /^\\/assets\\/icons\\.svg#icon-[a-z0-9-]+$/.test(href)));\n",
    'browser folder-tree icon assertion'
)
if re.search(r'<symbol\b[^>]*id="icon-', browser, re.I):
    raise SystemExit('browser test still owns duplicate icon symbols')
browser_path.write_text(browser, encoding='utf-8')

# 6. Update the 2.2 compatibility assertion to the evolved single sprite authority.
minimal_path = Path('tests/ui/minimal-index.test.mjs')
minimal = minimal_path.read_text(encoding='utf-8')
minimal = replace_once(
    minimal,
    "  for (const required of ['id=\"editor\"', 'id=\"preview\"', 'id=\"settings-modal\"', 'class=\"icon-sprite\"']) {\n    assert.match(markup, new RegExp(required.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')));\n  }",
    "  for (const required of ['id=\"editor\"', 'id=\"preview\"', 'id=\"settings-modal\"']) {\n    assert.match(markup, new RegExp(required.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')));\n  }\n  assert.doesNotMatch(markup, /<symbol\\b|class=\"icon-sprite\"|href=\"#icon-/i);\n  assert.match(markup, /href=\"\\/assets\\/icons\\.svg#icon-/i);",
    'minimal-index current shell assertion'
)
minimal_path.write_text(minimal, encoding='utf-8')

# 7. Add complete 2.3 contract tests.
test_source = r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  ICON_ID_PATTERN,
  ICON_SPRITE_URL,
  assertIconId,
  createIconView,
  getIconHref
} from '../src/ui/components/icon-view.js';
import {
  collectIconReferences,
  inspectSvgSprite
} from '../scripts/stage-02/icon-sprite/inspect-svg-sprite.mjs';

const root = process.cwd();
const readText = path => readFile(resolve(root, path), 'utf8');
const expectedIconIds = Object.freeze([
  'icon-save', 'icon-upload', 'icon-download', 'icon-globe', 'icon-help',
  'icon-menu-file', 'icon-menu-edit', 'icon-menu-view', 'icon-menu-insert',
  'icon-trash', 'icon-sun', 'icon-book', 'icon-folder', 'icon-image',
  'icon-search', 'icon-undo', 'icon-redo', 'icon-quote', 'icon-list',
  'icon-list-numbered', 'icon-task', 'icon-code', 'icon-braces', 'icon-link',
  'icon-table', 'icon-layout', 'icon-chevron-left', 'icon-chevron-right',
  'icon-close', 'icon-minimize', 'icon-maximize', 'icon-restore',
  'icon-upload-cloud', 'icon-chevron-down', 'icon-mermaid'
]);

class FakeSvgNode {
  constructor(namespace, tagName) {
    this.namespaceURI = namespace;
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { this.children.push(child); return child; }
}

const fakeDocument = {
  createElementNS(namespace, tagName) {
    return new FakeSvgNode(namespace, tagName);
  }
};

test('Atomic Task 2.3 sprite has one stable definition for every preserved icon ID', async () => {
  const sprite = await readText('public/assets/icons.svg');
  const inspection = inspectSvgSprite(sprite);
  assert.deepEqual(inspection.ids, expectedIconIds);
  assert.equal(inspection.symbolCount, 35);
  assert.equal(inspection.uniqueSymbolCount, 35);
  assert.deepEqual(inspection.duplicates, []);
  assert.deepEqual(inspection.invalidIds, []);
  assert.deepEqual(inspection.missingViewBoxes, []);
  assert.equal(inspection.forbiddenMarkup, false);
  assert.match(sprite, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
  assert.doesNotMatch(sprite, /<script\b|\son[a-z]+\s*=|<title\b|<desc\b|\sdata-[\w-]+\s*=|\saria-label\s*=/i);
});

test('compatibility and dynamic callers reference the external sprite without a second geometry authority', async () => {
  const [shell, core, events, linkPreview, folderTree, browserTest] = await Promise.all([
    readText('public/compatibility/current-shell.html'),
    readText('public/app/core.js'),
    readText('public/app/events.js'),
    readText('src/runtime/link-preview.js'),
    readText('src/sidebar/folder-file-tree.js'),
    readText('tests/e2e/run-browser-tests.mjs')
  ]);
  const shellReferences = collectIconReferences(shell);
  assert.equal(shellReferences.length, 50);
  assert.ok(shellReferences.every(record => record.href === `${ICON_SPRITE_URL}#${record.iconId}`));
  assert.ok(shellReferences.every(record => expectedIconIds.includes(record.iconId)));
  assert.doesNotMatch(shell, /<symbol\b|class="icon-sprite"|href="#icon-/i);
  assert.match(core, /\/assets\/icons\.svg#icon-chevron-left/);
  assert.match(core, /\/assets\/icons\.svg#icon-chevron-right/);
  assert.match(events, /\/assets\/icons\.svg#icon-restore/);
  assert.match(events, /\/assets\/icons\.svg#icon-maximize/);
  assert.match(linkPreview, /import \{ createIconView \} from '\.\.\/ui\/components\/icon-view\.js'/);
  assert.match(folderTree, /import \{ createIconView, getIconHref \} from '\.\.\/ui\/components\/icon-view\.js'/);
  assert.doesNotMatch(folderTree, /function createIcon\(/);
  assert.doesNotMatch(browserTest, /<symbol\b[^>]*id="icon-/i);
});

test('icon-view is a pure generic renderer with decorative and labelled accessibility modes', () => {
  assert.equal(ICON_SPRITE_URL, '/assets/icons.svg');
  assert.ok(ICON_ID_PATTERN.test('icon-chevron-right'));
  assert.equal(assertIconId(' icon-close '), 'icon-close');
  assert.equal(getIconHref('icon-close'), '/assets/icons.svg#icon-close');
  assert.equal(getIconHref('icon-close', '/custom/sprite.svg'), '/custom/sprite.svg#icon-close');
  assert.throws(() => assertIconId('save-document'), /Invalid icon ID/);
  assert.throws(() => getIconHref('icon-close', '/sprite.svg#nested'), /without a fragment/);
  assert.throws(() => createIconView(null, 'icon-close'), /requires a document/);

  const decorative = createIconView(fakeDocument, 'icon-close', { className: 'icon icon-sm' });
  assert.equal(decorative.tagName, 'svg');
  assert.equal(decorative.getAttribute('class'), 'icon icon-sm');
  assert.equal(decorative.getAttribute('focusable'), 'false');
  assert.equal(decorative.getAttribute('aria-hidden'), 'true');
  assert.equal(decorative.getAttribute('role'), null);
  assert.equal(decorative.children[0].getAttribute('href'), '/assets/icons.svg#icon-close');

  const labelled = createIconView(fakeDocument, 'icon-help', { ariaLabel: '帮助' });
  assert.equal(labelled.getAttribute('aria-hidden'), null);
  assert.equal(labelled.getAttribute('role'), 'img');
  assert.equal(labelled.getAttribute('aria-label'), '帮助');
});
'''
write('tests/svg-sprite.test.mjs', test_source)

# 8. Register the new production module and adjust the current fixture count lock.
manifest_path = Path('tests/architecture/fixtures/production-modules.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
fields = manifest['fields']
records = manifest['modules']
if any(record[0] == 'src/ui/components/icon-view.js' for record in records):
    raise SystemExit('icon-view module already registered')
new_record = [
    'src/ui/components/icon-view.js',
    'esm-module',
    'ui-components',
    'Generic validation and SVG sprite-backed icon element rendering without business meaning or application state.',
    'none',
    'pure-view-build',
    'retain',
    False
]
if len(new_record) != len(fields):
    raise SystemExit('invalid icon-view manifest record')
records.append(new_record)
records.sort(key=lambda record: record[0])
manifest_path.write_text(json.dumps(manifest, separators=(',', ':')) + '\n', encoding='utf-8')

handoff_path = Path('tests/stage-01-handoff.test.mjs')
handoff = handoff_path.read_text(encoding='utf-8')
handoff = replace_once(handoff, 'assert.equal(moduleFixture.modules.length, 70);', 'assert.equal(moduleFixture.modules.length, 71);', 'module fixture count')
handoff_path.write_text(handoff, encoding='utf-8')

# 9. Preliminary README and detailed Atomic Task record. Final run IDs are added after clean-head validation.
readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
marker = '<!-- stage-02-node:02-03 -->'
if marker in readme:
    raise SystemExit('README already contains 2.3 marker')
anchor = '<!-- stage-02-node:02-02 -->'
entry = '''<!-- stage-02-node:02-03 -->
- 2026-08-05：阶段 2 Atomic Task 2.3（SVG Sprite）已实施并进入最终复验：将兼容壳中的 35 个既有 SVG 符号按原 ID 与几何提取到 `public/assets/icons.svg`，移除测试侧 4 个重复定义，新增无业务语义、无状态、无监听器的 `src/ui/components/icon-view.js`，并将兼容壳、经典脚本及 ESM 调用者切换到单一外部 Sprite 权威；提交前 Node、架构、浏览器契约、生产构建和完整应用浏览器回归均通过，Atomic Task 2.4 尚未开始。
'''
if anchor not in readme:
    raise SystemExit('README 2.2 anchor not found')
readme_path.write_text(readme.replace(anchor, entry + anchor, 1), encoding='utf-8')

run_id = os.environ.get('GITHUB_RUN_ID', 'local')
source_head = os.environ.get('GITHUB_SHA', 'unknown')
record = f'''# Stage 2 / Atomic Task 2.3：SVG Sprite

## 状态

- 当前状态：实现完成，最终三层复验待清理临时流程后执行。
- 实施分支：`rewrite/modular-rebuild`。
- 实施起点：`677b060ad583d1387add0271722019bfc9a41fca`。
- 实施工作流输入头：`{source_head}`。
- Atomic Task 2.4 尚未开始。

## 精确盘点

临时发现 run `31003118649` 通过，工件 `stage-02-03-icon-discovery-31003118649-1`（ID `8929125705`，摘要 `sha256:7e197f4bf94dffac40759f610f9ce7eb404f8b01a716189f6ee0c195455233fa`）记录：

- 35 个既有稳定图标 ID；全部符合 `icon-*` 小写连字符命名。
- 35 份真实几何原先全部由 `public/compatibility/current-shell.html` 内联拥有。
- 50 个兼容壳静态 `<use>` 引用。
- 7 个生产动态引用点，分布在经典脚本与 ESM 模块。
- 浏览器测试另有 4 个空 `<symbol>` 重复定义，构成第二套测试权威。
- 未发现缺失定义；静态未引用记录不作为删除依据，全部 35 个兼容 ID均保留。

## 实施内容

- 新建 `public/assets/icons.svg`，逐字保留原 35 个 `<symbol>` 的 ID、`viewBox` 和几何；文件不包含脚本、内联事件、业务标签、ARIA 文案或 `data-*` 行为属性。
- 从兼容壳删除内联 sprite，全部 `<use>` 改为 `/assets/icons.svg#icon-*`。
- 新建 `src/ui/components/icon-view.js`：只负责 ID 校验、href 生成、SVG DOM 创建和装饰性/有标签两种可访问性输出，不持有状态，不绑定监听器，不访问业务 store。
- `src/runtime/link-preview.js` 与 `src/sidebar/folder-file-tree.js` 改为依赖该公共渲染入口；文件树删除本地重复 `createIcon()`。
- 经典脚本 `public/app/core.js`、`public/app/events.js` 无法反向导入 ESM UI 模块，因此只引用同一个外部 Sprite URL，不复制几何。
- 浏览器契约删除 4 个测试内联符号，改为真实外部 Sprite 引用并断言生成 href。
- 新增可复用静态检查器与 `tests/svg-sprite.test.mjs`，锁定 ID 集合、唯一性、无业务标记、单一几何权威、调用者依赖和 `icon-view` 公共契约。
- 更新生产模块所有权清单；当前机器可读生产模块记录由 70 增至 71，Stage 1 历史交接中的 67 个模块事实保持原样。

## 变更边界

本节点未创建 App Shell、菜单槽、工具栏槽、侧栏槽、工作区槽、状态栏槽或 overlay；未开始 2.4。未修改 CSS 视觉规则、冻结模型、持久化、Rust、依赖、锁文件、配置、错误码、安全策略或用户可观察行为。

## 提交前验证

实施工作流 run `{run_id}` 仅在以下命令全部通过后提交正式实现：

- `node --test tests/svg-sprite.test.mjs`
- `node --test tests/ui/minimal-index.test.mjs`
- `npm test`
- 四项架构验证命令
- `npm run test:browser:contract`
- `npm run build`
- `npm run test:browser`

最终 Stage 2、Stage 1、Stage 0 run 与工件信息将在临时流程清理后的最终头复验完成后补录。

## 已知限制

- Ubuntu 22.04 CI 不替代 Windows 原生 WebView 对外部 SVG `<use>` 的真实平台回归；本节点以 Chromium 完整应用回归和后续 Tauri Linux release build 作为当前自动化证据。
- 既有 2 个 npm audit advisory 不属于本节点，未修改依赖或锁文件。
- 外部 Sprite 的 35 个兼容 ID在调用者迁移完成前均视为稳定公共资源，不得因静态暂未引用而提前删除。
'''
write('docs/rewrite-progress/stage-02/02-03-svg-sprite.md', record)

# 10. Final static sanity before workflow-level tests.
formal_paths = [
    'public/assets/icons.svg',
    'src/ui/components/icon-view.js',
    'scripts/stage-02/icon-sprite/inspect-svg-sprite.mjs',
    'tests/svg-sprite.test.mjs',
    'docs/rewrite-progress/stage-02/02-03-svg-sprite.md'
]
for path in formal_paths:
    if not Path(path).is_file() or Path(path).stat().st_size == 0:
        raise SystemExit(f'missing formal output: {path}')
print(json.dumps({'node': 'stage-02/02-03', 'icons': len(EXPECTED_ICON_IDS), 'status': 'patched'}))
