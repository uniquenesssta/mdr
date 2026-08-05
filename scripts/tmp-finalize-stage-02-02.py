from pathlib import Path

README_OLD = '- 2026-08-05：阶段 2 Atomic Task 2.2（最小 index.html）已实施并进入最终收口复验：入口缩减为 head、#app-root 与单一模块入口，旧 DOM 移至唯一阶段兼容资产并通过独立挂载模块运行；构建后浏览器测试继续硬性要求模块入口，允许 CSS 由模块图加载，并由模块入口唯一加载 i18n 后真实执行完整应用回归；Atomic Task 2.3 尚未开始。'
README_NEW = '- 2026-08-05：阶段 2 Atomic Task 2.2（最小 index.html）完成收口：入口仅保留标准 head、`#app-root` 与单一模块入口，旧 DOM 由唯一阶段兼容挂载链承载；构建后浏览器资产解析继续硬性要求模块脚本，允许 CSS 由模块图加载，并移除测试侧重复 i18n 注入以保持模块入口单一所有权。实现头 `f30d0b674348b607f696f4b1e27c39193acd70fd` 的 Stage 2 run `31000219098`、Stage 1 run `31000219093`、Stage 0 run `31000219107` 全部通过；未修改生产行为、依赖或锁文件，Atomic Task 2.3 尚未开始。'

readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
if README_OLD not in readme:
    raise SystemExit('README 2.2 closeout entry not found')
readme_path.write_text(readme.replace(README_OLD, README_NEW, 1), encoding='utf-8')

record = '''# Stage 2 / Atomic Task 2.2：最小 index.html

## 状态

- 当前状态：完成。
- 实现验证头：`f30d0b674348b607f696f4b1e27c39193acd70fd`。
- 实施分支：`rewrite/modular-rebuild`。
- Atomic Task 2.3 尚未开始。

## 已实施内容

- `index.html` 仅保留标准文档 head、`#app-root` 和单一模块入口。
- 旧业务 DOM 迁移到唯一阶段兼容资产，由职责独立的挂载与启动模块加载。
- 冻结模型、持久化格式、依赖、锁文件、CSS、Rust 和既有用户行为保持不变。

## 收口阻塞与精确根因

Stage 0 run `30997931980` 的最终硬门禁失败。工件 `stage-00-baseline-30997931980-1` 证明唯一失败的必需检查是 `browser-app`：`npm run test:browser` 在启动浏览器前解析 `dist/index.html` 时，同时强制要求模块脚本和独立 `<link rel="stylesheet">`。2.2 将 CSS 保持为 `src/main.js` 模块图的一部分，而入口通过动态模块加载，因此 Vite 不再保证初始 HTML 含独立 stylesheet 标签；模块脚本、Node 测试、浏览器契约、构建、Rust 和 Tauri 链路本身均未失败。

首次收口验证 run `30999898039` 修复资产发现后，完整应用已启动并通过 7 项交互，随后捕获 `Identifier 'i18n' has already been declared`。原因是旧浏览器测试仍手动注入 `i18n.js`，而 2.2 模块入口已承担同一加载职责，形成测试侧与生产入口的双重所有权。该失败发生在提交前，未推送未经验证的正式修复。

## 收口修复

- 新增 `tests/e2e/lib/built-application-assets.mjs`，单独负责解析构建入口资产。
- 模块脚本继续作为硬性契约；缺失时立即失败。
- 独立 stylesheet 标签改为可选：存在时仍单独加载，不存在时由真实模块图加载 CSS。
- 删除浏览器测试对 `i18n.js` 的手动注入，由 `src/bootstrap/module-entry.js` 保持唯一加载所有权。
- `tests/e2e/run-browser-tests.mjs` 继续真实导入构建模块、等待 `app-ready`、验证 E2E bridge 并执行完整应用交互回归，不跳过、不静默忽略、不弱化失败。
- 新增 `tests/built-application-assets.test.mjs`，覆盖模块图 CSS、独立 stylesheet 兼容和模块入口缺失三条路径。

## 变更范围

最终正式净变更仅包含：

- `README.md`
- `docs/rewrite-progress/stage-02/02-02-minimal-index.md`
- `tests/built-application-assets.test.mjs`
- `tests/e2e/lib/built-application-assets.mjs`
- `tests/e2e/run-browser-tests.mjs`

未修改生产源码、`index.html` 的既有 2.2 实现、CSS、Rust、依赖、`package-lock.json`、冻结模型或持久化结构。

## 验证结果

实现验证头 `f30d0b674348b607f696f4b1e27c39193acd70fd`：

- Stage 2 Atomic Verification：run `31000219098`，通过。
  - 工件：`stage-02-ui-foundation-31000219098-1`
  - 工件 ID：`8928053802`
  - 摘要：`sha256:9b34fd463768324229e91fcc15617f69d33c513ae8084a73259183d231981517`
- Stage 1 Atomic Verification：run `31000219093`，通过。
  - 工件：`stage-01-architecture-foundation-31000219093-1`
  - 工件 ID：`8927923039`
  - 摘要：`sha256:1bce395898da9c0594f437e581966bb159c6d71d26f30a5b6040fdc07126939b`
- Stage 0 Baseline Verification：run `31000219107`，通过。
  - 工件：`stage-00-baseline-31000219107-1`
  - 工件 ID：`8928138007`
  - 摘要：`sha256:efcfc5e48e7cd58a87ba2a0868a5ef83f60611e510e1c7467db6705bd5398775`

实际覆盖：Node 回归、四项架构验证、2.1 历史盘点、2.2 最小入口契约、浏览器交互契约、前端生产构建、构建后完整应用浏览器回归、`cargo test --locked`、`cargo check --locked`、Tauri Linux release build 和最终硬门禁。

## 已知限制

- Ubuntu 22.04 CI 不替代 Windows 原生窗口、文件关联和系统拖放真实验证。
- 既有 2 个 npm audit advisory 仍保留；本节点未修改依赖或锁文件。
- 阶段兼容 DOM 仍是后续 2.3 至 2.6 及 Feature 迁移的删除候选，不能在未完成对应迁移和回归前提前移除。
'''
Path('docs/rewrite-progress/stage-02/02-02-minimal-index.md').write_text(record, encoding='utf-8')
