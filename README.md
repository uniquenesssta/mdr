# Markdown Editor

Stage 12 使用 `agent/r12-stage`，Stage 10/11 契约不变；[docs/README.md](docs/README.md)。

## Change Log

- 2026-09-17：R12-08 与 07、09、10 验收通过；[记录](docs/R12-08-DETAILS.md)。
- 2026-09-18：R12-11 `fecd05b` 的 Actions `35137179217` 四项任务全部通过，等价校验拆分完成。R12-12 抽离 reqwest Client、浏览器请求头、10 次重定向与 30 秒超时，Cargo 的 rustls/gzip/brotli/deflate 特性不变；新增真实 gzip 前后回归，完整 Actions 待验收；[详情](docs/R12-12-DETAILS.md)。
