# 阶段 1 / Atomic Task 1.10：README 与架构交接

## 节点状态

- 结果：**通过**
- 阶段状态：**阶段 1 已完成；阶段 2 尚未开始。**
- 工作分支：`rewrite/modular-rebuild`
- 上一节点基线：`e111987bd431efbd140b6503f494a3c2c1eeeb84`
- 交接实现与临时文件清理提交：`b7f96a885a2df93d792edd038f5344900ac72ed8`
- 阶段 1 专项验证：GitHub Actions run `30986994815`
- 专项证据工件：`stage-01-architecture-foundation-30986994815-1`
- 专项证据工件 ID：`8922490798`
- 专项证据摘要：`sha256:8b8f93b82d14ee49b8b8cd9e586299f82ac74acb34cd0697954da66174e80e15`
- 完整基线回归：GitHub Actions run `30986994863`
- 完整基线工件：`stage-00-baseline-30986994863-1`
- 完整基线工件 ID：`8922713210`
- 完整基线摘要：`sha256:07e4037f5d63bf7b42c5d2b3f7970e5e2ad6e51f7a4e6c2e40bb2cf15fdb4109`

## 实际目标

完成阶段 1 的正式交接，使阶段 2 能够只依赖已公开、已验证的架构接口和门禁事实，而不依赖阶段 1 模块的隐藏内部实现。

本任务只完成以下内容：

1. 在根目录 `README.md` 中公开阶段 1 的架构交接边界；
2. 明确阶段 2 可以依赖的公共 API；
3. 明确状态所有者和依赖方向；
4. 明确遗留运行时的精确迁移基线与删除候选；
5. 明确现阶段限制，不宣称业务功能迁移已经完成；
6. 使用独立契约测试防止 README、实际导出和机器可读事实发生漂移；
7. 在 Stage 1 CI 中生成结构化交接证据。

## 实际变更

### 根目录 `README.md`

新增 `## Stage 1 架构交接`，记录：

- 阶段 1 已完成；
- 阶段 2尚未开始；
- 当前生产启动链仍为 `src/main.js` 和 9 个经典脚本；
- 当前生产模块清单仍为 67 个；
- 阶段 2 可依赖的公共架构 API；
- 生命周期、资源清理、命令和事件的单一状态所有者；
- Feature、Platform、Model Kernel 和循环依赖边界；
- 9 个经典脚本、184 个内联事件、38 个业务全局写入和 4 个跟踪运行产物组成的精确迁移基线；
- `public/app/*.js`、`public/i18n.js` 和旧 `src/main.js` 启动链是后续迁移与删除候选，不得提前删除；
- 四个本地架构验证入口和既有回归入口；
- 新组合根尚未接入生产启动链、Windows 原生路径尚未在本节点验证等已知限制。

### `tests/stage-01-handoff.test.mjs`

新增三个独立契约测试：

1. **README 交接事实测试**
   - 交接章节必须唯一；
   - 必须明确“阶段 1 已完成”和“阶段 2 尚未开始”；
   - 必须明确生产启动链仍是遗留启动链；
   - 必须记录机器可读清单中的精确数量；
   - 必须记录四个 npm 架构验证入口；
   - 必须明确不得宣称业务功能已经迁移。

2. **公共导出表面测试**
   - 真实导入所有阶段 1 公共模块；
   - 精确比对每个模块的命名导出；
   - 精确比对 `src/model-kernel/index.js` 的 26 个公共符号；
   - 防止 README 记录不存在、已删除或未经公开的接口。

3. **机器事实一致性测试**
   - 生产模块数量必须为 67；
   - 经典脚本数量必须为 9；
   - 内联事件数量必须为 184；
   - 业务全局写入数量必须为 38；
   - 跟踪运行产物数量必须为 4；
   - 不允许通配豁免；
   - 四个 npm 验证命令必须继续指向对应的本地 Node 入口。

### `.github/workflows/stage-01-atomic.yml`

新增两个正式步骤：

- `Verify Stage 1 handoff contract`
  - 在全量架构硬门禁前独立执行交接契约测试；
  - README 或公共接口漂移时直接阻断 Stage 1 CI。

- `Record Stage 1 handoff evidence`
  - 生成 `artifacts/stage-01/01-10-stage-01-handoff.json`；
  - 记录当前提交、run、attempt、交接范围、阶段 2 状态、生产启动方式、生产模块数量、精确遗留基线和 package 验证入口。

## 阶段 2 可依赖的公共 API

### 组合根

`src/app/create-application.js`

- `createApplication(dependencies)`
- 返回冻结的：
  - `commands`
  - `events`
  - `start()`
  - `destroy()`

### 生命周期

`src/app/application-lifecycle.js`

- `LIFECYCLE_STATES`
- `createApplicationLifecycle(participants)`

生命周期模块唯一拥有：

- 当前生命周期状态；
- 活动参与者栈；
- 启动、失败回滚和销毁转换；
- 并发启动与销毁共享的过渡 Promise。

### 资源清理

`src/app/disposer-registry.js`

- `DISPOSER_REGISTRY_STATES`
- `createDisposerRegistry()`

资源清理注册表唯一拥有：

- 已登记 disposer；
- LIFO 清理顺序；
- 清理中状态；
- 失败项重试状态。

### 命令基础设施

`src/app/commands/command-ids.js`

- `assertCommandId()`
- `defineCommandIds()`

`src/app/commands/command-registry.js`

- `createCommandRegistry()`
- `DuplicateCommandRegistrationError`
- `CommandNotRegisteredError`

`src/app/commands/command-bus.js`

- `createCommandBus()`

命令状态所有权：

- `command-registry.js` 唯一拥有命令 ID 到处理器的映射；
- `command-bus.js` 只进行 Promise 化路由，不拥有业务状态。

### 事件基础设施

`src/app/events/event-types.js`

- `assertEventType()`
- `defineEventTypes()`

`src/app/events/event-bus.js`

- `createEventBus()`
- `EventBusDestroyedError`
- `InvalidEventPayloadError`

事件总线唯一拥有订阅状态，并只发布与发布者原对象分离的深层冻结普通数据快照。

### 冻结模型入口

`src/model-kernel/index.js`

- 是冻结 JavaScript 模型能力的唯一公共入口；
- 精确公开 26 个既有符号；
- 非模型模块不得直接导入 8 个冻结 JavaScript 实现文件；
- Stage 0 冻结模型和数据契约哈希保持不变。

## 依赖边界

阶段 2 必须继续遵守以下边界：

- Feature 不得反向依赖 `src/app/` 的内部实现；
- 跨 Feature 只能依赖目标 Feature 的公共 `index.js`；
- Platform 不得导入 Feature；
- Model Kernel 不得导入高层模块；
- 生产 JavaScript 模块不得形成循环依赖；
- 非模型模块只能通过 `src/model-kernel/index.js` 使用冻结模型能力；
- 不得新增业务 `window.*`、HTML 内联事件或经典脚本隐式共享状态。

## 迁移基线与删除候选

当前精确迁移基线：

- 经典脚本：9 个；
- HTML 内联事件：184 个；
- 业务全局写入：38 个；
- 跟踪运行产物：4 个；
- 通配豁免：禁用。

后续迁移与删除候选：

- `public/app/bootstrap.js`
- `public/app/core.js`
- `public/app/editor-tools.js`
- `public/app/events.js`
- `public/app/export.js`
- `public/app/preview.js`
- `public/app/scroll-sync.js`
- `public/app/web-clipper.js`
- `public/i18n.js`
- `src/main.js` 中的遗留启动桥接职责

这些文件和职责不得因为被标记为候选就提前删除。只有对应功能链已经完整迁移、调用者切换、异常与销毁路径验证通过时，才能在同一受审变更中删除旧实现并精确缩减迁移基线。

## 保持不变

本节点没有修改：

- 生产业务源码；
- 当前生产启动链；
- 用户界面、交互和可观察行为；
- 公共业务接口和调用语义；
- 数据格式、持久化结构和迁移结果；
- 配置默认值和环境变量；
- 错误码、异常语义和日志等级；
- 安全策略、权限范围和兼容路径；
- 生产依赖、开发依赖和锁文件；
- 冻结模型算法、导出身份和冻结哈希。

## 验证

### Stage 1 专项验证

GitHub Actions run `30986994815`：**通过**。

通过步骤包括：

- 生产模块所有权清单；
- 最小组合根；
- 应用生命周期；
- disposer registry；
- command registry 与 command bus；
- event types 与 event bus；
- model-kernel 稳定入口；
- 架构扫描器契约；
- Stage 1 交接契约；
- 全量架构硬门禁；
- 机器可读模块清单；
- 1.2 至 1.10 的结构化证据生成；
- Node 回归测试；
- 浏览器交互契约；
- 前端生产构建；
- 证据工件上传。

### Stage 0 完整基线回归

GitHub Actions run `30986994863`：**通过**。

通过步骤包括：

- 静态基线和冻结契约采集；
- Node 测试套件；
- 浏览器交互契约；
- 前端生产构建；
- 构建后应用浏览器回归；
- `cargo test --locked`；
- `cargo check --locked`；
- Tauri Linux release build；
- 验证摘要与 Stage 0 工作区文档生成；
- 证据工件上传；
- Stage 0 硬门禁。

## 未执行验证与环境限制

- 本节点未执行 Windows 原生窗口、系统文件关联、原生文件对话框和系统拖放的真实 Windows 回归；原因是正式 CI 基线运行于 Ubuntu 22.04。
- 替代验证为浏览器交互契约、构建后应用回归、Rust test/check 和 Tauri Linux release build。
- 涉及 Windows 原生路径的后续阶段必须补充真实 Windows 验证，当前结论不替代该验证。
- `npm ci` 输出仍报告仓库当前依赖树中的 2 个 audit advisory（1 low、1 high）；本节点未修改依赖或锁文件，也未执行自动依赖升级。依赖安全修复必须作为独立、受审任务处理，不能在 1.10 中无范围升级。

## 风险与下一阶段前置条件

### 已知风险

- 新组合根、生命周期、命令和事件基础设施尚未接入生产启动链；
- 业务命令和事件目录尚未建立；
- 经典脚本、内联事件和业务全局仍然存在于精确迁移基线中；
- Windows 原生路径仍需要真实平台回归；
- 当前依赖树存在上述 npm audit advisory。

### 阶段 2 前置条件

阶段 2 可以开始，但必须：

1. 继续读取并应用根目录两份规则；
2. 以本节点公开的公共 API 和状态所有权为边界；
3. 不依赖 `src/app/` 或未来 Feature 的隐藏内部文件；
4. 不提前删除遗留启动链；
5. 每次迁移遗留事实时同步缩减精确基线；
6. 每个 Atomic Task 独立验证、独立记录并可安全回退；
7. 继续执行 Stage 1 架构门禁和 Stage 0 完整基线。

## 回退

如需回退本节点，只回退：

- README 的 Stage 1 架构交接区；
- `tests/stage-01-handoff.test.mjs`；
- Stage 1 CI 的交接测试和证据步骤；
- 本详细记录和 README 完成标记。

回退不得影响 1.1 至 1.9 已验证的架构基础、迁移基线、package 验证入口或用户已有修改。
