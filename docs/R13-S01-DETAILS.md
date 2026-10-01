# R13-S01 Web Fetch Hardening

状态：**实现待 Windows CI，未验收**。唯一分支 `agent/r13-stage`，前置 R13.8 已在 `54fe195` / CI 36864276840 七组通过；收尾文档 `fe90949` / CI 36867415058 也已通过。13.9 Web Fetch Coordinator 必须等待本项后端验收，本轮未接入协调器。

## 用户确认与当前策略

2026-10-01 用户回复“先按你的建议来吧”，确认此前可审阅提案。策略保存在 `src-tauri/tests/fixtures/stage_13_web_fetch/policy.json`；历史 R12 manifest 与已归档验收事实不改写。

| 边界 | 当前规则 |
|---|---|
| 原始响应体 | 10 MiB，按 reqwest 去除 HTTP 传输分帧后、内容解压前的实际正文计量；等于允许，超过中止。Content-Length 仅用于提前拒绝，不代替逐块计量 |
| 解压正文 | 20 MiB，gzip/br/deflate 分段解压后、UTF-8 转换前计量；解码循环主动让出执行以响应取消/总截止 |
| 类型 | 只接受一个 HTML/XHTML Content-Type（忽略大小写与参数）；缺失、重复、不支持类型拒绝并提示手动 HTML。拒绝明显伪装的二进制；不能把 MIME/特征检查当作 HTML 可信证明 |
| URL | HTTP(S)，无协议域名默认 HTTPS，支持协议相对地址；修正大写 HTTP(S) 旧误解读，拒绝凭据、控制字符、反斜杠及其他显式协议 |
| 网络地址 | IPv4 公网与 IPv6 全球单播，排除私网、环回、链路本地、共享地址、文档/保留/多播及特殊转换段；域名所有解析结果都须合规 |
| 每次连接 | 每跳独立解析，把获准 IP 固定到 reqwest resolver；保留原 URL/Host/TLS 证书校验，检查实际 peer；关闭系统代理，避免代理绕过地址绑定 |
| 跳转 | 手动跟随最多 10 次；检查每跳 URL、解析地址和最终连接，拒绝循环、非法 Location、其他协议与 HTTPS 降级 |
| 截止 | DNS、所有跳转、读正文、解压共享 30 秒总截止，不为每跳重新增加总预算 |
| 取消 | AbortSignal → 原生取消命令 → Abortable 丢弃请求 Future；请求登记清理使用 guard。最多 64 个有 ID 的登记/早到取消记录，早到取消 30 秒过期，ID 携带同机时间并拒绝过期启动，防止记录清理后迟到请求复活；不保存 URL/正文 |

1 MiB = 1024 × 1024 字节。网页内图片等子资源不由 fetch_url 额外下载，不把网页上限误用于本地图片功能。

## 实际实现与兼容性变化

复用 `web_fetch/validation.rs`、`client.rs`、`response.rs`、`command.rs`；新增 `requests.rs` 专门持有应用级取消登记，不另建抓取器。生产抓取入口固定使用公网解析器和普通证书信任；受控测试解析器/测试 CA 仅由测试调用注入。自动解压关闭，实际原始正文限量读取后再有界解码，避免 reqwest 自动解压隐藏原始字节数。

保留 `fetch_url` 命令名、原 `{url}` 调用和六个 FetchResponse 字段；可选 `requestId` 与新增配套 `cancel_fetch_url` 支持真正停止请求。前 19 个命令保持名称/顺序，新取消命令追加为第 20 个。main 持有唯一请求状态，Platform web-fetch-client 为携带 signal 的调用生成 ID、清理 listener、区分取消与失败；不带 signal 的旧调用仍可用。

有意变化包括：不再抓取内网页面、不再接受任意/缺失 MIME、不再无限读取、不再自动依赖系统代理；大写 HTTP(S) 按原含义规范化，拒绝凭据与危险协议误解读、HTTPS 降级和混合私网 DNS 结果。命中规则时原剪藏界面展示错误并提供手动 HTML；自动抓取能力较旧实现收紧。这些是已确认的安全变化，不恢复旧策略作为 fallback。

HTML 仍视为不可信。现有渲染净化/CSP 不变，正文提取/转换与 UI 到 Preview/Hybrid 的完整安全回归属于 13.10～13.13，不宣称本项已经完成 A05 全链路或关闭全部移交项。

## Windows 验证与明确边界

沿用七组 Windows CI，不新建流水线。真实自有 HTTP 服务覆盖正常 Unicode/字段/请求头、原始大小等于/超过边界、无长度/分块、矛盾长度、三种压缩等于/超过解压边界、异常压缩、MIME 缺失/错误/重复/二进制伪装、状态/空正文/截断、相对及跨目标跳转、10/11 次与循环、30 秒停滞、取消请求头/正文时服务端观察连接关闭。真实自有 TLS 服务覆盖正常 HTML、拒绝 HTTPS 降级；原有不信任 CA 拒绝/TLS 1.3 回归保留。

受控网络测试用 `.test` 域名解析边界绑定自身 loopback 服务，不开放生产 loopback 例外；另用真实生产入口证明本地地址在建立连接前被拒绝。DNS 变化/混合结果使用注入解析器和地址校验器，不能称为真实公网 DNS 变化证明。IPv6 地址分类有策略测试，未声称 CI 拥有真实公网 IPv6 网络。系统 DNS 的底层阻塞解析由操作系统管理，取消/超时阻止后续连接，但不保证即时终止已经开始的系统 DNS 调用；请求正文和解压均在受控 Future 内，不创建后台下载任务。

原生取消能力及端口回归属于本项；旧剪藏对话框的关闭/换 URL 等 UI 接线仍按 13.9/13.12 接入，不能把端口单测称为 UI 全链路已经验收。原生取消错误会显式传播，资源至迟受总截止约束。

本地仅 JS/MJS 语法、Rust rustfmt 语法/格式、JSON/TOML/锁文件与差异静态检查，没有运行 Linux 产品测试、cargo check/build 或浏览器测试。全部行为与编译结论等待本轮精确提交 Windows CI，成功前不勾选 R13-S01/13.9。

## 依赖与审计承接

没有升级第三方版本。把已有锁定的 async-compression 0.4.36、futures-util 0.3.32、tokio 1.52.3 声明为直接依赖，供有界解码、取消 Future 和总截止使用；Cargo.lock 仅增加应用直接依赖边。压缩算法沿用既有 gzip/br/zlib 能力，未启用新的算法、原生 TLS、证书绕过或外部命令。A10 仍运行官方 RustSec、Windows 依赖图及 TLS 门禁，本轮结果待 CI。

Context7 已核对 reqwest DNS override/重定向设计，并以锁定 0.12.28 官方源码核对接口；async-compression 未在 Context7 命中，改读 0.4.36 官方 crate 源码，futures 取消按 0.3.32 官方源码核对。Mermaid Chart 已核对抓取/取消所有权链。本项可回退到前置 `fe90949`，无持久化格式迁移。


## 首轮失败与修正（2026-10-01）

`4a60a0d3315456b2dd3b63e375fe09d32aa1275e` / [CI 36873801315](https://github.com/uniquenesssta/mdr/actions/runs/36873801315) 为 4 个 job 成功、Rust/前端及依赖它们的收尾 job 失败。全仓 Node、官方 RustSec/Windows 依赖图、原生编译链接、实际 Windows WebView 已通过。

Rust 的多处失败均由同一测试编译错误阻断：新 HTTPS 用例的 `include_bytes!` 指向 src-tauri/tests/fixtures 下不存在的证书，实际夹具位于仓库 tests/fixtures。现按 CARGO_MANIFEST_DIR 拼接仓库路径，补存在性契约；不能将此前未运行的 Rust 用例写为行为通过。旧 Windows portability 脚本仍把 HTTP 文件冻结在 R12 未加固版本，现明确采用用户已批准 S01 的提交作为该文件基线，只允许本次证书路径修正，其余两处旧冻结保持。同步 HTTP 17 项、URL 10 项固定成功计数，保留零失败硬门禁并补源用例数量匹配回归。

前端唯一失败为 Browser preview contract 的 Chromium CDP 启动超时，尚未进入页面断言；Built-app browser regression 已通过。旧日志没有 Chromium stderr/退出原因，不能断言它是抓取逻辑错误或已经定位。现记录 executable/args/PID/退出码/连接 cause/有界 stdout、stderr，提前报告 spawn/进程退出；单次探测受剩余总预算约束，仍保留 30 秒总截止，不增加浏览器重试或吞掉断言。清理失败也保留原始启动诊断。新增受控探测无响应、进程退出、连接错误和正常 JSON 回归，真实浏览器仍由原 Windows 门禁验证。

本地仅静态语法、Rust 格式、路径/数量与 diff 检查；本次生产抓取策略和实现不变，13.9 仍等待 R13-S01 验收。重验启动后停止查询。
