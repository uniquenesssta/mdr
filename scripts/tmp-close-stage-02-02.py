from pathlib import Path

HELPER = r'''const MODULE_SCRIPT_PATTERN = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>\s*<\/script>/i;
const STYLESHEET_PATTERN = /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i;
const I18N_SCRIPT_PATTERN = /<script\s+src=["']\/i18n\.js["']><\/script>/i;

function normalizeOrigin(origin) {
  if (typeof origin !== 'string' || origin.trim() === '') {
    throw new TypeError('Built application origin must be a non-empty string.');
  }
  return `${origin.replace(/\/+$/, '')}/`;
}

export function prepareBuiltApplicationDocument(html, origin) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new TypeError('Built application HTML must be a non-empty string.');
  }

  const baseUrl = normalizeOrigin(origin);
  const moduleMatch = html.match(MODULE_SCRIPT_PATTERN);
  if (!moduleMatch) {
    throw new Error('Unable to locate built application module asset.');
  }

  const stylesheetMatch = html.match(STYLESHEET_PATTERN);
  let preparedHtml = html
    .replace('<head>', `<head><base href="${baseUrl}">`)
    .replace(moduleMatch[0], '')
    .replace(I18N_SCRIPT_PATTERN, '');

  if (stylesheetMatch) preparedHtml = preparedHtml.replace(stylesheetMatch[0], '');

  return Object.freeze({
    html: preparedHtml,
    moduleUrl: new URL(moduleMatch[1], baseUrl).href,
    stylesheetUrl: stylesheetMatch ? new URL(stylesheetMatch[1], baseUrl).href : null
  });
}
'''

TEST = r'''import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBuiltApplicationDocument } from './e2e/lib/built-application-assets.mjs';

test('module-only Vite output delegates stylesheet loading to the module graph', () => {
  const result = prepareBuiltApplicationDocument(
    '<!doctype html><html><head></head><body><div id="app-root"></div><script type="module" crossorigin src="/assets/app.js"></script></body></html>',
    'https://markdown-editor-app.test'
  );

  assert.equal(result.moduleUrl, 'https://markdown-editor-app.test/assets/app.js');
  assert.equal(result.stylesheetUrl, null);
  assert.match(result.html, /<base href="https:\/\/markdown-editor-app\.test\/">/);
  assert.doesNotMatch(result.html, /<script\b[^>]*type=["']module["']/i);
});

test('extracted stylesheet remains supported without becoming mandatory', () => {
  const result = prepareBuiltApplicationDocument(
    '<html><head><link crossorigin rel="stylesheet" href="/assets/app.css"></head><body><script src="/i18n.js"></script><script src="/assets/app.js" type="module"></script></body></html>',
    'https://markdown-editor-app.test/'
  );

  assert.equal(result.moduleUrl, 'https://markdown-editor-app.test/assets/app.js');
  assert.equal(result.stylesheetUrl, 'https://markdown-editor-app.test/assets/app.css');
  assert.doesNotMatch(result.html, /stylesheet/i);
  assert.doesNotMatch(result.html, /i18n\.js/i);
});

test('built application module remains a hard requirement', () => {
  assert.throws(
    () => prepareBuiltApplicationDocument('<html><head></head><body></body></html>', 'https://markdown-editor-app.test'),
    /Unable to locate built application module asset/
  );
});
'''

RECORD = '''# Stage 2 / Atomic Task 2.2：最小 index.html

## 状态

- 当前状态：最终收口复验中。
- 实施分支：`rewrite/modular-rebuild`。
- Atomic Task 2.3 尚未开始。

## 已实施内容

- `index.html` 仅保留标准文档 head、`#app-root` 和单一模块入口。
- 旧业务 DOM 迁移到唯一阶段兼容资产，由职责独立的挂载与启动模块加载。
- 冻结模型、持久化格式、依赖、锁文件、CSS、Rust 和既有用户行为保持不变。

## 收口阻塞与根因

Stage 0 run `30997931980` 的最终硬门禁失败。工件 `stage-00-baseline-30997931980-1` 证明唯一失败的必需检查是 `browser-app`：`npm run test:browser` 在启动浏览器前解析 `dist/index.html` 时，同时强制要求模块脚本和独立 `<link rel="stylesheet">`。2.2 将 CSS 保持为 `src/main.js` 模块图的一部分，而入口通过动态模块加载，因此 Vite 不再保证初始 HTML 含独立 stylesheet 标签；模块脚本、Node 测试、浏览器契约、构建、Rust 和 Tauri 链路本身均未失败。

## 收口修复

- 新增 `tests/e2e/lib/built-application-assets.mjs`，单独负责解析构建入口资产。
- 模块脚本继续作为硬性契约；缺失时立即失败。
- 独立 stylesheet 标签改为可选：存在时仍单独加载，不存在时由真实模块图加载 CSS。
- `tests/e2e/run-browser-tests.mjs` 继续真实导入构建模块、等待 `app-ready`、验证 E2E bridge 并执行完整应用交互回归，不跳过、不弱化失败。
- 新增 `tests/built-application-assets.test.mjs`，覆盖模块图 CSS、独立 stylesheet 兼容和模块入口缺失三条路径。

## 验证

提交前执行：`npm test`、四项架构验证、`npm run test:browser:contract`、`npm run build`、`npm run test:browser`。最终 Stage 2、Stage 1 和 Stage 0 run 信息将在清理临时流程后的最终分支头复验通过后写入。

## 已知限制

- Ubuntu 22.04 CI 不替代 Windows 原生窗口、文件关联和系统拖放真实验证。
- 本节点不处理既有 npm audit advisory，也不修改依赖或锁文件。
'''

Path('tests/e2e/lib').mkdir(parents=True, exist_ok=True)
Path('tests/e2e/lib/built-application-assets.mjs').write_text(HELPER, encoding='utf-8')
Path('tests/built-application-assets.test.mjs').write_text(TEST, encoding='utf-8')

browser_path = Path('tests/e2e/run-browser-tests.mjs')
browser = browser_path.read_text(encoding='utf-8')
import_anchor = "import { installVirtualFileHost } from './lib/virtual-file-host.mjs';\n"
import_line = "import { prepareBuiltApplicationDocument } from './lib/built-application-assets.mjs';\n"
if import_line not in browser:
    if import_anchor not in browser:
        raise SystemExit('browser test import anchor not found')
    browser = browser.replace(import_anchor, import_anchor + import_line, 1)

old_block = r'''      let appHtml = await readFile(resolve(projectRoot, 'dist/index.html'), 'utf8');
      const moduleMatch = appHtml.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
      const styleMatch = appHtml.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
      if (!moduleMatch || !styleMatch) throw new Error('Unable to locate built application assets');
      const moduleUrl = new URL(moduleMatch[1], `${virtualHost.origin}/`).href;
      const styleUrl = new URL(styleMatch[1], `${virtualHost.origin}/`).href;
      appHtml = appHtml
        .replace('<head>', `<head><base href="${virtualHost.origin}/">`)
        .replace(moduleMatch[0], '')
        .replace(styleMatch[0], '')
        .replace(/<script src="\/i18n\.js"><\/script>/, '');'''
new_block = r'''      let appHtml = await readFile(resolve(projectRoot, 'dist/index.html'), 'utf8');
      const preparedApplication = prepareBuiltApplicationDocument(appHtml, virtualHost.origin);
      const { moduleUrl, stylesheetUrl } = preparedApplication;
      appHtml = preparedApplication.html;'''
if old_block not in browser:
    raise SystemExit('browser asset discovery block not found')
browser = browser.replace(old_block, new_block, 1)

old_style = r'''      await browser.page.evaluate(`new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href=${JSON.stringify(styleUrl)};link.onload=resolve;link.onerror=()=>reject(new Error('stylesheet failed'));document.head.appendChild(link);})`);'''
new_style = r'''      if (stylesheetUrl) {
        await browser.page.evaluate(`new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href=${JSON.stringify(stylesheetUrl)};link.onload=resolve;link.onerror=()=>reject(new Error('stylesheet failed'));document.head.appendChild(link);})`);
      }'''
if old_style not in browser:
    raise SystemExit('browser stylesheet loader not found')
browser_path.write_text(browser.replace(old_style, new_style, 1), encoding='utf-8')

readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
old_entry = '- 2026-08-05：阶段 2 Atomic Task 2.2（最小 index.html）已实施：入口缩减为 head、#app-root 与单一模块入口，旧 DOM 移至唯一阶段兼容资产并通过独立挂载模块运行；验证状态：passed；Atomic Task 2.3 尚未开始。'
new_entry = '- 2026-08-05：阶段 2 Atomic Task 2.2（最小 index.html）已实施并进入最终收口复验：入口缩减为 head、#app-root 与单一模块入口，旧 DOM 移至唯一阶段兼容资产并通过独立挂载模块运行；修复构建后浏览器测试对独立 stylesheet 标签的过时强制假设，继续硬性要求模块入口并真实执行完整应用回归；Atomic Task 2.3 尚未开始。'
if old_entry not in readme:
    raise SystemExit('README 2.2 entry not found')
readme_path.write_text(readme.replace(old_entry, new_entry, 1), encoding='utf-8')
Path('docs/rewrite-progress/stage-02/02-02-minimal-index.md').write_text(RECORD, encoding='utf-8')
