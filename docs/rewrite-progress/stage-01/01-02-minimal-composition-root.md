# 阶段 1 / Atomic Task 1.2：最小组合根

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 继续进行；Atomic Task 1.2 已完成，Atomic Task 1.3 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 源码实现提交：`3f28e1091b3ac71e43889cc729260724350e4d3f`
- 正式验证提交：`2d6982c23e194f8c67a60f7cf9aa017b4a6c0f18`
- 阶段 1 专项验证：GitHub Actions run `30906897816`
- 专项证据工件：`stage-01-architecture-foundation-30906897816-1`
- 证据工件 ID：`8891411347`
- 完整基线回归：GitHub Actions run `30906897895`
- 阶段 0 完成基线：`f714feb73338ae049abf53907ff6469c887e1f6b`

## 实际目标

建立一个可单独构造和测试的最小应用组合根，为后续生命周期、命令总线和事件总线实现提供稳定接入边界，同时保持当前应用启动链和业务行为完全不变。

本节点明确不执行以下工作：

- 不把新组合根接入 `src/main.js`；
- 不启动、迁移或重写现有业务模块；
- 不提前实现 Atomic Task 1.3 的生命周期状态机；
- 不提前实现 Atomic Task 1.5 和 1.6 的命令总线、事件总线内部逻辑；
- 不修改冻结模型、持久化结构、UI 或现有经典脚本。

## 新增模块

### `src/app/application-context.js`

职责：验证并冻结组合根所需的显式架构端口。

要求的端口契约：

- `commands.register()` 与 `commands.execute()`；
- `events.subscribe()` 与 `events.publish()`；
- `lifecycle.start()` 与 `lifecycle.destroy()`。

实现特征：

- 只接受非数组对象作为依赖输入；
- 对缺失或不完整端口抛出精确 `TypeError`；
- 返回只包含 `commands`、`events`、`lifecycle` 的浅冻结上下文；
- 不创建通用 services 容器，不承载 DOM、平台对象、模型对象或业务状态；
- 不访问 DOM、Storage、Tauri、Worker、网络或计时器。

### `src/app/create-application.js`

职责：组合应用公共 API，并把启动和销毁调用转交给显式注入的生命周期端口。

公共契约：

- `Application.start(): Promise<void>`；
- `Application.destroy(): Promise<void>`；
- `Application.commands`；
- `Application.events`。

实现特征：

- 构造时只创建并冻结公共应用对象；
- 构造期间不会调用命令、事件或生命周期端口；
- `start()` 将同一个冻结上下文传给 `lifecycle.start(context)`；
- `destroy()` 将同一个冻结上下文传给 `lifecycle.destroy(context)`；
- 生命周期异常原样向调用者传播，不捕获、不转换、不静默降级；
- 不在组合根内维护 started/stopped 状态，幂等、回滚和状态转换由 Atomic Task 1.3 的唯一生命周期所有者实现。

## 模块清单更新

`tests/architecture/fixtures/production-modules.json` 已加入：

- `src/app/application-context.js`；
- `src/app/create-application.js`。

生产文件清单由 57 个增加到 59 个。新增模块均归属 `composition` 层，不属于冻结模型；清单仍与实际生产 JS、Rust、CSS 和 HTML 文件集合完全一致。

## 新增测试

`tests/architecture/application-composition.test.mjs` 覆盖：

1. 构造返回冻结的 `start`、`destroy`、`commands`、`events` 公共 API；
2. 构造期间不调用任何注入端口；
3. 构造期间访问 DOM、Storage、Worker 等全局对象会触发测试陷阱；
4. `start()` 与 `destroy()` 使用同一个冻结上下文并保留生命周期端口 receiver；
5. 缺失或不完整的 commands、events、lifecycle 端口被拒绝；
6. 生命周期错误保持同一错误对象向外传播；
7. 两个组合模块不引用 DOM、Storage、Tauri、Worker 或 invoke；
8. 当前 `src/main.js` 未导入新组合根，证明本节点未切换运行链。

## CI 调整

`.github/workflows/stage-01-atomic.yml` 现在：

- 监听 `src/app/**`；
- 同时运行模块清单测试和组合根契约测试；
- 生成 `01-01-module-inventory.json`；
- 生成 `01-02-composition-root.json`；
- 继续执行现有 Node 回归、浏览器交互契约和前端生产构建；
- 上传统一的阶段 1 架构基础证据工件。

CI 只读取仓库和上传证据，不修改或自动推送仓库内容。

## 实施过程中的受控失败

首次原子应用运行 `30906678301` 在推送阶段失败。实际源码和清单生成步骤成功，但 GitHub 拒绝机器人更新 `.github/workflows/stage-01-atomic.yml`，原因是运行令牌没有 workflow 写权限。

处理方式：

- 失败提交未进入远端分支；
- 将源码与模块清单提交和工作流文件更新拆开；
- 源码与清单由只写普通文件的原子运行提交；
- 正式工作流由 GitHub 仓库连接器更新；
- 一次性应用和 README 同步工作流均已删除；
- 没有降低仓库权限、没有长期保留临时工作流、没有绕过测试。

## 专项验证结果

GitHub Actions run `30906897816`：**通过**。

- `npm ci`：通过；
- 模块清单测试：通过；
- 最小组合根契约测试：通过；
- 59 文件机器可读清单采集：通过；
- 组合根结构化证据生成：通过；
- 现有 `npm test`：通过；
- 浏览器交互契约：通过；
- 前端生产构建：通过；
- 证据工件上传：通过。

## 完整基线回归

GitHub Actions run `30906897895`：**通过**。

- Rust 1.88.0 工具链：通过；
- Tauri Linux 系统依赖：通过；
- 静态基线、公共契约和冻结模型哈希采集：通过；
- Node 回归：通过；
- 浏览器交互契约：通过；
- 前端生产构建：通过；
- 应用级浏览器回归：7/7 通过；
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`：通过；
- `cargo check --manifest-path src-tauri/Cargo.toml --locked`：通过；
- Tauri Linux release build：通过；
- 阶段 0 硬门禁复验：通过。

## 行为与兼容性

- 现有应用仍由原 `src/main.js` 和经典脚本链启动；
- 新组合根当前仅作为独立可测试架构边界存在；
- 未修改公共业务接口、用户数据、持久化格式、配置默认值、错误码或 UI；
- 未新增生产依赖；
- 未修改 9 个冻结模型/数据契约文件；
- 现有浏览器和 Tauri 行为保持不变。

## 已知限制

- 上下文采用浅冻结，只保护端口引用不可被组合根替换；端口内部状态仍由各端口自己的唯一所有者管理。
- `start()` / `destroy()` 的幂等、并发调用、启动失败逆序回滚、销毁异常聚合和状态机尚未实现，属于 Atomic Task 1.3。
- 命令重复注册、未知命令、事件 once、监听器异常隔离等行为尚未实现，分别属于 Atomic Task 1.5 和 1.6。
- 完整桌面回归运行在 Ubuntu 22.04；Windows 原生窗口、文件关联和桌面拖放不属于本节点验证范围。

## 节点结论

Atomic Task 1.2 已完成并通过专项验证与完整回归。后续 Atomic Task 1.3 可以在不接触业务功能的前提下实现唯一生命周期状态机，但本节点没有开始 1.3。
