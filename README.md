# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；权威导航见 [docs/README.md](docs/README.md)。

Atomic 7.6 Worker Session 已完成：final tree 全链 `31686363540` PASS；同步版本、事务确认、Worker 重启与 stale response 丢弃统一由 Session 管理，Worker 失败保留稳定预览且不回退主线程全文渲染。Frozen/持久化/Rust/依赖未改，7.7 未开始。