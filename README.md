# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)，5.8 详见 [验收记录](docs/rewrite-progress/stage-05/05-08-editor-controller.md)。

2026-08-10：CR-01 PASS。Stage 1 lifecycle 已按任务书收敛至 `src/app/lifecycle/` 与六态契约；生产模块 260→262；clean validation runner `31351876875` 全链路通过。Stage 5 / 5.8 基线保持完成，5.9 未开始。

2026-08-10：CR-02 PASS。Stage 2 UI 验收已区分 184 历史冻结基线与当前兼容债务；当前内联事件上限 158、兼容图标引用 47，经典 `/i18n.js` 与 compatibility settings modal 禁止回归；Stage 2 run `31357149906` 全链通过。
