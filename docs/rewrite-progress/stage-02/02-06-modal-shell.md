# Stage 2 / Atomic Task 2.6：Modal Shell

## 状态

- 当前状态：完成。
- 实施分支：`rewrite/modular-rebuild`。
- 2.5 最终验证基线：`77ee167155dc3e36915cf8df15dc449dd3191898`。
- 2.6 实现验证头：`bce6146858f1e308c3e521b3e5f9139ff84f179d`。
- 下一节点：Atomic Task 2.7 尚未开始。

## 任务边界

本节点只迁移通用模态框生命周期：

1. `role="dialog"` / `role="alertdialog"` 与 `aria-modal="true"`。
2. 可访问名称、初始焦点、Tab 焦点约束和关闭后的焦点恢复。
3. Escape 与“事件目标恰好为遮罩根节点”的遮罩关闭策略。
4. 显示、过渡隐藏、关闭原因、关闭后立即重开时的过时结果取消。
5. 幂等 `destroy()`、监听器清理和接管前 DOM 状态恢复。

具体字段、字段校验、提交、取消业务副作用、导出任务状态和编辑器写回仍由原 Feature 拥有。本节点未修改 CSS 令牌、主题、样式分层、Rust、依赖、锁文件、持久化或冻结模型。

## 实施内容

### 通用组件

新增 `src/ui/components/modal-shell.js`，公开 `ModalShell`：

- `open(content, options)`：接收 Feature 提供的 DOM 内容或复用既有内容；校验角色、可访问名称、焦点目标、关闭策略和 `onClose`。
- `close(reason)`：立即撤销可见状态，等待过渡或超时后隐藏；关闭原因传回 Feature；焦点恢复只在该次关闭仍为最新生命周期时执行。
- `isOpen()`：只反映当前组件可见状态。
- `destroy()`：幂等移除全部监听器、取消过时隐藏、销毁焦点边界并恢复接管前属性、class 和 display。
- `isDestroyed()`：暴露组件销毁状态，不暴露业务状态。

组件只经 `src/ui/dom/index.js` 使用事件、焦点、引用校验和过渡可见性原语，不查询业务 Store，不拥有字段或提交行为。

### 兼容接管边界

新增 `src/ui/compatibility/mount-modal-shells.js`，只负责把现有九个兼容模态框接入通用组件：

- `settings-modal`
- `help-modal`
- `link-modal`
- `url-modal`
- `find-modal`
- `export-progress-modal`
- `export-image-modal`
- `image-modal`
- `mermaid-modal`

兼容桥为每个现有遮罩创建一个 `ModalShell`，集中定义默认可访问名称、初始焦点和关闭策略。导出进度模态框保持 Escape 与遮罩点击不可关闭，其余模态框默认允许两种关闭入口。

兼容 Feature 通过模态根节点上的显式事件端口请求生命周期操作：

- `markdown-editor:modal-shell-open`
- `markdown-editor:modal-shell-close`

事件结果和异常写回请求 `detail`，没有新增 `window.*`、`globalThis.*` 或经典脚本共享全局 API。`mount-current-shell.js` 在兼容 DOM 挂载完成后建立该桥，并在挂载失败或壳销毁时按逆序销毁。

### 旧权威删除

已从 `public/app/core.js`、`editor-tools.js`、`export.js`、`web-clipper.js` 删除九个模态框重复的 `display`、`show` class、延迟隐藏、Escape 和遮罩监听逻辑；`events.js` 不再单独拥有链接模态框 Escape/遮罩关闭。

保留在 Feature 内的行为包括：设置值同步、帮助页状态、链接/图片/Mermaid 写回、网页抓取状态、查找状态、导出任务进度与取消能力。Feature 清理通过 `onClose` 或既有关闭函数触发，Escape、遮罩和按钮关闭走同一生命周期出口。

## 模块、接口与兼容性

- 机器可读生产模块记录由 85 增至 87。
- `ui-components` 新增 `modal-shell.js`；`ui-compatibility` 新增 `mount-modal-shells.js`。
- 既有九个模态框 ID、HTML 字段、内联按钮函数、Feature 提交函数和业务数据格式保持不变。
- 没有新增经典脚本、业务全局、生产依赖、配置项、环境变量或持久化结构。
- 2.1 冻结 DOM 资产、184 个兼容内联事件、35 个图标 ID、50 个外部 Sprite 引用和 App Shell 七个严格 refs 保持不变。

## 当前验证结果

### 本地专项验证

- `node --test tests/ui/modal-shell.test.mjs`：6/6 通过。
- 2.1–2.6 UI 专项合并验证：24/24 通过。
- 修改的经典脚本、ESM 组件、兼容桥和浏览器测试 `node --check`：通过。
- `.github/workflows/stage-02-atomic.yml` YAML 解析与 `git diff --check`：通过。
- 本地 `npm ci` 被内部 npm 镜像缺少 `w3c-keyname@2.2.8` 阻塞；未修改依赖或锁文件绕过，完整验证转由 GitHub 的锁文件安装环境执行。

### GitHub 三层硬门禁

实现验证头 `bce6146858f1e308c3e521b3e5f9139ff84f179d`：

- Stage 2 run `31023414560`：2.1–2.6 专项、架构扫描、证据生成、完整 Node 回归、浏览器契约、生产构建和证据上传全部通过。
- Stage 1 run `31023414183`：架构基础、历史交接、完整 Node 回归、浏览器契约和生产构建全部通过。
- Stage 0 run `31023414280`：静态基线、完整 Node、浏览器契约、生产构建、构建后浏览器、Rust 测试、Rust check、Tauri Linux 构建和硬门禁全部通过。
- `npm ci` 审计仍报告既有 2 项依赖告警（1 low、1 high）；本任务未新增或升级依赖，未擅自执行依赖修复。

## 已知限制

- 本节点只建立通用 Modal Shell 和现有九个模态框的兼容接管，不迁移具体 Feature DOM 或提交逻辑。
- CSS 令牌、主题和样式分层属于 2.7 及后续节点，未提前实施。
- Ubuntu Chromium/Tauri CI 不能替代后续涉及桌面原生行为时的 Windows WebView、文件关联和系统拖放验证。
