# Markdown Editor

Stage 12 正在独立分支推进。R12-01 已由用户核验专属 Actions 绿色；R12-02 已将输入路径、父目录、相对图片、目录越界和符号链接判定迁入唯一 Path Policy，所有本地文件读写入口复用该策略，命令、DTO、错误文本、绝对路径和 `../` 相对图片行为不变，Stage 10/11 契约与依赖不变。本地定向契约、全量 Node、构建和架构门禁通过，完整 Rust/Clippy/浏览器验收待 R12-02 Actions。详情见 [docs/README.md](docs/README.md)。
