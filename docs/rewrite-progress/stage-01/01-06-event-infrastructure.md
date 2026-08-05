# 阶段 1 / Atomic Task 1.6：事件类型与事件总线

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 继续进行；Atomic Task 1.6 已完成，Atomic Task 1.7 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 最终实现与验证提交：`a7b4bbdeb6e149c73820e9ff01e8be0b95365336`
- 阶段 1 专项验证：GitHub Actions run `30961354098`
- 专项证据工件：`stage-01-architecture-foundation-30961354098-1`
- 专项证据工件 ID：`8913060365`
- 专项证据摘要：`sha256:5383ecf18edb767ae29ed42e0cf748fbfc233e48a3cb8a24183864997bc58e93`
- 完整基线回归：GitHub Actions run `30961354097`
- 完整基线工件：`stage-00-baseline-30961354097-1`
- 完整基线工件 ID：`8913192995`
- 完整基线摘要：`sha256:be7ce96bb23d081d9d2a443587ce61b984c16e5dd12186553fbd74f45157566c`
- 上一节点基线：`8f8781a7ec3621f226d616263f9eb32639d80d1f`

## 实际目标

建立平台无关、业务无关的只读事件基础设施，使后续 Feature 只能通过稳定事件类型发布不可变数据快照。事件用于单向通知，不承担请求/响应，不暴露监听器返回值，也不允许监听器直接修改发布者拥有的对象。

本节点不执行以下工作：

- 不声明真实 document、layout、preview 或 app 业务事件目录；
- 不接入 `src/main.js` 或旧经典脚本；
- 不迁移 DOM、快捷键、Worker、Tauri 或业务监听器；
- 不替代命令总线处理请求/响应；
- 不修改冻结模型、持久化格式、配置或公共业务行为；
- 不新增生产依赖。

## 新增模块

### `src/app/events/event-types.js`

负责事件类型规则和集中目录声明：

- `assertEventType(eventType)` 验证小写点分标识符；
- `defineEventTypes(definitions)` 验证 UPPER_SNAKE 常量名；
- 同一目录中的重复事件类型会被拒绝；
- 返回冻结目录，不拥有订阅、业务状态或平台对象。

### `src/app/events/event-bus.js`

作为订阅状态的唯一所有者，公开：

- `subscribe(type, listener)`：按注册顺序订阅，返回精确且幂等的退订函数；
- `once(type, listener)`：调用前先移除，递归发布不会重复进入；
- `publish(type, payload)`：同步发起通知并始终返回 `undefined`；
- `destroy()`：一次性清空全部订阅，重复调用安全；
- 销毁后的订阅、一次性订阅和发布均抛出 `EventBusDestroyedError`。

## 只读载荷边界

发布时不会冻结或转交发布者原对象，而是创建独立的深层冻结快照：

- 允许原始值、数组和普通对象；
- 支持循环普通数据结构；
- 同一次发布的全部监听器接收同一个冻结快照；
- 发布者原对象保持可变且引用不泄漏；
- 函数、Symbol、Symbol 键、访问器属性、Date、Map、Set、Promise、DOM 和其他类实例均被拒绝；
- 不读取 getter，避免载荷验证触发隐藏副作用。

该边界确保跨 Feature 事件只传递数据，不传递可调用能力、平台对象或隐式共享状态。

## 监听器异常隔离

- 同步监听器抛错不会阻止后续监听器；
- 异步监听器返回的 Promise rejection 会被捕获；
- 错误通过可注入的 `onListenerError(error, context)` 报告；
- 错误上下文包含冻结的事件类型与不可变载荷；
- 未注入报告器时使用控制台错误报告；
- 监听器返回值和 Promise 完成值均不会从 `publish()` 返回。

因此事件仍是 fire-and-forget 通知协议，不会退化为隐式请求/响应通道。

## 发布期间的确定性语义

每次发布使用开始时的订阅快照，同时检查每个订阅的当前 active 状态：

- 发布期间新增的监听器不接收当前事件；
- 在轮到某监听器前退订会跳过该监听器；
- `once` 在调用前移除，可抵御递归发布；
- 发布期间销毁总线会阻止剩余监听器继续执行。

## 组合根关系

`createEventBus()` 满足 `application-context.js` 已定义的 `events.subscribe()` / `events.publish()` 端口，并通过真实 `createApplication()` 集成测试。组合根代码未修改，生产入口仍未导入事件基础设施。

## 受影响链路

- `src/app/events/event-types.js`：新增事件类型规则和冻结目录；
- `src/app/events/event-bus.js`：新增订阅所有权、不可变发布、异常隔离和销毁；
- `tests/architecture/event-bus.test.mjs`：新增事件基础设施专项测试；
- `tests/architecture/fixtures/production-modules.json`：生产模块清单由 64 增加至 66；
- `.github/workflows/stage-01-atomic.yml`：增加专项测试和结构化证据；
- `src/app/application-context.js`、`src/app/create-application.js`：代码未修改，通过真实端口集成测试；
- `src/main.js`：代码未修改，继续与新事件基础设施断开。

## 专项测试覆盖

1. 事件类型格式、常量命名、重复值和冻结目录；
2. 深层冻结快照与发布者对象隔离；
3. 同一次发布共享同一只读快照；
4. 精确且幂等的退订；
5. `once` 调用前移除和递归发布保护；
6. 同步监听器异常隔离和返回值丢弃；
7. 异步监听器 rejection 隔离与报告；
8. 发布期间新增、退订和 active 状态语义；
9. 幂等销毁以及销毁后使用拒绝；
10. 非纯数据载荷拒绝；
11. 依赖、监听器和事件类型输入校验；
12. 循环普通数据快照；
13. 与最小组合根的真实集成和平台隔离。

## 阶段 1 专项验证

GitHub Actions run `30961354098`：**通过**。

- 66 文件模块清单完整性：通过；
- 最小组合根：通过；
- 生命周期状态机：通过；
- 资源销毁注册表：通过；
- 命令基础设施：通过；
- 事件类型与事件总线 13/13：通过；
- 结构化证据生成：通过；
- 现有 Node 回归：通过；
- 浏览器交互契约：通过；
- 前端生产构建：通过；
- 专项证据工件上传：通过。

结构化证据记录：

- 载荷策略：`deep-frozen-plain-data-snapshot`；
- 交付顺序：`registration`；
- once 策略：`remove-before-invoke`；
- 退订策略：`exact-idempotent`；
- 监听器异常：`isolated-reported`；
- 发布结果：`void`；
- 销毁后使用：`reject`。

## 完整基线回归

GitHub Actions run `30961354097`：**通过**。

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
- 未声明或发布任何生产业务事件；
- 未修改公共业务接口、数据格式、持久化结构、配置、错误码或权限；
- 未修改 9 个冻结模型和数据契约文件；
- 未新增生产依赖；
- 临时模块清单工作流已删除。

## 验证限制

- 当前容器仍无法解析 `github.com`，无法建立本地 clone；实施和验证通过 GitHub connector 与 GitHub-hosted Actions 完成；
- 完整桌面回归运行在 Ubuntu 22.04，Windows 原生窗口、文件关联和桌面拖放未在本节点验证。

## 已知限制

- 事件基础设施尚未接入生产入口；
- 真实事件目录和业务订阅将在对应 Feature 迁移节点逐项建立；
- 发布是同步 fire-and-forget，异步监听器不会被等待；
- 事件不提供优先级、历史、重放、缓冲或跨进程传输；
- Date、Map、Set、Error 等实例必须在发布前转换为普通数据；
- 默认错误报告写入控制台，生产组合根可注入统一错误端口。

## 节点结论

Atomic Task 1.6 已完成并通过专项验证与完整回归。事件类型、订阅状态、只读载荷和异常隔离均拥有明确边界，事件协议不能承担请求/响应或泄漏发布者可变状态。Atomic Task 1.7 尚未开始。
