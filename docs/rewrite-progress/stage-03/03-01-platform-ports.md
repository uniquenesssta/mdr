# 阶段 3 Atomic Task 3.1：平台端口定义

## 结果

Atomic Task 3.1 已实施。当前节点只建立业务中立的平台端口契约，没有提前实施 Atomic Task 3.2 的能力探测、后续 browser/desktop adapter、`createPlatform()` 组合或生产调用链切换。

## 实际实现

- 新增 `src/platform/index.js` 作为平台契约唯一公共入口。
- 在 `src/platform/ports/` 中按职责拆分 12 个端口：`storage`、`files`、`dialogs`、`window`、`dragDrop`、`documentStore`、`web`、`links`、`logs`、`clipboard`、`fullscreen`、`print`。
- 每个端口拥有独立方法清单、JSDoc 契约、实现校验和独立 `destroy()`，不暴露 Tauri 类型、Tauri 命令名、浏览器全局对象或业务状态。
- 新增共享 `port-contract.js`，只负责结构校验、方法绑定、订阅 disposer 所有权、延迟订阅结果清理、逆序销毁、幂等销毁和错误保真。
- 新增 `platform-port-set.js`，只负责 12 个已注入实现的不可变聚合与逆序销毁，不负责环境识别或 adapter 创建。
- 冻结 `tests/unit/platform/fixtures/platform-port-inventory.json`：覆盖旧 `window.markdownEditorNative` 的 33 个方法，以及 13 个直接浏览器能力入口；每一项均映射到明确的新端口方法。
- 未修改旧 `src/runtime/tauri.js`、旧全局 native 对象、业务调用者、Rust 命令、DTO、持久化格式、依赖或锁文件。旧实现仍是生产权威，后续 Atomic Task 按任务书逐能力切换并删除。

## 契约边界

- 对话框取消值属于正常返回值，端口层不转为异常。
- 参数、返回值和原始错误对象由端口原样传递；具体校验、归一化、命令字段和降级策略由后续 adapter 拥有。
- 订阅方法必须返回 disposer；端口负责 disposer 的一次性调用和逆序清理。
- 销毁开始后不允许新增调用；销毁期间才完成的订阅结果会立即清理，不进入活动订阅集合。
- 端口销毁与聚合销毁均幂等；多个清理错误使用 `AggregateError` 保留，不静默忽略。
- 订阅实现必须最终 settle；本节点不增加超时或吞错策略，以免改变后续 adapter 的错误语义。

## 验证

- `node --test tests/unit/platform/platform-ports.test.mjs`：9/9 通过。
- 新增 JavaScript/MJS `node --check`：通过。
- `git diff --check`：通过。
- 受控 GitHub run `31085398513`（Node `22.23.1`、npm `10.9.8`）：通过精确 24 文件重建、Stage 2 交接、Atomic 3.1 9/9、架构硬门禁、完整 Node `36/36`、浏览器契约 `10/10`、2179 模块生产构建和构建后真实应用 `12/12`。
- 证据制品：`atomic-3-1-controlled-31085398513-1`，artifact `8961186920`，zip SHA-256 `9005b718782bb26c8fd11868e37835b0b015da6642cca697542bec986a535198`。
- 跨阶段证据兼容修复：正式 Stage 2 run `31085993955` 的功能与构建门禁全部通过，但旧记录器固定总模块数 `139`；受控 run `31086382159` 将门禁改为精确验证 Stage 2 自有 `72` 个模块，并确认 Stage 2/3 证据生成同时通过。

## 限制与后续

- 当前生产代码尚未消费新端口，这是 Atomic Task 3.1 的明确边界，不是双实现切换完成声明。
- 浏览器/桌面能力探测属于 Atomic Task 3.2，尚未开始。
- invoke、dialog、window、drag/drop、filesystem、document store、web、link、log 等 adapter 由后续独立 Atomic Task 实施。
- Windows 原生窗口、系统对话框、文件路径和拖放仍需在对应 adapter 切换节点执行真实平台验证。
- 依赖审计继续保留既有 `1 low / 1 high`，按既定决定延后至全部任务完成后的本地真实运行测试阶段处理。
