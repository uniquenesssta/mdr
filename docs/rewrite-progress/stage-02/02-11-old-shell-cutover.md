# Stage 2 / Atomic Task 2.11：旧壳切换

## 结果

生产启动链现在只由 `createUI()` 创建唯一 App Shell。未迁移业务内容继续通过临时兼容挂载端口接入严格命名的 App Shell refs，但该端口不再创建、替换或销毁壳结构；旧壳命名、旧壳资产路径和旧壳挂载入口已从生产代码删除。

## 实施内容

- `src/bootstrap/module-entry.js` 先调用 `createUI(root)`，再创建 `createCompatibilityBusinessContentPort(root, ui)` 并挂载兼容业务模板。
- 将 `public/compatibility/current-shell.html` 重命名为 `public/compatibility/business-content.html`，文件只保留 `menu/toolbar/sidebar/editor/preview/status/overlay/ports` 八组业务模板，不包含 `.app`、workspace、sidebar 或 statusbar 壳包装。
- 将 `mount-current-shell.js` 替换为 `business-content-port.js`；端口只接收注入的 App Shell refs，拥有模板解析、节点挂载、主题默认值、兼容模态桥和精确清理。
- 新增 `src/ui/compatibility/index.js` 作为兼容目录唯一公共入口。
- 隐藏文件端口挂入 `overlay-root` 下的 `#compatibility-business-ports`，`#app-root` 生产子节点保持为唯一 App Shell 与 overlay root。
- 端口支持首次挂载、重复挂载拒绝、失败回滚、幂等销毁和销毁后拒绝再次挂载；销毁兼容端口时 App Shell 保持存在，随后 `createUI.destroy()` 仍精确恢复原根节点。
- Stage 16 Atomic Task 16.8 已明确登记删除 `business-content.html`、业务内容端口、兼容模态桥和兼容公共入口的后续任务。

## 保持不变

- 未修改文档、编辑、预览、保存、导出、国际化或其他业务行为。
- 未修改公共业务接口、持久化格式、冻结模型、Rust/Tauri、依赖或锁文件。
- 经典业务脚本、内联事件及现有模态请求事件仍按原兼容链工作；本任务只改变壳与兼容业务内容之间的所有权边界。
- 依赖审计继续记录既有 `1 low / 1 high`，按用户决定留到全部任务完成后的本地真实运行测试阶段再决定。

## 验证

### 当前容器

- 2.1–2.11 UI 专项、相关架构契约及依赖无关扩大回归 `62/62` 通过；完整 Stage 1 动态导入仍因容器缺少锁文件依赖 `marked` 无法执行。
- 浏览器交互契约 `10/10`，新增场景验证临时端口挂载、重复挂载、独立销毁、App Shell 保留和根节点恢复。
- JavaScript 语法检查、模块清单契约和 `git diff --check` 通过。
- 当前容器无法完成 `npm ci`、生产构建及构建后真实应用回归；完整依赖环境验证由 GitHub Actions 执行。

### GitHub 受控验证

- Run：`31079284014`，attempt `1`；Node `22.23.1`，npm `10.9.8`。
- 载荷 Base64、gzip、patch、Atomic Task 2.10 父提交、23 文件清单及实现 tree 全部通过独立 SHA-256 / Git tree 硬门禁。
- Stage 1 历史交接 `4/4`，Atomic Task 2.1–2.11 各专项全部通过，架构硬门禁通过。
- `npm test`：`36/36`。
- 浏览器交互契约：`10/10`，包含临时兼容业务端口首次挂载、重复挂载拒绝、独立销毁、App Shell 保留及根节点恢复。
- 生产构建：通过，Vite 转换 `2179` 个模块；仅保留既有大于 500 kB chunk 警告，本任务未调整构建门限。
- 构建后真实应用回归：`12/12`，既有六组响应式壳、主题、模态、链接预览、布局、编辑、Mermaid 与指针交互均通过。
- 证据制品：`atomic-2-11-controlled-31079284014-1`，artifact `8958792881`，共 12 个文件，zip SHA-256 `8235b1fb43f5c64a10ea03ccc2a7e7d9ab109fcd7ffb92829d2552d30fe743e3`。
- `npm ci` 仍报告既有 `1 low / 1 high`；未运行 `npm audit fix`，未修改依赖或锁文件。

## 边界与后续

- Stage 2 的 2.1–2.11 实施节点已完成；只有最终 Stage 0/1/2 门禁全部通过后，阶段 2 才可正式交接给 Stage 3。
- 临时兼容业务内容端口不是长期架构，删除所有权固定在 Stage 16 Atomic Task 16.8。
