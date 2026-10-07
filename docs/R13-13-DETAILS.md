# R13.13 导入到文档链

状态：**前置依赖补丁已实现，待 Windows CI；业务链路尚未实施，未验收**。

用户于 2026-10-08 授权“开始13.13”。沿用唯一阶段分支 `agent/r13-stage`，本轮基线 `59b0ba25b56134a804fc1caa6da078e147230bf8`，初始工作区干净。R13.12 的功能验收基于 `fabf0873269a220b88c58684d8196e996eb7926b` / [Windows CI 36971353716](https://github.com/uniquenesssta/mdr/actions/runs/36971353716) 七组通过；后续文档收尾 CI 的当前依赖门禁失败，先恢复前置验证再迁移业务链路。

## 前置失败与定向修补

`59b0ba2` / [CI 37606184822](https://github.com/uniquenesssta/mdr/actions/runs/37606184822) 的唯一直接失败是 `npm audit --audit-level=high`。全部 Node、架构、浏览器、生产构建、Rust、原生及真实 WebView 检查成功；最终证据汇总因前端 job 失败而拒绝准入。失败来自新增公告，不能当作可以忽略的旧断言或文档变化。

| 依赖 | 锁定版本变化 | 官方依据与范围 |
| --- | --- | --- |
| source-map-js | 1.2.1 → 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)、[官方发布](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)：修补 indexed source map offset 引发的事件循环拒绝服务。仍为 PostCSS 的开发传递依赖；Node 最低版本声明未变，BSD-3-Clause 许可证未变。 |
| DOMPurify | 3.4.13 → 3.4.16 | [官方发布](https://github.com/cure53/DOMPurify/releases/tag/3.4.16)：修补 IN_PLACE 的 hooks 移除节点与 raw-text 根节点问题。现行应用使用 string 输入和 RETURN_DOM_FRAGMENT，不使用 IN_PLACE；公共净化策略、标签/属性及 URL 判定保持。许可证仍为 MPL-2.0 或 Apache-2.0。 |

仅更新现有依赖和对应锁文件条目；未新增依赖、未升级跨主版本、未修改模型、存储格式、抓取策略或产品源码。当前门禁仍为 `--audit-level=high`，未增加忽略项、跳过或放宽条件。

公告和对应发布已从官方来源核对。Context7 核对 RETURN_DOM_FRAGMENT 与 allow-list 公共接口；其 main 文档不是精确补丁兼容证明，因此 3.4.16 的实际兼容性仍交给当前 Windows 浏览器、真实 WebView 和完整回归验证。

## 已完成与待完成验证

- 本地 `npm audit --package-lock-only --audit-level=high --json` 返回 0；报告 high=0、critical=0、moderate=0、low=2。仅为当前锁文件公告扫描，不能代替真实安装或 Windows 产品回归。
- 锁文件差异仅涉及 DOMPurify、source-map-js 及根依赖版本；下载完整性与 npm 发布元数据一致。
- `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record`、文档链接和 `git diff --check` 静态自检通过。首次架构自检因依赖未安装失败，使用既有 `deps:prepare` 在仓库上一级安装锁定依赖后重验通过，未修改检查规则。不执行 Linux/macOS 产品测试或构建。
- Windows 沿用既有七组累计 CI，包括真实安装审计、完整 Node、浏览器、生产构建、真实 WebView、Rust/Clippy/check、原生编译链接与同提交证据汇总；本轮等待结果，未声称通过。

剩余 low 项为 [KaTeX GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) 及其 Mermaid 传递影响；当前 KaTeX 0.16.47，官方修补版本 0.18.2，超出现行 ^0.16.25 范围。它要求已存在的原型污染，不能仅凭当前代码设置 trust 就声明风险已关闭。本轮不自动跨兼容范围升级或豁免；R13.13 全链路安全与 A10 复核时须继续评估污染来源、渲染选项/HTML 边界及升级兼容性，未处置前不得宣称该公告已修复。

## 续接范围

前置 Windows 回归通过后，继续已授权的 R13.13，不要求用户再次授权启动：

1. 迁移浏览器文件、原生路径、picker/recent/startup 与拖放调用者到公开 Import → Documents/Editor 链，删除 classic-file-import-port、classic-drop-import-port 和 handleNativeDroppedPath 薄入口。保留先保存当前文档、读取失败不建档、代次拒绝旧结果和成功后登记最近文件。
2. 图片与网页内容保持现有插入位置和单次替换语义；取消、失败、重复事件和销毁不创建空文档或重复插入。
3. 在真实 Windows WebView 验证受控网页抓取→提取/转换→文档→Preview/Hybrid，覆盖净化、CSP、IPC、合法内容、错误与取消路径。函数单测或原生编译不能代替该证据。
4. R13.14 仍负责未在本项迁移中自然移除的历史模块及旧代码清理；A03/A05 全链路和 R13 阶段收官保持未勾选。

本次补丁可整体回退本轮提交，无数据迁移；回退会恢复已知依赖公告，不能据此发布或继续宣称安全门禁通过。推送启动 CI 后按用户要求结束会话，不轮询。
