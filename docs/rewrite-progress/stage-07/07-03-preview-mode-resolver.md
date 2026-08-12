# Atomic 7.3 — Preview Mode Resolver

## 状态

实现完成；clean candidate 全链已通过。首次最终不可变树验证仅因根 README 超出既有 120–360 字符门禁失败，生产、架构、Frozen 与 Stage 4–7.3 focused 路径均未失败；根 README 已按既有门禁压缩，等待修正版最终树全链验证与正式发布。

## 实现

- 新增 `src/features/preview/pipeline/preview-mode-resolver.js`，唯一负责从 Preview 设置、字符数、块数解析 `full / virtual / chapter`。
- 手动 `full / virtual / chapter` 覆盖优先于自动阈值；非法或缺失设置按 `auto` 处理。
- 自动边界继续使用 Atomic 7.1 冻结阈值：400000 字符或 1400 块进入 `virtual`；1000000 字符或 12000 块进入 `chapter`。100000 字符仅影响 Worker 执行策略，不改变展示模式。
- 新增 scoped `classic-preview-mode-resolver-port.js`，classic 调用方不再拥有模式解析实现。
- `public/app/core.js` 移除旧 normalization/resolver 权威；`public/app/preview.js` 的模式选择调用全部切换到 resolver port。
- `src/main.js` 在 composition root 挂载并销毁 resolver port。
- Atomic 7.1 thresholds 与 Atomic 7.2 PreviewState 职责保持不变；未进入 7.4 Scheduler/Cancellation。

## 影响与兼容性

用户可观察的模式选择语义不变；设置持久化结构、DocumentModel、Rust、依赖均未修改。`hybrid` 仍由布局运行时处理，不属于 7.3 resolver 输出。

## 验证

- RED：run `31627262926` 在 7.2 基线上因 resolver export 不存在按预期失败。
- Focused：run `31627836777` PASS，覆盖 resolver 边界、manual override、compatibility port、7.1/7.2 历史架构、模块解析与 Frozen 精确哈希。
- Clean candidate：run `31628935314` SUCCESS；精确 checkout `c8e993dd26feccac48f467fa527144fcd8fe9544`，目标树无 `atomic-73-*` 临时 workflow。
- Clean candidate 全链 PASS：依赖审计、KaTeX serving、Stage 4、Stage 5、Stage 6 与真实 Chromium、Stage 7.1–7.3、Frozen exact、Architecture、Node、Browser Contract、Build、Built App、evidence。
- 首次最终树：run `31629261071` 在 `npm test` 停止；`tests/documentation-layout.test.mjs` 要求根 README 为 120–360 字符，而该树 README 为 374 字符。此前 exact checkout、Stage 4/5/6、真实 Chromium、Stage 7.1–7.3、Frozen 与 Architecture 均 PASS；未将该 run 描述为通过。
- 修复：仅压缩根 README 至 262 字符；未修改测试、质量门禁或生产代码。

## 已知限制 / 后续

Atomic 7.4 Scheduler/Cancellation 尚未开始；本 Atomic 不拥有调度、取消、Worker Session、DOM Renderer 或 Focus Controller。
