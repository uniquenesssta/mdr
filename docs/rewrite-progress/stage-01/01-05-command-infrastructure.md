# 阶段 1 / Atomic Task 1.5：命令注册表与命令总线

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 继续进行；Atomic Task 1.5 已完成，Atomic Task 1.6 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 最终实现与验证提交：`f76783c3e20dbf61b43f15e51c6639dcb83e7a2a`
- 阶段 1 专项验证：GitHub Actions run `30923323509`
- 专项证据工件：`stage-01-architecture-foundation-30923323509-1`
- 专项证据工件 ID：`8898020297`
- 专项证据摘要：`sha256:01b183a7b0c8ecaa34ce75b5cabe83d45a759965149a373fa465c0e1846bf04b`
- 完整基线回归：GitHub Actions run `30923323395`
- 完整基线工件：`stage-00-baseline-30923323395-1`
- 完整基线工件 ID：`8898308741`
- 完整基线摘要：`sha256:c04b8737a2efca506083140e3755b32aa45ef28d8563d75234aa842a2e401a87`
- 上一节点基线：`204c0e00f099369dce09a1d72f0e410a9a6600d3`

## 实际目标

建立平台无关、业务无关的命令基础设施，使后续 Feature 能通过稳定命令 ID 注册唯一处理器，并由统一总线执行同步或异步处理器。缺失命令、重复注册和业务异常必须显式失败，不允许 optional chaining 或空实现造成静默成功。

本节点不执行以下工作：

- 不注册真实 document、layout 或 app 业务命令；
- 不接入 `src/main.js` 或旧全局函数；
- 不迁移菜单、快捷键、工具栏或 UI 事件；
- 不实现事件总线；
- 不修改冻结模型、持久化格式、配置或公共业务行为；
- 不新增生产依赖。

## 新增模块

### `src/app/commands/command-ids.js`

负责命令 ID 规则和集中目录声明：

- `assertCommandId(commandId)` 验证小写点分标识符；
- `defineCommandIds(definitions)` 验证 UPPER_SNAKE 常量名；
- 同一目录中重复的命令 ID 会被拒绝；
- 返回冻结目录，不拥有处理器或业务状态。

### `src/app/commands/command-registry.js`

作为命令处理器映射的唯一所有者：

- 每个命令 ID 最多注册一个处理器；
- 重复注册抛出 `DuplicateCommandRegistrationError`；
- 未注册命令解析抛出 `CommandNotRegisteredError`；
- 注册返回精确且幂等的注销函数；
- 旧注销函数不能删除后来重新注册的同名处理器；
- 返回对象冻结，不暴露内部 Map。

### `src/app/commands/command-bus.js`

只负责命令路由：

- 默认创建独立注册表，也支持显式注入注册表；
- `register(commandId, handler)` 委托注册表；
- `execute(commandId, payload)` 先解析处理器，再以原始 payload 调用；
- 同步和异步结果统一返回 Promise；
- 未注册命令返回 rejected Promise；
- 同步或异步业务异常保持原对象传播，不包装、不转换、不吞掉。

## 并发和注销语义

命令执行在调用时先取得当前处理器引用。执行开始后即使处理器被注销，该次执行仍使用已解析的处理器完成；之后的新执行会观察到命令已注销并失败。该行为避免运行中的请求被后续注册表变更破坏，同时不为命令引入队列、锁或隐藏状态。

## 组合根关系

`createCommandBus()` 满足 `application-context.js` 已定义的 `commands.register()` / `commands.execute()` 端口，并通过真实 `createApplication()` 集成测试。组合根代码未修改，生产入口仍未导入命令基础设施。

## 受影响链路

- `src/app/commands/command-ids.js`：新增命令 ID 规则和目录声明；
- `src/app/commands/command-registry.js`：新增唯一处理器所有者；
- `src/app/commands/command-bus.js`：新增 Promise 化命令路由；
- `tests/architecture/command-bus.test.mjs`：新增命令基础设施专项测试；
- `tests/architecture/fixtures/production-modules.json`：生产模块清单由 61 增加至 64；
- `.github/workflows/stage-01-atomic.yml`：增加专项测试和结构化证据；
- `src/app/application-context.js`、`src/app/create-application.js`：代码未修改，通过真实端口集成测试；
- `src/main.js`：代码未修改，继续与新命令基础设施断开。

## 专项测试覆盖

1. 命令 ID 格式、常量命名、重复值和冻结目录；
2. 注册表唯一所有权、重复注册拒绝、精确解析和幂等注销；
3. 同步与异步处理器接收原始 payload 并返回结果；
4. 缺失命令显式拒绝；
5. 同步与异步业务异常原样传播；
6. 运行中执行与后续注销之间的确定性边界；
7. 非法处理器和非法注入注册表被拒绝；
8. 与最小组合根命令端口的真实集成；
9. 命令模块不访问 DOM、Storage、Worker、Tauri 或计时器，且未接入旧入口。

## 首轮验证修复

首轮专项 run `30923120394` 在平台隔离断言处失败。原因是测试直接禁止源码中出现单词 `document`，从而把合法命令命名空间字符串 `document.save` 误判为 DOM 访问。生产实现的其余 8 组测试均已通过。

修复仅调整测试识别边界：继续禁止真实 `document.querySelector`、`document[...]`、窗口、存储、Worker、Observer、Timer 和 Tauri 访问，同时允许命令 ID 字符串中的 `document.*`。测试新增正反样例，防止门禁被无意弱化。未修改生产实现。

## 阶段 1 专项验证

GitHub Actions run `30923323509`：**通过**。

- 64 文件模块清单完整性：通过；
- 最小组合根：通过；
- 生命周期状态机：通过；
- 资源销毁注册表：通过；
- 命令注册表与命令总线 9/9：通过；
- 结构化证据生成：通过；
- 现有 Node 回归：通过；
- 浏览器交互契约：通过；
- 前端生产构建：通过；
- 专项证据工件上传：通过。

结构化证据记录：

- 注册表所有权：`unique-handler`；
- 重复策略：`reject`；
- 注销策略：`exact-idempotent`；
- 执行结果：`promise`；
- 缺失命令：`reject`；
- 处理器异常：`preserve`。

## 完整基线回归

GitHub Actions run `30923323395`：**通过**。

- Node 回归测试：通过；
- 浏览器交互契约：通过；
- 前端生产构建：通过；
- 应用级浏览器回归 7/7：通过；
- `cargo test --locked`：通过；
- `cargo check --locked`：通过；
- Tauri Linux release build：通过；
- 阶段 0 硬门禁：通过。

## 行为与兼容性

- 当前生产启动、关闭、UI、菜单、快捷键和用户交互行为保持不变；
- 未注册任何生产业务命令；
- 未修改公共业务接口、数据格式、持久化结构、配置、错误码或权限；
- 未修改 9 个冻结模型和数据契约文件；
- 未新增生产依赖；
- 临时应用工作流已删除。

## 已知限制

- 命令基础设施尚未接入生产入口；
- 真实命令目录和业务处理器将在相应 Feature 迁移节点逐项建立；
- 命令取消、超时、优先级、撤销和历史记录不属于本节点范围；
- 当前总线按调用并发执行，不提供串行队列；
- 完整桌面回归运行在 Ubuntu 22.04，Windows 原生窗口、文件关联和桌面拖放未在本节点验证。

## 节点结论

Atomic Task 1.5 已完成并通过专项验证与完整回归。命令 ID、处理器所有权和执行路由分别由三个职责清晰的模块拥有，缺失、重复和业务异常均显式传播。Atomic Task 1.6 尚未开始。
