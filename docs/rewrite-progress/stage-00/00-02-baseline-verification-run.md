# 阶段 0 / 节点 00-02：GitHub Actions 基线验证结果

## 节点状态

- 结果：**失败**
- 阶段门禁：`failed`
- 后续阶段：**禁止进入阶段 1**
- 工作流：`Stage 0 Baseline Verification`
- Actions run：`30897953515`，attempt `1`
- 证据工件：`stage-00-baseline-30897953515-1`
- 工作分支：`rewrite/modular-rebuild`
- 验证提交：`0552994abf5452de72a708e86eb12a4714923728`
- 原始业务源码基线：`main@8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62`
- 运行环境：Linux / X64；v22.23.1；rustc 1.97.1 (8bab26f4f 2026-07-14)；Google Chrome 150.0.7871.128。

## 实际执行结果

### 硬性检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
| `rust-toolchain` | missing | - | - |
| `tauri-system-deps` | missing | - | - |
| `npm-ci` | missing | - | - |
| `npm-test` | missing | - | - |
| `browser-contract` | missing | - | - |
| `frontend-build` | missing | - | - |
| `browser-app` | missing | - | - |
| `cargo-test` | missing | - | - |
| `cargo-check` | missing | - | - |

### 扩展检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
| `tauri-build` | missing | - | - |

## 未通过检查

- `rust-toolchain`：退出码 -。
- `tauri-system-deps`：退出码 -。
- `npm-ci`：退出码 -。
- `npm-test`：退出码 -。
- `browser-contract`：退出码 -。
- `frontend-build`：退出码 -。
- `browser-app`：退出码 -。
- `cargo-test`：退出码 -。
- `cargo-check`：退出码 -。
- `tauri-build`：退出码 -。


<details>
<summary>浏览器日志末尾</summary>

```text

```
</details>

<details>
<summary>Rust / Tauri 日志末尾</summary>

```text


```
</details>

## 阶段结论

阶段 0 硬性门禁尚未通过，阶段 1 不得开始。

## 冻结模型哈希

| 文件 | 行数 | SHA-256 | 冻结范围 |
|---|---:|---|---|
| `src/document/document-model.js` | 370 | `d74ef9f70d389f3cc6afaca8acc3e7b0ae0cee9790c527f92868a69c60dd83b9` | algorithm and public behavior frozen |
| `src/preview/incremental-preview.js` | 353 | `40ba7731e01d336277a20b2c9937854665e1d5bff1894529f38c353fee7ccad9` | algorithm and public behavior frozen |
| `src/editor/hybrid/table-model.js` | 102 | `c09d43ec577c294f67c18dd6aa6fae4ff119da78d4bf456b78875c0173319186` | algorithm and public behavior frozen |
| `src/editor/hybrid/math-ranges.js` | 204 | `8abe184871e44a2099e1f58f270ec0cc27a37eebfb06218982f33b0cef4f427c` | algorithm and public behavior frozen |
| `src/editor/hybrid/ranges.js` | 127 | `365b54cf15e35a71c98af5c9fa475839a1f111048bab6df5a0373b8b4bf79301` | algorithm and public behavior frozen |
| `src/sync/selection-mapping.js` | 743 | `f74121ec0086885c81e7fa3b9a85adf3d3553dfde75e043a2c826a711343ebb2` | algorithm and public behavior frozen |
| `src/preview/math-source.js` | 100 | `3d86e20d41c0c85a426d2ee83848f68527ef4f7042d9479573eeb31ffe6ba6ee` | algorithm and public behavior frozen |
| `src/editor/hybrid/block-registry.js` | 335 | `c7e7c8067dd1c0717ff0901383cd2a0e4126168405dcf9968d3700e587a5c0fe` | algorithm and public behavior frozen |
| `src-tauri/src/document_store.rs` | 1159 | `1711566aff18c164388d8466f81435adcd6fc54c444ccd4ab5ea9799e6a80715` | data format and behavior contract; file may be decomposed later |

## 契约与源码采集

- 跟踪文件：131 个。
- 冻结模型：9 个。
- Tauri command 注解：19 个。
- `generate_handler!` 注册项：19 个。
- storage key：31 个。
- 被跟踪的运行或生成产物：4 个。

- `.vite/deps/_metadata.json`
- `.vite/deps/package.json`
- `logs/performance-2026-07-25_17-18-03-768_pid-3260.jsonl`
- `logs/performance-2026-07-25_17-29-13-389_pid-20484.jsonl`

## 大型生产文件信号

- `src-tauri/gen/schemas/desktop-schema.json`：5934 行，396614 bytes。
- `src-tauri/gen/schemas/windows-schema.json`：5934 行，396614 bytes。
- `src/styles/main.css`：4960 行，119418 bytes。
- `package-lock.json`：2674 行，94961 bytes。
- `public/app/core.js`：2418 行，101501 bytes。
- `public/i18n.js`：1906 行，104672 bytes。
- `src/editor/hybrid/widgets.js`：1788 行，66491 bytes。
- `public/app/scroll-sync.js`：1369 行，60811 bytes。
- `public/app/preview.js`：1271 行，55146 bytes。
- `src-tauri/src/document_store.rs`：1159 行，39644 bytes。
- `public/app/editor-tools.js`：1103 行，40955 bytes。
- `src/editor/hybrid/inline-presentation.js`：962 行，37938 bytes。

行数仅作为风险信号；后续拆分仍以职责、状态所有权和依赖方向为准。
