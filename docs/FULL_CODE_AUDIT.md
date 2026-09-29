# MDR 全仓代码审计、Windows 验收与任务书约束评估

> **A01 修复跟进**：2026-09-29 用户要求提前修复 R12-14，现已完成 Windows 专项验证（14 项脱敏、真实 JSONL 回读及 227 项 Rust 通过）。A01 标记为已修复；原发现和审计证据保留，本项验收及 Windows 运行结果以 [R12-14 详情](R12-14-DETAILS.md) 为准，其他 A02～A10 状态不变。

> **A02 整改进行中**：R12-18 已替换过时门禁并补齐真实清单；Windows 验收待完成。新增暴露的 Preview 循环依赖保留为真实失败，归 12.22/12.24。见 [R12-18 详情](R12-18-DETAILS.md)，原发现与历史证据不变。

审计日期：2026-09-29 UTC。代码基准：`74e3184e2d175abc84b7e4db786ad71cc3fb2aaf`，对应生产实现 `3cc56f0`。分支：`agent/r12-stage`。本报告替代首次审计对“完整范围”的表述；历史记录仍见 `CURRENT_AUDIT.md`。

> **整改排程更新（2026-09-29）**：用户要求先完成 R12 原计划至 12.17，再执行新增 12.18～12.24，之后才能进入 R13。A05 明确转交 R13-S01，A04 转交 R15.4/15.7，其余当前关键问题在 R12 收尾处置；完整对应关系、后移条件和验收见 [R12 任务书](markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md)。合理约束已写入 [全局 §0](markdown-main-full-rewrite-taskbook-18-docs/01-全局架构规划与基线冻结.md)。本次只改任务书；以下原始发现和历史验证结果不变，不代表产品问题已修复。

## 裁定

**目前不通过验收。全仓范围静态审计已完成，Windows 动态检查已实际执行，但累计测试仍失败。任务书存在过强的实现冻结和过时历史断言；数据安全、模型契约和真实验证要求应保留。**

本次落地：仅 Windows 的验证策略、停用非 Windows 历史工作流、递归全仓 Node 测试入口、Windows 测试路径/环境/Unix 测试导入修正。未修复下列产品缺陷，未改变算法、持久化格式、依赖版本或安全策略，未开始 R12-15。Rust `path_policy.rs` 的修改只发生在 `#[cfg(test)]` 内。

## 全仓范围及证据等级

不是只看 R12-14 差异。基准提交全部 **882 个代码类文件、111,958 行**均纳入逐文件全文静态扫描；另覆盖 **33 个 JSON 配置、清单和锁文件**。清单含路径、行数、SHA-256、所属域和规则命中。所有现有代码后缀 `.js/.mjs/.cjs/.rs/.ps1/.css/.html/.yml/.yaml/.toml` 均包含。Git 外的 node_modules、构建产物和第三方完整源码不属于仓库代码审计范围；依赖使用锁文件与漏洞公告核对。图片、字体和 SVG 作为静态资源引用核查，不计入代码行数。

- [逐文件清单](audit/full-code-inventory.csv)：代码与配置均有记录，不将自动扫描标成逐行人工审阅。
- [扫描规则与结果](audit/static-scan-evidence.json)：HTML 注入点、动态执行、unsafe、进程边界、写入、异步资源与空 catch。命中是审查线索，不直接计为漏洞；相对 import 扫描中的字符串夹具已区分。
- 深入阅读和跨模块追踪集中于启动/销毁、文档身份/会话、保存/关闭、Rust 缓存/快照/日志、预览/混合 HTML、Worker 代次、系统文件/链接/网络/日志、权限与测试门禁。其他叶子模块结合全文扫描、公共接口、依赖关系和现有测试审查。
- 补充全量检查：52 个 CSS 文件解析通过；全部 45 个 workflow YAML 可解析且所有活动 job 指向 Windows；1,096 个跟踪文本文件的高置信密钥模式扫描未命中（不等于证明没有任何秘密）。生产范围扫描得到 14 个 HTML sink、65 个写入线索、71 个异步资源线索、18 个空 catch、1 个 unsafe 块、4 个进程边界线索，用作跨模块复核线索，不按命中数计算漏洞。
- 静态语法检查：713 个当前 JS/MJS/CJS 文件全部通过。该检查不是 Linux 产品验收。见 [结果](audit/js-syntax-results.json)。
- 动态证据只能覆盖实际运行的路径；未做每条路径形式化证明、全状态穷举或全部故障注入。Windows 安装包、文件关联、真实 ShellExecute、休眠/断电恢复仍是明确的验收缺口。

| 范围 | 代码文件 / 行数 | 审计重点与结论 |
|---|---:|---|
| app/bootstrap/main | 13 / 2,622 | 生命周期、组合根、销毁顺序；主入口仍有较多阶段兼容编排，属于后续阶段治理，未据行数判 bug |
| documents | 24 / 1,980 | 会话代次、关闭、路径绑定、元数据持久化；发现存储失败被吞，A09 |
| editor + 旧 editor/model | 38 / 4,171 | 命令、CodeMirror 边界、事务、冻结算法；现存测试有过时导入，A02 |
| hybrid-editor | 49 / 5,724 | 状态机、Widget、资源释放、源码编辑；原始 HTML 挂载无净化，A03 |
| preview + 旧 preview | 47 / 7,114 | Worker 请求/代次、增量/虚拟渲染、DOM sink；A03，实际 Windows 浏览器已有通过证据 |
| persistence/storage | 14 / 2,432 | 保存串行队列、分段上传/加载、自动保存、关闭保存；A09，Rust 下层 A07 |
| sync + 冻结 selection mapping | 13 / 3,220 | 反馈抑制、滚动归属、RAF 取消、过期结果；Windows 旧测试路径问题已修，历史计数断言待治理 |
| layout/menu/sidebar/window | 49 / 5,630 | ResizeObserver、拖拽、菜单路由、关闭状态；保留实际 Windows GUI 验收缺口 |
| settings/help/i18n/theme | 61 / 5,611 | schema 校验、草稿提交、存储回滚、语言/主题切换；未确认新增阻断缺陷，相关浏览器场景通过 |
| platform/runtime | 39 / 3,398 | invoke DTO、能力集、外链/抓取/日志；A01/A04/A05 |
| UI/shared/styles | 74 / 6,923 | DOM/focus、CSS 层、响应式/可访问性；Windows 浏览器检查通过，旧样式测试读已删文件失败 |
| public classic/compatibility | 7 / 3,084 | 兼容宿主、残留全局、历史边界；作为阶段迁移债务审查，不恢复已删旧实现 |
| Rust 生产源文件 | 54 / 5,503 | document_store、local_file、external_link、web_fetch、performance_log；A01/A04–A08 |
| Rust 测试 | 12 / 2,575 | 行为与故障覆盖；缺失败后缓存一致性/Windows 大小写缓存测试 |
| scripts | 29 / 4,873 | 依赖位置、架构扫描、基线/evidence 脚本、Windows driver；规则比真正行为更易被检查，A02/A10 |
| workflows | 45 / 8,313 | 历史复制、OS 范围、真实/模拟区分；当前活动 job 已全部限制 Windows |
| Node 测试/夹具、根配置等 | 其余全部见清单 | 290 个 `.test.mjs` 进入递归入口；加载失败不能等同其中内部用例已执行 |

表中是基准提交数量；本次新增审计脚本与证据不回填成基准生产模块。

## 发现与修复优先级

P1：阻塞验收的数据可靠性/安全问题。P2：需修复或明确接受的风险。静态确认指代码逻辑可确认；并不表示已在 Windows 注入该故障。

| 编号 | 级别 | 问题 | 证据与状态 |
|---|---|---|---|
| A01 | P1（已修复） | 前端先将嵌套日志对象序列化为字符串，Rust 仅按结构化字段递归脱敏，正文/token/path 及自由错误文本可绕过 | 生产 JS 探针 + Rust 路径静态追踪；仅 debug 后端写日志，release 不写；原 6 个 Rust 测试未覆盖跨端链路 |
| A02 | P1（验收证据） | 根 npm test 未递归；旧测试仍引用删除路径、旧导出、固定模块总数；manifest 漏项 | 全仓测试实跑确认；此次只补全入口及 Windows 适配，未把历史失败跳过 |
| A03 | P1 风险 | 不可信 Markdown 的 raw HTML 进入 template.innerHTML，再挂载到主 DOM；Tauri CSP 为 null | 确认 parser 保留事件属性及两个真实挂载点；尚无 Windows WebView 脚本执行/IPC利用复现 |
| A04 | P2 | 日志批次部分写入后出错，前端重排整批并短间隔重试，可能重复记录/持续重试 | `performance_log.rs` 循环 append 与 `performance.js` catch/requeue；静态确认 |
| A05 | P2 | Web Fetch 响应未限大小，跳转只限次数，未按目标/最终 URL 重验内网策略 | 源码确认，已知 R12-S01 未完成；是否允许内网需产品策略，不能据此自动改行为 |
| A06 | P2 | 用户原文件用 fs::write 覆盖，截断后写失败可能丢失旧内容 | `local_file/text_writer.rs:10`、binary writer；未做 Windows 磁盘满/断电故障注入 |
| A07 | P1 | Rust 保存失败后仍保留被修改的缓存正文/版本，重试可能失配 | `document_store/store.rs:245–274`、`cache.rs:121`；静态确认，详见下文 |
| A08 | P2 | Windows 大小写路径别名已共用锁，但仍存在不同缓存项，更新/删除可留下旧缓存 | `cache.rs:73–84,121`；Windows 默认不区分大小写目录下成立，尚未动态复现 |
| A09 | P1 | Web Storage 写失败仍报告 saved=true，并清除 dirty；原生文档目录元数据也可能未持久化 | 生产 JS 注入失败 storage 已复现；见探针与输出 |
| A10 | P2 | Rust 锁文件存在当前公告命中，既有 npm audit 不覆盖 Rust | RustSec 数据库比对；rustls 确认进入 Windows 构建，其余按可达性区分 |

### A07：保存的内存提交早于耐久提交

`DocumentStore::save()` 从 cache checkout 到 lease。全量保存先替换 `content/version/title`，再 `write_snapshot()`；增量保存直接在缓存正文上 `apply_transactions()`、推进版本，再 `append_journal()`。`?` 返回错误后 lease 的 Drop 仍把当前 document 放回缓存，没有回滚或失效处理。

可复核用例：先成功保存 v1，再让 `changes.jsonl` 无法 append（例如路径成为目录），提交 v1→v2。调用会失败，但同进程读取可得到 v2；修复磁盘后以 v1 重试可能 VERSION_MISMATCH，新进程则只能从磁盘得到 v1。另一个变体是一组事务前段有效、后段范围非法：前段修改可留在旧版本缓存中。`journal/replay.rs` 的恢复路径先在副本上应用，在线保存路径却没有这种隔离。

修复方向：显式设计“计算下一状态—耐久提交—发布缓存”的提交点；失败不能把未提交正文当成已提交状态。兼顾大文档内存成本，不强制无条件复制全文。验收需覆盖部分事务失败、journal 打开/写/同步失败、snapshot 各阶段失败、重试和重启一致性。

### A08：Windows 路径身份与缓存身份不一致

`admission_key = key.to_ascii_lowercase()` 只用于排他队列；`documents.remove(&key)` / `insert(self.key, ...)` 仍以原大小写区分。`Doc` 与 `doc` 可指向同一磁盘目录，却各自保留不同版本。先缓存两个名称，再通过一个名称保存或删除，另一个名称仍能读取旧内容。

这不是普通 UI 随机小写 ID 的必现故障；它需要导入/恢复/调用者出现别名。修复应统一或拒绝别名身份，并处理历史数据；不能只扩大锁。Windows 验收应覆盖大小写别名保存、读取、删除和重新加载。

### A09：持久化失败未传播到“已保存”状态

`browser-document-repository.js:77–100` 捕获异常返回 false；`document-session-controller.js:147,159` 忽略返回值并返回 `saved: true`。非原生分支 `session-document-repository.js:134` 已调用 `markPersisted()`。

[可运行探针](audit/probe-storage-quota.mjs) 使用真实生产模块，只注入始终抛 QuotaExceededError 的 storage 与最小 model/load 能力。运行 `node docs/audit/probe-storage-quota.mjs`，结果是 [saved=true、dirty=false、写入 0 字节](audit/storage-quota-probe.json)。这是确定的 JS 逻辑复现，不能标成真实 Windows 磁盘故障复现。

对 Windows 原生模式还需检查会话索引写失败后 snapshot 可否重新发现；native body 落盘成功并不意味着 session 元数据已经保存。修复需让失败向上抛出/聚合，并且只有所需耐久写入全部成功才能确认保存、切换或关闭。

### A03：HTML 风险的边界

两条路径是 `preview/render/preview-dom-renderer.js:49` 和 `hybrid-editor/widgets/html/html-block-view.js:11–12`。主窗口 `src-tauri/tauri.conf.json` 的 `security.csp` 为 null。当前行为冻结测试甚至要求保留 raw HTML 语义，不能把“与旧实现相同”当安全证明。

尚未证明具体 WebView 中的事件执行、可调用命令或数据外传，所以本报告不宣称已完成漏洞利用。建议单列 Windows 无害事件标记测试，并按富文本需求确定净化/隔离与 CSP；不要只过滤 `<script>`，也不要仅靠外链 URL 校验修复 DOM 注入。

### A10：Rust 依赖公告核对

核对 `Cargo.lock` 的 458 个 package 条目，来源为官方 [RustSec advisory-db](https://github.com/RustSec/advisory-db) 的 `f23b768236fe2880e4cfa167da662cad8ca79240`（2026-09-29）。逐条解析 TOML 范围并比对锁定版本，不冒充 cargo-audit，也不将 lockfile 中存在等同于 Windows 可利用。见 [候选与范围](audit/rust-advisory-candidates.json)。

- `rustls 0.23.41` 命中 [RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)，公告修复版为 >=0.23.45；Windows CI 确认编译该版本，应用通过 reqwest 使用 rustls。公告描述 TLS 1.3 加密层边界检查错误，不代表攻击者能伪造整个握手。
- `time 0.3.41` 命中 [RUSTSEC-2026-0009](https://rustsec.org/advisories/RUSTSEC-2026-0009.html)，修复版 >=0.3.47；触发需要 RFC2822 格式解析恶意输入，尚未确认应用可达路径。
- `quick-xml 0.38.4` 命中 [0194](https://rustsec.org/advisories/RUSTSEC-2026-0194.html)、[0195](https://rustsec.org/advisories/RUSTSEC-2026-0195.html)，修复版 >=0.41.0；Windows 构建确有使用，但不可信 XML 能否到达对应 API 尚待确认。
- `quinn-proto 0.11.14` 命中 [0185](https://rustsec.org/advisories/RUSTSEC-2026-0185.html)；当前 Windows 编译日志未出现该 crate，不能据 lockfile 将可选 HTTP/3 路径算成启用。
- 另有 6 条 unmaintained 提示及 glib 的 unsound 公告；glib 不作为本次 Windows 产品漏洞结论。未维护提示与可利用漏洞分开记录。

本次不升级锁文件。升级需先确认 MSRV、Tauri/reqwest 兼容和真正可达功能，再在 Windows 运行对应回归。

## 任务书约束是否过强

**部分过强，而且不只是任务书正文；历史验收测试及 CI 把阶段临时约束扩大成了永久约束。** 全局任务书其实明确 Rust 文件可重写拆分、冻结的是格式；现有旧测试却仍读取被删除的 `src-tauri/src/document_store.rs`。不能把所有问题归因于“模块化要求太严格”。

| 约束 | 判断 | 建议 | 本次状态 |
|---|---|---|---|
| 8 个模型核心算法、偏移/版本/事务结果冻结 | 必要 | 保留哈希/契约；已确认缺陷走独立变更 | 保留 |
| 快照/事务日志格式、双槽恢复兼容 | 必要 | 保留真实往返/损坏恢复；不固定已删除 Rust 文件路径 | 保留；记录旧门禁错误 |
| 单一状态所有者、跨 feature 公共边界、异步代次与销毁 | 必要 | 以依赖图及行为测试约束，不以总文件数替代 | 保留 |
| Windows/Linux/macOS 同时验收 | 对当前交付范围过强 | Windows 为唯一门槛，其他平台无验证义务 | **已取消 Linux/macOS** |
| 当前模块总数固定 381/442 等历史数值 | 过强且互相矛盾 | 校验真实文件集合与职责记录一一对应，允许新增/删除 | 只提出整改，未改成假全绿 |
| 当前 README 必含 Stage 10、长度 120–360 等 | 过强 | 历史事实查历史记录，当前入口允许反映最新阶段 | 记录为失败原因 |
| 广泛完整源码/字符串冻结 | 对实现形态过强 | 真正冻结值/格式保持；其他用语义/接口/故障测试代替 | 仅接受明确的 Windows 测试导入差异，未全面放开 |
| 每个新 Atomic 都重编多个旧基线 + 重复 HTTP 套件 | 成本偏高 | 旧证据按 SHA 归档；当前 HEAD 完整回归；仅影响契约时做旧/新对比 | 暂保留真实历史比较，修复 Windows 路径 |
| 每个小职责都要求独立文件、转发与长说明 | 易过度拆分 | 按独立状态、生命周期、复用/变更理由拆分；无价值转发可合并 | 建议，不自动合并源码 |
| 必须放依赖于父目录 | 与便携运行冲突 | 如确为执行环境要求则说明适用范围；普通仓库环境允许标准 npm ci | 现规则保留，CI 遵循它 |
| 失败即停 | 产品发布必须停；证据收集不宜停 | 独立套件继续收集，任何失败仍导致 job 失败 | 全仓 Node 收集完再非零退出 |
| Clippy -D warnings、真实路径验证、禁止吞失败 | 必要 | 修正 Windows 未使用导入，不关闭警告；编译链接不能代替真实打开 | 保留 |
| 安全行为只能等未来阶段才能改 | 对已确认高风险缺陷不宜永久冻结 | 单列可审批的安全修复，不混入等价拆分；明确新的行为契约 | 此次仅审计，无产品改动 |

最优先的约束整改是修复过时门禁与真实文件清单，然后把“保持旧代码”转成“保持必须兼容的可观察行为”。放宽目录/文件数量不能解决 A01/A07/A09，新增边界故障测试才是这些问题的对应措施。

## Windows 验证与尚未完成的验收

唯一有效平台策略见 [WINDOWS_VALIDATION_POLICY.md](WINDOWS_VALIDATION_POLICY.md)。43 个旧工作流逐 job 设为禁用；保留当前 R12-14 四个 Windows job 和原有手动 Windows 窗口 job。历史 runner 字样留作历史定义，不会再调度 Linux/macOS。

第一轮真实 Windows [Actions 36552018968](https://github.com/uniquenesssta/mdr/actions/runs/36552018968)，精确提交 `72fe293`：

| 检查 | 结果 | 说明 |
|---|---|---|
| 当前 Rust 全量 cargo test | 206 + 5 + 1 + 6 通过 | Windows 条件下实际执行；不是历史 Linux 217 计数 |
| Rust 脱敏 | 6/6 通过 | 未覆盖 A01 跨端缺口 |
| cargo check | 通过 | Windows 实编译 |
| Clippy | 失败 | 两个仅 Unix 测试使用的导入未 cfg-gate；已修正，等待新轮确认 |
| 历史基线比较 | 失败 | Windows tar 不接受未规范化的临时路径；已用 cygpath 修正 |
| 前端阶段定向 | 113/113 通过 | 保留累积边界 |
| 根 Node | 452/453 | 唯一失败要求当前 README 含 Stage 10 |
| 全仓 Node | 1297/1416，119 失败结果 | 含 14 个测试文件 URL 转路径导致的成批误报；不是 119 个产品 bug |
| Windows 浏览器 contract / built app | 10/10、29/29 通过 | 实际 Windows Chrome，仍不等于原生 WebView 全验收 |
| 原生 opener | 编译/链接/签名通过 | 不证明系统浏览器实际启动 |
| npm audit / build / 四项 verify CLI | 通过 | npm 无公告结果不覆盖 Cargo；CLI 不代替全仓 architecture 测试 |

后续 Windows 迁移迭代以及最终结果写入本节的增补记录。第二轮因 npm exec 将 node 误识别为待安装包而未启动递归测试，不能算重跑通过；已改为官方支持的 `--call` 命令形式。测试 URL 路径修正、tar 修正和测试导入修正都不改变产品行为。

验收仍需要：修复已确认 P1；治理过时测试并补齐漏项；全部 Windows 当前回归通过；补真实 Windows 安装/启动/文件关联/外链，以及保存失败、异常退出、恢复的链路证据。R12-14 不勾选完成，R12-15～17 未开始；不以审计完成代替产品验收完成。

### Windows 全仓复跑增补

提交 `4d443ea` 的 [Actions 36553566571](https://github.com/uniquenesssta/mdr/actions/runs/36553566571) 已实际跑完递归 Node：**1418 个结果，1378 通过、40 失败**。其中 architecture 368/335/33（总/过/失败），根测试 453/452/1，UI 42/41/1，unit/editor 46/44/2，unit/platform 136/133/3，其余目录无失败；8 个独立 e2e 文件在 Windows 实际执行通过。[失败名称清单](audit/windows-node-results.json)。这些是 runner 报告结果，不把加载失败文件内尚未展开的测试当作已执行。

前一轮 `e5eea0c` 已确认 tar 路径修复生效、Windows Clippy 与 cargo check 通过；还暴露了真实 HTTP 夹具的 Windows 非阻塞 socket 继承问题（WSAEWOULDBLOCK / 10035），导致 HTTP 基线 6/9、当前 Rust 主测试 205/206。夹具已显式将 accepted socket 切回阻塞，再设置原有 2 秒超时；仍使用真实 TCP/reqwest、原来的 9 个断言，无忽略测试。旧/新基线使用同一修正后的夹具，原产品源、超时、响应策略保持不变。

### 最终验证提交

最终代码与 CI 配置提交为 `18fe040dc96fbcc26898b901ef25495006a28ec9`，真实 Windows 运行见 [Actions 36554016082](https://github.com/uniquenesssta/mdr/actions/runs/36554016082)。后续提交仅归档本轮报告和证据。平台结论针对 `agent/r12-stage` 当前工作流配置，不表示其他未修改的历史分支也已应用同一策略。

完整 Node 再次得到 **1418 项、1378 通过、40 失败**，与前次一致。前端构建、依赖审计、四项架构/文档 CLI、浏览器 contract、built-app 浏览器回归、原生 opener 编译链接均通过；前端 job 仍因要求当前 README 保留 Stage 10 的根测试而失败。独立 CLI 通过不能覆盖或抹去完整 architecture 测试的失败。

**最终 Rust job 全部通过**：全量 `cargo test` 为 **206 + 5 + 1 + 6 = 218 项通过，0 失败、0 忽略**；`cargo clippy -- -D warnings`、`cargo check`、rustfmt、所有定向阶段契约和旧/新真实 HTTP 比较均通过。Windows socket 修正已获得本轮实跑确认。[最终逐 job / step 证据](audit/windows-validation-final.json) 与 [完整 Node 失败清单](audit/windows-node-results.json) 已归档。

上述审计时的结果未消除 A01/A07/A09，也未证明 A03 的 Windows WebView 风险已排除；A01 后续专项修复状态见文首与 R12-14 详情。**原审计裁定：全仓审计完成；产品验收未通过；当时 R12-14 不标记完成。后续 A01 已修复，R12-14 专项验收见文首。**
