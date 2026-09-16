# R12-10 — Opener

## 最新验收与交接（2026-09-17）

已核对实现提交 `4f52836e088459e90e7ab953f03b19122d950c86` 的 Actions [35004623556](https://github.com/uniquenesssta/mdr/actions/runs/35004623556)：状态 `completed/success`，四个 job 及全部步骤成功。Linux 拆分前后真实进程测试分别 7/7，URL 策略 8/8、真实后端拒绝 2/2、本地命令 12/12、其余累计 Rust 回归、完整 Rust 测试、Clippy `-D warnings`、Cargo check 均通过；前端 Node 422/422、依赖审计、架构/文档、生产构建、浏览器及最终工作区门禁通过。Windows/macOS 生产 Opener 编译链接通过，不将其描述为系统浏览器 GUI 交互验证。

R12-10 自动验收完成，阶段任务书 12.10 已勾选。本轮只更新 README、本文件与阶段任务书；未修改源码、测试、工作流或依赖，没有新增分支。文档定向契约 8/8、`verify:readme-record`、`verify:no-legacy-runtime`、`verify:generated-files` 与 `git diff --check` 通过；未因文档修改在本地重新执行完整 Rust/浏览器验收，上述完整通过结果仅对应已核对的实现提交。

R12-11 前置检查发现阶段任务书 §1.1 要求“不改变抓取限制”，但 §12.11 要求“最大响应和内容类型”及“重定向后再次验证”。现有 `web_fetch.rs` 和 R12-01 manifest 明确为无响应体字节上限、Content-Type 仅上报。主任务书、当前阶段任务书及历史记录未指定新增上限、允许类型或缺失类型处理。R12-11 停在范围确认，12.11 不勾选，不以等价拆分冒充安全策略验收；须先确认保留现状还是授权新增安全限制，再按确定的策略实施和验证。

**后续范围裁定（2026-09-17）**：用户已确认 12.11 先做等价拆分、新增安全限制单列 R12-S01；上述阻塞记录保留为历史，后续以阶段任务书及 [R12-11](R12-11-DETAILS.md) 的已确认边界为准，不表示安全加固已经完成。

以下为实施时记录，保留当时的验证限制。

## 输入与前置验收

继续使用唯一阶段分支 `agent/r12-stage`。实施基线 `db46e1b26eac069e3534831bcfd25c311bfa3050`，树 `c4f6aa1848dfa89fef133ec8a0b2d53fa3abd11d`；该提交的 R12-09 Actions [35000092958](https://github.com/uniquenesssta/mdr/actions/runs/35000092958) 已成功，前序实现 `21c8c06` 的 [34998792248](https://github.com/uniquenesssta/mdr/actions/runs/34998792248) 全部步骤也已成功。

从固定提交的 CI 源码归档恢复隔离工作区，核对整个 Git 树与提交哈希，修改前状态干净。没有访问或改写用户电脑上的工作区。规范基准是根规则、`AGENTS.md`、本目录主任务书与阶段 12 任务书；仓库没有 `docs/plans`，使用既有权威任务书，不另建替代计划。

## 责任与兼容性

新增 `src-tauri/src/external_link/opener.rs`，完整拥有 Windows ShellExecuteW、macOS open、Unix xdg-open 的系统启动和启动错误映射。三个 cfg、Windows UTF-16/NUL 终止与 ABI、错误码 <=32 的失败判断、Unix 单个原始参数与 spawn 语义均保留；只扩大到父模块所需的 `pub(super)` 可见性，格式由 Rust 1.88 rustfmt 统一。源码测试逐 token 对照基线，保留字符串字面量，只容许格式空白和尾逗号差异。

`external_link.rs` 删除全部系统打开实现，仍保留原有唯一命令 `open_external_url(url: String) -> Result<(), String>`，先调用 `validation::validate_external_url`，然后调用私有 Opener。不新增二次校验、包装转发层、公共 Opener API 或替代实现。原四项外链测试与 R12-09 两项后端拒绝测试不变。

调用链保持：前端 `link-client.js` → 既有 Tauri 命令 → 原始 URL 校验 → 系统 Opener。`validation.rs`、前端、`main.rs` 注册、Stage 10/11 契约、本地文件/文档存储/网页/日志模块、Cargo/npm 依赖及锁文件均不变。生产清单仅更新入口职责并添加一个无共享状态的系统边界，总数精确从 437 增至 438，既有条目顺序保持。

本任务无持久状态、事件监听、取消或过时结果回写；本地临时缓冲随函数返回释放。Unix 仍把“成功创建启动器进程”视为成功，不等待外部应用退出，也不承诺浏览器成功展示；原有分离进程行为未改造为等待/取消/进程监督，避免扩大范围或改变阻塞行为。Windows ShellExecuteW 的真实桌面成功/失败交互本轮没有自动化运行，不以编译检查代替此结论。

## 验证覆盖

新增 `src-tauri/tests/external_link/opener.rs` 七项 Linux 真实进程测试，在独立测试子进程中使用局部 PATH/HOME/XDG/BROWSER，不更改测试进程全局环境。覆盖找不到启动器、无执行权限、含 NUL 的参数错误、四协议和原始大小写/Unicode/转义/空格/命令字符作为单参数传递、外部处理程序失败时保留 spawn 成功、危险/无效输入在启动前拒绝、私有 Opener 不重复校验。

合法启动链实际调用已安装的 `/usr/bin/xdg-open`，由其调用指定的本地 BROWSER 回执应用，不用替代 xdg-open 或 Opener Mock，也不打开真实浏览器或访问网络。BROWSER 回执只证明系统启动器的调用与参数传递，不代表真实浏览器 UI 验收。错误路径使用不存在或无执行权限的可执行文件路径，交由真实 OS 返回错误。测试子进程有超时、终止、回收与独占临时目录清理。

Actions 先将同一份七项测试加入 `db46e1b` 的隔离归档（生产代码不变），再在拆分结果运行同样七项，分别断言 7/7。新增 `external_link_opener_platform.rs` 直接引入生产 Opener 文件；Windows/macOS runner 使用 Rust 1.88 编译、链接并验证函数签名，以捕获 cfg/可见性/FFI 链接退化，不声称已启动系统 GUI。

新增七项 Node 契约，覆盖完整平台实现对照、命令入口、冻结上下游、实际进程测试内容、清单唯一归属、旧工作流步骤完整保留、拆分前后与原生验证。R12-09 的旧整份入口断言改为精确验证剔除平台代码后的入口，同时由新增对照测试负责验证抽离平台代码，未删除兼容性保护。

## 本地结果与 CI 状态

修改前相关 Node 契约 23/23 通过。修改后定向 Node 71/71、Rust 1.88 格式检查、真实已安装 xdg-open 的五种参数回执及处理程序失败冒烟通过。全量 Node 本地运行 399 项：392 通过，7 项因未安装 CodeMirror/marked/Vite 等依赖加载失败；架构检查同样报告 19 项缺少依赖的导入失败。`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record` 通过。

本地没有 Cargo/rustc 或完整浏览器依赖，不能宣称 Rust 行为测试、Clippy、完整前端与浏览器测试通过。专属 `.github/workflows/r12-10.yml` 将检出事件精确 SHA，执行拆分前后真实测试、原生 Win/mac 编译链接、R12-01 至 09 全部累计测试、完整 Rust/Clippy/check、锁定前端安装、依赖审计、完整 Node、架构、生产构建和浏览器门禁，保留严格 Schema 核对归档和最终工作区洁净检查。09 改为手动历史入口，原完整步骤不变，10 是唯一阶段自动入口。

Context7 查询了 Rust spawn/Child 行为，返回官方主分支文档而非固定 1.88 快照，因此兼容性以锁定编译器、现有生产实现和同源前后测试为准。Rust 与 freedesktop 官方文档用于确认进程创建和系统启动器的职责，不据其另加功能或依赖。

完整 Actions 尚未判定通过，12.10 暂不勾选，禁止进入 R12-11。

## 清理与回退

没有新增生产依赖、用户配置或数据格式变更，不需要迁移或用户操作。仅 CI 安装现有系统启动工具 xdg-utils，新增原生编译矩阵；测试/构建产物全部归入 runner 临时目录。旧入口只保留尚未进入 R12-17 的命令/测试职责，不保留第二套系统打开实现。

回退当前 R12-10 实现提交即可恢复原平台函数、09 自动流程及清单计数，不回退已验证的 07/08/09 结果，不影响用户文档数据。未实施 R12-11 Web Validation 或 R12-17 Commands。
