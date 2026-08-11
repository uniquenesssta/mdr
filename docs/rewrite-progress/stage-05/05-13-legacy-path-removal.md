# Atomic 5.13 — 删除旧路径

## 完成内容

- 删除 `public/app/editor-tools.js` 中 Atomic 5.9–5.12 已迁移的 History、基础格式化、插入和隐藏源码同步 wrapper；未搬动 Stage 6 布局/全屏、Stage 7 Mermaid 预览增强、Stage 8 Hybrid 可视编辑开关职责。
- 删除 `src/features/editor/compatibility/classic-editor-command-port.js` 与 `classic-editor-history-port.js`；`src/main.js` 直接组合 Editor Command Service / History Adapter，不保留 alias、facade 或第二实现。
- 删除 `#preview-source` 隐藏 textarea 及 `core/events/preview/web-clipper`、样式和性能采集中的对应兼容链；网页导入只通过 Frozen DocumentModel 事务写正文。
- 将“查找/清空/插入 3×3 表格”迁移入口改成声明式 `data-editor-action`，由 Stage 5 Editor View/Service 处理；清空仍保留原确认语义。
- `classic-editor-controller-port` 与 `classic-editor-ui-command-port` 只保留给尚未进入 Stage 6/7 的启动、布局、预览同步等跨阶段 classic caller；5.13 没有以它们重建已删除的 Command/History wrapper。
- 新增 Atomic 5.13 永久架构门禁，并把修改过的 classic scripts 语法解析纳入门禁，避免 `public/` 文件仅被 Vite 复制而未被构建解析。
- 删除隐藏 textarea 后，当前 production declarative i18n binding inventory 由 114 降为 113；历史 I18n service/fixture 行为测试保持原样，仅更新当前 DOM 清单断言。
- 更新精确 architecture baseline、production ownership fixture、Stage 5 workflow、根 README 与文档树职责说明。

## 影响与兼容性

Frozen DocumentModel、持久化格式、Settings key/default、Rust/Tauri DTO、生产依赖、安全与权限均未修改。编辑命令、撤销/重做、清空确认、网页导入和当前布局的用户可观察语义保持不变。

## 验证

最终纠正候选 `5107a5993753ad588b8cbbef56b37e71f08e8534` 已由 GitHub-hosted runner `31465613658` 按正式 Stage 5 workflow 粒度实际执行并全部通过：

- 候选 SHA、目标基线 `502785607f6df255d09d480eaa0f7fee6ebf0440` 与永久 workflow blob 锁定检查
- `npm run deps:prepare`
- `npm audit --audit-level=low`：0 vulnerabilities
- Vite parent KaTeX font serving gate
- Stage 4 handoff
- Atomic 5.1–5.13 全部分步单元/架构门禁
- CR-05 Stage 5 editor infrastructure conformance
- `npm run verify:architecture`
- Frozen DocumentModel blob 校验：`d767d9025be05a6f6b87d7cd3527782db1c3303a`
- `npm test`
- `npm run test:browser:contract`
- `npm run build`
- `npm run test:browser`

本记录更新只改变验收文档，不改变上述已验证的生产源码、测试逻辑或 workflow。发布前仍对含本记录的最终 tree 执行 Node、Atomic 5.13 与 Architecture/Frozen 门禁，并再次确认目标分支未移动；正式分支推送后由 `Stage 5 Atomic Verification` 再执行全链验证。

本地临时容器因 DNS 无法解析 `github.com`，未执行 clone/本地验证；真实 Node、浏览器、Build 和 built-app 验证均由 GitHub-hosted runner 完成。
