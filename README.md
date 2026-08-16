# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.15 / Stage 8：Hybrid Decoration 与 Editor Controller 已独立落位，CodeMirror 集成收敛到 hybrid-markdown，公共 Hybrid 入口保持浏览器直接加载安全；旧三大聚合文件已删。验证：8.15 14/14，Stage 8 179/179，Node 149/149，Architecture/Browser/Build/Scope PASS，Built-app 29/29×3，audit 0；Rust、冻结模型、Preview、依赖不变。
