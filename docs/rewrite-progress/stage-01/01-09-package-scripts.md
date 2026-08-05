# 阶段 1 / Atomic Task 1.9：package scripts

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 继续进行；Atomic Task 1.9 已完成，Atomic Task 1.10 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 上一节点基线：`1100fa96209d59844423a2e50900dd29fa42a55d`
- package scripts 提交：`ce050bd55943ca5a7f1ea2cc012cd10a18f56c7d`
- 契约测试提交：`87f8adb5d36c2768780bfa14ac15526c7765838f`
- 阶段 1 专项验证：GitHub Actions run `30973431231`
- 专项证据工件：`stage-01-architecture-foundation-30973431231-1`
- 专项证据工件 ID：`8917378528`
- 专项证据摘要：`sha256:9dde4e8ae7a68d7573994bb0cf3c8fd91855083c8d17d1846f92cf182c70a33a`
- 完整基线回归：GitHub Actions run `30973431241`
- 完整基线工件：`stage-00-baseline-30973431241-1`
- 完整基线工件 ID：`8917507554`
- 完整基线摘要：`sha256:b35e3769e3aadaa70990d6f88a72669d4e3ab81d37a3cea9a21fc12b6caaf8e2`

## 实际目标

为 Atomic Task 1.8 已建立的四个架构检查脚本提供稳定、可发现、可由 npm 统一调用的 package 级入口，同时保持所有既有 package 命令的名称和执行语义不变。

本任务只处理验证入口和入口契约，不修改架构检查实现、不迁移业务功能、不修改构建流程。

## 实际变更

### `package.json`

新增四个 npm scripts：

```json
{
  "verify:architecture": "node scripts/verify-architecture.mjs",
  "verify:no-legacy-runtime": "node scripts/verify-no-legacy-runtime.mjs",
  "verify:generated-files": "node scripts/verify-generated-files.mjs",
  "verify:readme-record": "node scripts/verify-readme-record.mjs"
}
```

四个入口均直接调用仓库内已提交的 Node.js 脚本：

- 不调用 `vite`；
- 不调用 `npm install`、`npm ci`、`npx` 或其他包管理器；
- 不读取 `dist/`、Rust `target/` 或其他构建产物；
- 不调用 `curl`、`wget`、HTTP/HTTPS 或 `git fetch`；
- 不通过 `&&`、管道或额外 shell 链路隐藏前置步骤。

### `tests/package-scripts.test.mjs`

新增独立 package scripts 契约测试，职责仅限验证 package 命令入口。

覆盖内容：

1. 精确检查既有命令字符串，防止当前任务改变旧语义：
   - `dev`
   - `build`
   - `preview`
   - `tauri:dev`
   - `tauri:build`
   - `test`
   - `test:browser:contract`
   - `test:browser`
   - `check`
2. 精确检查四个新命令与对应脚本路径的映射。
3. 检查每个目标脚本文件真实存在。
4. 拒绝构建、生成目录、包安装、联网和复合 shell 依赖。
5. 通过 npm 真实执行四个入口，并要求每个进程返回退出码 `0` 和明确的 `passed` 输出。

## 保持不变

以下内容未改变：

- `npm run dev` 的 Vite 开发服务语义；
- `npm run build` 的前端生产构建语义；
- `npm run preview` 的监听地址和端口；
- `npm run tauri:dev` 与 `npm run tauri:build`；
- `npm test` 的原命令字符串；
- 两个浏览器测试命令；
- `npm run check` 的原执行顺序和组成；
- `package-lock.json`；
- dependencies 与 devDependencies；
- 所有生产 JavaScript、Rust、CSS 和 HTML 文件；
- 模型内核、冻结哈希和数据契约；
- 持久化格式、公共接口和用户可观察行为。

生产模块清单仍为 67 个。

## 影响范围

直接修改文件：

- `package.json`

新增验证文件：

- `tests/package-scripts.test.mjs`

本任务没有：

- 修改 Stage 1 架构扫描算法；
- 将架构检查并入现有 `check` 命令；
- 新增生产依赖；
- 新增运行时状态或副作用；
- 修改应用启动、销毁、命令、事件或模型调用链。

未将架构检查并入 `check` 是为了满足“保留现有命令语义”的硬性要求。架构入口由独立 `verify:*` 命令提供，后续调用者可显式选择需要的门禁。

## 最小验证

### package scripts 契约

由 `npm test` 自动执行 `tests/package-scripts.test.mjs`。

实际验证结果：

- 既有 9 个 package 命令字符串全部保持精确一致；
- 4 个新架构入口映射全部正确；
- 4 个本地目标文件全部存在；
- 禁止构建产物、包安装、联网和复合 shell 依赖的断言通过；
- `npm run verify:architecture -- --root=<repository>` 通过；
- `npm run verify:no-legacy-runtime -- --root=<repository>` 通过；
- `npm run verify:generated-files -- --root=<repository>` 通过；
- `npm run verify:readme-record -- --root=<repository>` 通过。

### 阶段 1 专项回归

GitHub Actions run `30973431231` 全部通过：

- 模块清单契约；
- 最小组合根；
- 生命周期；
- Disposer Registry；
- Command Bus；
- Event Bus；
- Model Kernel；
- Atomic Task 1.8 架构扫描契约；
- 架构硬门禁；
- 包含 1.9 契约的完整 Node 回归；
- 浏览器交互契约；
- 前端生产构建；
- 证据工件上传。

### 完整基线回归

GitHub Actions run `30973431241` 全部通过：

- 静态基线与冻结契约采集；
- npm 依赖安装；
- 包含 1.9 契约的 Node 测试；
- 浏览器交互契约；
- 前端生产构建；
- 构建后应用浏览器回归；
- `cargo test --locked`；
- `cargo check --locked`；
- Tauri Linux release build；
- Stage 0 证据汇总与硬门禁。

## 失败路径验证

契约测试会在以下情况直接失败：

- 任一旧 package 命令字符串被改写；
- 任一 `verify:*` 命令改为错误路径；
- 对应脚本文件缺失；
- 命令加入构建、`dist`、`target`、包安装或联网依赖；
- 命令加入 `&&`、`||`、管道或分号；
- npm 调用返回非零退出码；
- 架构脚本没有输出明确的通过结果。

## 兼容性结论

- 公共运行时接口：未改变。
- 用户可观察行为：未改变。
- package 既有命令：名称和命令字符串均未改变。
- 新增能力：仅增加四个显式验证入口。
- 构建兼容性：完整前端和 Tauri 构建通过。
- 数据兼容性：未触及数据或持久化。
- 模型兼容性：未触及冻结模型文件或其导出。

## 已知限制与剩余风险

- `verify:*` 入口依赖 Node.js 和当前仓库文件，这是预期的开发期验证依赖。
- 本任务未把新入口合并进 `check`，避免改变旧命令语义；调用者需要显式运行所需的 `verify:*` 命令。
- 未新增联网验证，因为任务明确要求架构检查不得依赖联网。
- 未新增 Windows 专用 CI runner；测试通过 `npm.cmd` 分支保留 Windows 启动兼容路径，当前实际 CI 环境为 Ubuntu 22.04。

## 清理确认

- 未产生或提交 `dist/`、`target/`、日志、临时夹具或调试文件。
- 未新增临时兼容层。
- 未留下重复 package 入口。
- 未修改 `package-lock.json`。

## 下一节点

Atomic Task 1.9 已完成并通过专项与完整基线验证。

Atomic Task 1.10 尚未开始。1.10 负责阶段 1 README 与交接收口，不得在未收到用户明确指令时自动开始。
