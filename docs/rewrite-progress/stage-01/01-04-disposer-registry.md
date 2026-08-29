# 阶段 1 / Atomic Task 1.4：资源销毁注册表

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 继续进行；Atomic Task 1.4 已完成，Atomic Task 1.5 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 资源注册表实现提交：`acaaf67cb03ef5542060b68d5ab66fef8693b2e9`
- 正式验证提交：`d3908b12805d8b17d126426574bf295338679dcc`
- 阶段 1 专项验证：GitHub Actions run `30920143493`
- 专项证据工件：`stage-01-architecture-foundation-30920143493-1`
- 专项证据工件 ID：`8896721937`
- 专项证据摘要：`sha256:367bbf275220923929e6af166d6bf8fc9cfcecd48b2b38d6d4446d26b8b28927`
- 完整基线回归：GitHub Actions run `30920143387`
- 完整基线工件：`stage-00-baseline-30920143387-1`
- 完整基线工件 ID：`8896956474`
- 完整基线摘要：`sha256:198d7d2f447c1a06071e3e4698df559e568235ebada7368d704b91169be7ec99`
- 上一节点基线：`5554747ecf62f7e90b6c137d1dcf18233eb3ce2a`

## 实际目标

建立一个独立、可复用、可测试的资源清理所有者，为后续长期 Feature 统一登记监听器、订阅、Observer、Timer、Worker 和其他外部资源的释放动作。注册表必须保证严格后进先出清理、并发幂等、失败聚合及仅重试失败项，同时不接入当前生产启动链。

本节点明确不执行以下工作：

- 不将资源注册表接入 `src/main.js`；
- 不迁移现有业务模块、事件监听器、Observer、Timer、Worker 或订阅；
- 不修改应用生命周期状态机的公共契约；
- 不实现命令总线或事件总线；
- 不修改冻结模型、持久化格式、UI、配置或公共业务接口；
- 不新增生产依赖。

## 新增模块

### `src/app/disposer-registry.js`

该模块是注册资源清理动作及其执行状态的唯一所有者，导出：

- `DISPOSER_REGISTRY_STATES`；
- `createDisposerRegistry()`。

返回对象被冻结，只公开：

- 只读 `state`；
- 只读 `size`；
- `register(disposer)`；
- `dispose()`；
- `destroy()`，作为 `dispose()` 的生命周期兼容别名。

模块不访问 DOM、Storage、Tauri、Worker、Observer、网络或计时器，不持有业务状态，也不使用模块级单例。

## 状态与所有权

注册表拥有以下状态：

- `open`：允许登记清理动作；
- `disposing`：正在执行全局清理，禁止新增登记；
- `failed`：上一次清理仍有失败项，禁止新增登记，仅允许继续重试清理。

每个登记项只由注册表维护：

- 原始 disposer 函数；
- 是否仍处于活动状态；
- 当前是否已有执行中的 Promise。

成功清理的登记项立即从注册表移除；失败项保留，后续全局清理仅重试这些失败项。

## 登记与提前释放语义

`register(disposer)` 只接受函数，非法输入抛出精确 `TypeError`，且不改变注册表状态。

每次登记返回一个该资源专属的提前释放函数：

- 多次调用只执行一次 disposer；
- 成功后从全局清理集合移除；
- 若同一资源已经处于执行中，返回同一个 Promise；
- 全局 LIFO 清理进行期间，不允许较早资源绕过顺序独立释放；
- `failed` 状态允许直接重试失败资源，全部清理后恢复 `open`。

## 全局清理语义

`dispose()` / `destroy()`：

1. 按登记顺序的严格逆序执行仍活动的 disposer；
2. 单个 disposer 失败不会阻止其余资源继续清理；
3. 所有失败通过一个 `AggregateError` 按实际执行顺序返回；
4. 成功项不会在后续清理中重复执行；
5. 失败项保留并在下一次调用时重试；
6. `disposing` 状态的并发调用返回同一个转换 Promise；
7. 空注册表调用清理为无副作用成功；
8. 全部清理成功后恢复 `open`，可用于下一代生命周期。

## 与应用生命周期的关系

资源注册表没有被硬编码进 `application-lifecycle.js`，而是通过参与者的 `start()` / `destroy()` 组合使用。专项测试证明同一个注册表可以跨两代 `start → destroy → start → destroy` 使用，并且每一代资源都按逆序清理且不会累积。

此设计保持职责边界：

- `application-lifecycle.js` 只管理参与者状态、启动顺序和参与者级回滚；
- `disposer-registry.js` 只管理单个 Feature 内资源清理动作及重试状态；
- Feature 后续自行拥有一个注册表实例，并通过其生命周期入口调用。

## 受影响链路

- `src/app/disposer-registry.js`：新增资源清理状态所有者；
- `tests/architecture/disposer-registry.test.mjs`：新增专项行为和边界测试；
- `tests/architecture/fixtures/production-modules.json`：生产模块清单由 60 增加至 61；
- `.github/workflows/stage-01-atomic.yml`：增加注册表测试和结构化证据生成；
- `src/app/application-lifecycle.js`：代码未修改，仅通过测试验证组合关系；
- `src/main.js`：代码未修改，仍未导入新注册表。

## 专项测试覆盖

`tests/architecture/disposer-registry.test.mjs` 覆盖：

1. 同步与异步 disposer 的严格 LIFO 清理；
2. 专属提前释放函数的幂等行为；
3. 并发全局清理共享同一个转换 Promise；
4. 多个清理失败时继续执行其余项并按顺序聚合异常；
5. 后续清理只重试失败项；
6. 清理期间禁止新增登记和破坏 LIFO 的提前释放；
7. 两代应用生命周期资源不累积；
8. 非函数 disposer 被拒绝且不污染状态；
9. 模块不访问平台全局，也未接入旧生产入口。

## 阶段 1 专项验证

GitHub Actions run `30920143493`：**通过**。

- `npm ci`：通过；
- 61 文件模块清单完整性：通过；
- 最小组合根契约：通过；
- 应用生命周期状态机专项测试：通过；
- 资源销毁注册表专项测试：通过；
- 注册表结构化证据生成：通过；
- 现有 Node 回归：通过；
- 浏览器交互契约：通过；
- 前端生产构建：通过；
- 专项证据工件上传：通过。

结构化证据记录：

- `status: passed`；
- 状态集合 `open / disposing / failed`；
- 清理顺序 `lifo`；
- 重试策略 `failed-only`；
- 并发清理 `shared-transition`。

## 完整基线回归

GitHub Actions run `30920143387`：**通过**。

实际通过项目：

- Rust 1.88.0 工具链安装与版本确认；
- Tauri Linux 系统依赖安装；
- 静态基线、公共契约和冻结模型哈希采集；
- `npm ci`；
- Node 回归测试；
- 浏览器交互契约；
- 前端生产构建；
- 应用级浏览器回归 7/7；
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`；
- `cargo check --manifest-path src-tauri/Cargo.toml --locked`；
- Tauri Linux release build；
- 阶段 0 硬门禁。

## 行为与兼容性

- 当前生产应用启动、关闭、UI 和用户交互行为保持不变；
- 未修改公共业务接口、数据格式、持久化结构、配置、错误码或权限；
- 未修改 9 个冻结模型和数据契约文件；
- 未新增生产依赖；
- 清理错误不会被捕获后静默忽略；
- 一次性应用工作流已删除，没有遗留调试脚本、生成物或替代实现。

## 已知限制

- 注册表尚未接入任何生产 Feature；
- disposer 的超时、取消和强制终止不属于本节点范围；
- disposer 必须自行保证其内部资源释放语义；
- 后续 Feature 迁移必须逐个建立资源所有权，不能一次性把全局监听器全部塞入同一注册表；
- 完整桌面回归运行在 Ubuntu 22.04，Windows 原生窗口、文件关联和桌面拖放未在本节点验证。

## 节点结论

Atomic Task 1.4 已完成并通过专项验证与完整回归。资源清理登记、严格 LIFO、提前幂等释放、并发转换、异常聚合、失败项重试和生命周期代次复用均由一个独立模块拥有。Atomic Task 1.5 尚未开始。
