# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.5：Widget Lifecycle 拆为生命周期与 geometry scheduler，统一 attach/destroy、ResizeObserver、几何刷新和清理；旧 lifecycle 权威实现已删除，销毁幂等；8.6 未开始。验证：8.5 10/10，Stage 8 53/53，Node 83/83，Architecture/Browser/Build/Built-app PASS，audit 0。接口、持久化、Rust、生产依赖不变。
