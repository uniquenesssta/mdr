# Markdown Editor

Stage 12 使用 `agent/r12-stage`；历史见 [docs/README.md](docs/README.md)。

## Change Log

- 2026-09-17：R12-08 与 07、09、10 已验收；[记录](docs/R12-08-DETAILS.md)。
- 2026-09-18：R12-11 已验收。R12-12 抽离 reqwest Client、headers、10 次重定向/30 秒超时，保留 rustls/gzip/brotli/deflate；真实 gzip 回归已加入。CI 仅修正模块计数、rustfmt及对应精确源码契约，完整复验待通过；[详情](docs/R12-12-DETAILS.md)。
