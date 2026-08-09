# Stage 4 / Atomic Task 4.11：Theme Service

## 状态

- 当前状态：PASS。
- 基线：`8316d2c9a0d5f7da7bee20bec75ae40bf53b178b`（Atomic 4.10 最终 HEAD）。
- 受控 clean-runner：GitHub Actions run `31296539386`。
- 下一节点：Atomic 4.12 未开始。

## 任务边界

本节点只迁移主题职责：已验证且已提交的 Settings theme 由 Theme Service 应用到应用根 `data-theme`；显式主题切换入口由独立 Theme Toggle Controller 提交 Settings 命令。现有 `src/styles/themes/light.css` / `dark.css` 继续单一拥有语义视觉令牌。没有迁移编辑器、预览、渲染模型或持久化实现。

## 实施结果

### Theme Service

新增：

- `src/theme/index.js`：Theme 公共入口；
- `src/theme/theme-service.js`：提交态主题应用与 SettingsChanged 监听生命周期；
- `src/theme/theme-toggle-controller.js`：显式主题按钮监听与已提交 Settings 命令发起。

Theme Service：

- 启动时只消费 `settingsStore.snapshot` 的已验证 theme；
- 只处理 Settings 公共 `SETTINGS_CHANGED_EVENT` 中实际包含 `theme` 的提交事件；
- 使用 Settings Schema 的公开验证函数，不复制 light/dark 枚举权威；
- 只写显式根元素的 `data-theme`，不写 localStorage、不调用 Mermaid、不刷新 preview；
- 重复应用同一主题为幂等 no-op；
- destroy 解绑监听并恢复接管前 theme 属性，销毁后操作终止；
- 构造期 listener 部分安装失败时会解绑并恢复原始 theme 属性。

### Theme Toggle Controller 与 Settings 提交链

- `public/compatibility/business-content.html` 的旧 `onclick="toggleTheme()"` 改为无 inline handler 的 `data-theme-toggle` 显式挂点；
- 删除 `public/app/editor-tools.js` 的 classic `toggleTheme()`，不再保留调用已退出 `setAppTheme()` 的悬空路径；
- Theme Toggle Controller 只读取当前 committed theme，并从 Settings Schema 的允许值推导下一主题；
- `SettingsApplyCoordinator` 增加 immediate `commit(changes)`，与 draft Apply 共用同一个 immutable SettingsChanged 发布逻辑；持久化失败不会发布成功事件；
- Theme Toggle Controller 不写 DOM、不访问 Repository/localStorage，不拥有 Settings 状态。

### 组合与旧权威退出

- `src/bootstrap/module-entry.js` 在 Settings Store 创建后、经典应用导入前组合 Settings command coordinator、Theme Service 与 Theme Toggle Controller，并纳入显式销毁顺序；
- 删除 `public/app/core.js` 的 `setAppTheme()` 及 SettingsChanged 中的主题直接应用；
- 删除 `public/app/bootstrap.js` 的启动主题 DOM 写入与 Mermaid 初始化；
- classic 代码中不再存在 `setAppTheme()` / `toggleTheme()` 主题权威。

### CSS 与架构边界

- `src/styles/themes/light.css` 与 `dark.css` 保持 Stage 2 token-only 结构；Theme Service 不拥有或导入主题 CSS；
- Theme UI inline event 实例从 159 降至 158；没有新增白名单或豁免；
- 新增 3 个生产模块后当前生产模块清单从 230 增至 233；
- 未新增生产依赖。

## 根因修复记录

早期 clean-runner 的 Atomic 4.11 gate 暴露真实迁移缺口：`public/app/core.js` 的 `setAppTheme()` 已退出，但 `public/app/editor-tools.js::toggleTheme()` 仍调用该函数，且 toolbar 仍通过 inline `onclick` 调用 `toggleTheme()`。诊断 run `31292783548` 的 artifact `9031940248` 精确定位了该断言/运行时悬空调用。最终没有删除或弱化测试，而是把按钮调用链完整迁入 Theme Toggle Controller + Settings commit event 链。

另一次 clean-runner run `31293231683` 在 Materialize 阶段因临时 fixup 锚点假设错误停止，未进入产品测试；随后将上一轮 listener rollback / canonical CSS test fixture 规范化拆入临时 `preflight-fixup.mjs`。这些 support 脚本不会发布到稳定分支。

## 行为与兼容性

保持不变：

- Settings keys、默认值、持久化格式与 Store 权威；
- Settings Dialog Apply/Cancel 语义；Cancel 不发布提交事件，因此不会改变实际主题；
- toolbar 主题按钮仍执行 light/dark 切换并持久化；
- light/dark 视觉 token 值；
- App Shell 几何；
- Mermaid 渲染接口与缓存契约。

行为边界变化：

- classic `setAppTheme` / `toggleTheme` 权威退出；
- toolbar 主题按钮不再使用 inline classic 函数，而通过 Settings 已提交命令发布 `SettingsChanged`；
- 主题提交不再无条件调用 `updatePreview()`；
- 主题切换只改变 theme attribute/token 解析，不重建 editor DOM、virtual editor、CodeMirror model 或 preview 内容。

## 验证

受控 clean-runner在同一最终候选上执行并通过：

- Stage 3 handoff；
- Atomic 4.1–4.10 历史专项；
- Atomic 4.11 Theme Service / Theme Toggle Controller 单元与生产集成测试；
- Stage 2 token-only theme CSS 契约；
- locale audit；
- architecture hard gate；
- 完整 Node regression；
- Browser Contract；
- production build；
- Built App Browser，包括 Settings Dialog Apply 与真实 toolbar Theme Toggle 的 light → dark → light 切换；两条路径都断言 editor、virtual editor、CodeMirror model、preview DOM/内容节点身份不变。

未新增或升级生产依赖；未修改 lockfile、Rust、Tauri 配置、冻结模型、数据格式或公共持久化语义。

## 已知限制

- Theme Service 不主动重绘已经生成的 Mermaid SVG；后续实际 Mermaid 渲染会按当前 `data-theme` 选择 renderer theme。该设计用于满足本节点“主题切换不重建 preview”硬约束。
- 其它 Settings 运行态消费仍由后续 Atomic Task 继续迁移，本节点未越界。
