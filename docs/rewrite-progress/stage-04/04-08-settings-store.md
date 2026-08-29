# Stage 4 / Atomic Task 4.8 — Settings Store

## 状态

Atomic 4.8 **PASS**。Settings Store 已成为 Settings 的唯一运行时状态所有者；Atomic 4.9 Section Modules 尚未开始。

## 任务边界

本节点只迁移 Settings 的 committed state 与 draft session，明确区分 `openDraft / updateDraft / applyDraft / cancelDraft`，并把 Repository 收回 Store 后方作为唯一物理持久化边界。

未创建 `application/`、`sections/`、`ui/`，未迁移 4.9/4.10 职责，也未实现 Theme Service。

## 实施结构

```text
src/features/settings/
  index.js
  domain/
    settings-defaults.js
    settings-schema.js
    settings-serialization.js
    settings-validation.js
  state/
    settings-store.js
  infrastructure/
    settings-repository.js
  compatibility/
    classic-settings-store-port.js
```

Atomic 4.7 的临时 `classic-settings-repository-port.js` 已删除；classic 调用者不再直接接触 Repository。

## Settings Store 所有权

`settings-store.js` 独占：

- 一份完整、已验证、深冻结的 committed snapshot；
- 至多一个深冻结 draft session；
- draft 的 dirty 字段集合；
- Store 生命周期与 terminal destroy 状态。

Store 不查找 DOM、`localStorage` 或平台对象。持久化函数由组合根注入，实际 I/O 继续只有 `settings-repository.js` 执行。

### Draft 生命周期

- `openDraft()`：从 committed snapshot 建立 draft，**零持久化**；
- `updateDraft()`：只更新 draft，重新验证并保持不可变，**零持久化**；
- `cancelDraft()`：直接丢弃 draft，**零持久化**；
- `applyDraft()`：只提交相对 committed 的有效变化；Repository 成功后才推进 committed 并关闭 draft；
- no-op apply：关闭 draft，但不产生 Repository 写入；
- apply 持久化失败：committed 保持不变，draft 保留用于重试或取消；
- `commit()/set()`：用于当前仍存在的即时设置动作，先持久化、成功后再修改 committed；若 draft 已打开，只 rebase 未被用户编辑的字段；
- `destroy()`：幂等、terminal，丢弃 draft 且不持久化。

## Classic Settings 切换

`src/bootstrap/module-entry.js` 现在按以下顺序组合：

1. 创建 Settings Repository；
2. Repository `load()` 恢复完整 typed snapshot；
3. 创建 Settings Store，并把 `repository.save()` 作为持久化函数注入；
4. 挂载窄 `markdownEditorSettingsStorePort`；
5. 再加载 classic application。

Repository 不再通过 compatibility host 暴露。

`public/app/core.js` 的 Settings dialog 已切到 Store draft：

- 打开设置调用 `openDraft()`；
- 表单初始值来自 draft；
- 保存先 `updateDraft()`，再 `applyDraft()`；
- Repository/Store 提交成功后才改变 theme、language、layout、sidebar、autosave、editor、toolbar、preview runtime state；
- 保存失败不污染当前 runtime state，也不丢失 draft；
- Cancel 按钮调用 `cancelDraft()`；
- ModalShell 的 Escape / Backdrop `onClose` 同样调用 `cancelDraft()`。

因此 Cancel、Escape、Backdrop 三条关闭路径统一满足 **0 Settings persistence writes**。

现有即时行为 theme、language、layout、sidebar、table/code visual editing 也已改为 Store persistence-first；持久化失败时不先推进可观察运行时状态。

## 保持不变

- 15 个 legacy Settings key 和序列化格式保持不变；
- Settings Repository 仍是唯一物理设置 I/O owner；
- 非 Settings 数据（文档、最近文件、sidebar width、pane state 等）继续保留原 storage 路径；
- theme 仍为 light/dark；
- locale/layout/toolbar/preview/visual-editing 合法值与默认值不变；
- 未修改 Rust、Tauri command、DTO、生产依赖或 lockfile；
- 未开始 4.9 Section Modules。

## 测试覆盖

4.8 Store + compatibility port 共 **15/15 PASS**，覆盖：

1. compatibility port 只暴露 Store committed/draft 操作；
2. 重复挂载拒绝与 idempotent/terminal destroy；
3. bootstrap 保持 Repository internal，Store 在 classic application 前完成组合；
4. Settings dialog 的 draft lifecycle 与 Cancel/Escape/Backdrop 零写入；
5. 删除 Repository bridge，且不提前创建 4.9/4.10 目录；
6. committed snapshot 完整验证与深冻结；
7. incomplete/extra/invalid 初始状态在持久化前拒绝；
8. open/update draft 零写入；
9. cancel draft 精确零写入；
10. apply 只提交有效变化一次；
11. no-op apply 零写入；
12. apply persistence failure 保持 committed、保留 draft；
13. immediate commit persistence-first，并安全 rebase open draft；
14. no-op/failed immediate commit 不破坏 committed/draft；
15. destroy 零持久化且 terminal。

Built App Browser 新增真实场景 `application Settings Store cancels draft without persisting changes`，验证 Cancel 按钮、Escape 与 Backdrop 三种关闭方式均不产生 `md_editor_theme` 写入且 runtime theme 不发生泄漏。

## 发布与验证

implementation commit：

`89b6e43dde2b882c19f9de3bfc6f4f11f8b0dbe4` — `feat(settings): implement atomic task 4.8 store`

Stage 4 CI 配置提交：

`c1d2e1d00e2886f5f100f4a2a52bc9a3fa977780` — `ci(settings): validate atomic task 4.8 store`

正式 Stage 4 Atomic Verification run `31261150570`：**PASS**（attempt 1）。

Clean runner 实际结果：

- Stage 3 handoff：**6/6 PASS**；
- Atomic 4.1：**7/7 PASS**；
- Atomic 4.2：**7/7 PASS**；
- Atomic 4.3：**7/7 PASS**；
- Atomic 4.4：**7/7 PASS**；
- Atomic 4.5：**8/8 PASS**；
- Atomic 4.6 Settings Schema：**7/7 PASS**；
- Atomic 4.7 Settings Repository：**8/8 PASS**；
- Atomic 4.8 Settings Store / Port：**15/15 PASS**；
- current locale audit：**PASS**；
- Architecture：**PASS**；
- Node regression：**42/42 PASS**；
- Browser Contract：**10/10 PASS**；
- Vite build：**PASS**，Vite 7.3.6，2255 modules transformed；
- Built App Browser：**14/14 PASS**；
- evidence upload：**PASS**。

Evidence：

- artifact：`stage-04-settings-store-31261150570-1`
- artifact ID：`9022819509`
- artifact size：`6596` bytes
- digest：`sha256:e8fa4d1a4486d18a7a72a9a3c3f1cc81d7b84894a304f8ad190b6336fb510283`
- retention：30 days；到期时间 `2026-09-07T14:07:45Z`

在正式发布前还执行了独立 clean-runner pre-publication 验证，确认精确 18 路径迁移、完整测试与 Built App Browser 14/14 后才允许形成 implementation commit。发布链路曾因 GitHub Actions token 无 workflow 修改权限被阻断；该限制只影响提交传输，不影响代码门禁，最终将 workflow 作为独立 CI 配置提交并在真实主分支 HEAD 上重新全量验证。

## 非阻塞警告 / 已知限制

本 Atomic 未引入依赖变更。clean runner 的 dependency preparation 仍报告现有 **4 个 npm audit 项（2 moderate、2 high）**；未执行 `npm audit fix`，避免在 4.8 混入无关依赖升级。

Vite 继续报告部分 minified chunks > 500 kB；这是现有构建警告，本 Atomic 未调整 chunking 策略。

GitHub runner 还提示部分 Actions 当前声明的 Node 20 runtime 已弃用并被平台强制使用 Node 24；workflow 本身的项目测试 Node 版本仍显式为 Node 22。该平台警告不影响本次门禁结果。

## 结论

Atomic 4.8 已满足任务书的关键验收：Settings runtime state 只有 Store 一个权威 owner，draft 与 committed 明确分离，取消路径不写入，持久化失败不会先污染 runtime/committed 状态，Repository 保持唯一物理持久化 owner。Atomic 4.9 尚未开始。
