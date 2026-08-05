## Stage 1 架构交接

阶段 1 已完成，只交付可执行的架构基础与迁移门禁；阶段 2 尚未开始，不得宣称业务功能已经迁移。当前生产应用仍由 `src/main.js` 与 9 个经典脚本启动，其中包括 `public/app/*.js` 和 `public/i18n.js`；阶段 1 清单仍覆盖 67 个生产模块。

### 阶段 2 可依赖的公共架构 API

- `src/app/create-application.js`：`createApplication(dependencies)`，公开冻结的 `commands`、`events`、`start()` 与 `destroy()`。
- `src/app/application-lifecycle.js`：`LIFECYCLE_STATES`、`createApplicationLifecycle(participants)`。
- `src/app/disposer-registry.js`：`DISPOSER_REGISTRY_STATES`、`createDisposerRegistry()`。
- `src/app/commands/command-ids.js`：`assertCommandId()`、`defineCommandIds()`。
- `src/app/commands/command-registry.js`：`createCommandRegistry()`、`DuplicateCommandRegistrationError`、`CommandNotRegisteredError`。
- `src/app/commands/command-bus.js`：`createCommandBus()`。
- `src/app/events/event-types.js`：`assertEventType()`、`defineEventTypes()`。
- `src/app/events/event-bus.js`：`createEventBus()`、`EventBusDestroyedError`、`InvalidEventPayloadError`。
- `src/model-kernel/index.js`：冻结 JavaScript 模型能力的唯一公共入口，精确公开 26 个既有符号；非模型模块不得绕过该入口导入冻结实现。

### 状态所有权与依赖边界

- `application-lifecycle.js` 唯一拥有应用生命周期状态与活动参与者栈。
- `disposer-registry.js` 唯一拥有单个模块登记的资源清理状态。
- `command-registry.js` 唯一拥有命令 ID 到处理器的映射；`command-bus.js` 只负责路由。
- `event-bus.js` 唯一拥有事件订阅状态，并只发布深层冻结的普通数据快照。
- Feature 不得反向依赖 `src/app/` 内部；跨 Feature 只能依赖目标 Feature 的公共 `index.js`；Platform 不得导入 Feature；Model Kernel 不得导入高层模块；生产 JavaScript 模块不得形成循环依赖。

### 迁移基线与删除候选

当前精确迁移基线锁定 9 个经典脚本、184 个内联事件、38 个业务全局写入和 4 个跟踪运行产物，且不允许通配豁免。`public/app/*.js`、`public/i18n.js` 和旧 `src/main.js` 启动链是后续分阶段迁移与删除候选，不得提前删除；每次移除遗留事实时必须在同一受审变更中同步缩减精确基线并完成回归。

### 验证入口

```bash
npm run verify:architecture
npm run verify:no-legacy-runtime
npm run verify:generated-files
npm run verify:readme-record
npm test
npm run test:browser:contract
npm run build
npm run check
```

涉及桌面或 Rust 链路时继续执行锁文件约束下的 `cargo test`、`cargo check` 与 Tauri release build。架构检查只读取仓库源码和本地 Git 事实，不依赖构建产物或联网。

### 已知限制

- 新组合根、生命周期、命令和事件基础设施尚未接入生产启动链。
- 真实业务命令、事件目录和 Feature 迁移必须在对应后续 Atomic Task 中逐条建立和验证。
- 当前完整桌面基线在 Ubuntu 22.04 验证；Windows 原生窗口、文件关联和系统拖放仍需在涉及这些路径的阶段执行真实平台验证。

