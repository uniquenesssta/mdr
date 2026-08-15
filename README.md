# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.4：Source Edit Controller 接管 SOURCE 范围/选区/滚动 margin/状态转换/关闭，编辑器操作仅经 port；8.5 未开始。E2E CDP 冷启动等待 12s→30s，不跳过浏览器门禁。验证：8.4 11/11，Stage 8 43/43，Node 78/78，Architecture/Browser/Build/Built-app PASS，audit 0。接口、持久化、Rust、生产依赖不变。
