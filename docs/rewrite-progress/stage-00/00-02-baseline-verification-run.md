# 阶段 0 / 节点 00-02：GitHub Actions 基线验证结果

## 节点状态

- 结果：**失败，阶段 0 硬性门禁未通过**
- 后续阶段：**禁止进入阶段 1**
- 工作流：`Stage 0 Baseline Verification`
- Actions run：`30883814364`，attempt `1`
- 证据工件：`stage-00-baseline-30883814364-1`
- 工作分支：`rewrite/modular-rebuild`
- 验证提交：`28c70e51b4119b1161e35668994e5f504ff4a630`
- 原始业务源码基线：`main@8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62`
- 运行环境：GitHub-hosted `ubuntu-22.04`、Node 22、Rust 1.77.2、Chrome headless

## 实际执行结果

### 硬性检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
| `rust-toolchain` | passed | 0 | 7014 |
| `tauri-system-deps` | passed | 0 | 29715 |
| `npm-ci` | passed | 0 | 6275 |
| `npm-test` | passed | 0 | 393 |
| `browser-contract` | passed | 0 | 7993 |
| `frontend-build` | passed | 0 | 11547 |
| `browser-app` | failed | 1 | 115463 |
| `cargo-test` | failed | 101 | 2569 |
| `cargo-check` | failed | 101 | 172 |

### 扩展检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
| `tauri-build` | failed | 1 | 11842 |

## 已通过路径

- 仓库 checkout 与完整 Git 历史读取成功。
- Rust 1.77.2 toolchain 安装成功。
- Tauri Linux 系统依赖安装成功。
- Chrome/Chromium 解析成功。
- 静态基线、源码清单和契约采集成功。
- `npm ci` 成功。
- Node 测试套件成功。
- 浏览器交互契约成功。
- Vite 生产构建成功。

## 硬性失败 1：应用级浏览器回归

`npm run test:browser` 共执行 7 项，2 项通过、5 项失败：

- application code block placeholder never receives a phantom source highlight (353ms)
- application code block ignores single click and opens on strict double click (19176ms)
- application keeps only one direct editor active (19154ms)
- application Mermaid presentation stays normalized across hybrid and preview layouts (28097ms)
- application source edit exits when pointer moves outside the source range (19100ms)

这些失败发生在当前未修改的业务实现上。阶段 0 不修改实现，因此本节点仅冻结现象并阻止进入后续重写阶段。

<details>
<summary>浏览器失败日志摘录</summary>

```text
[stdout] 
> markdown-editor@1.0.0 test:browser
> node tests/e2e/run-browser-tests.mjs --app

[stdout] Browser artifacts: /home/runner/work/mdr/mdr/artifacts/stage-00/browser
[stdout] ok - application switches deterministically across every layout mode (8564ms)
[stderr] not ok - application code block placeholder never receives a phantom source highlight (353ms)
[stderr] AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

0 !== 1

    at file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:336:14
    at async test (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:27:5)
    at async runAppSuite (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:325:5)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:414:13
[stderr]   screenshot: /home/runner/work/mdr/mdr/artifacts/stage-00/browser/02-application-code-block-placeholder-never-receives-a-phantom-source-highlight.png
[stderr] not ok - application code block ignores single click and opens on strict double click (19176ms)
[stderr] Error: Timed out waiting for code editor open
    at CdpPage.waitFor (file:///home/runner/work/mdr/mdr/tests/e2e/lib/cdp-browser.mjs:200:11)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:344:7
    at async test (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:27:5)
    at async runAppSuite (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:339:5)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:414:13
[stderr]   screenshot: /home/runner/work/mdr/mdr/artifacts/stage-00/browser/03-application-code-block-ignores-single-click-and-opens-on-strict-double-click.png
[stderr] not ok - application keeps only one direct editor active (19154ms)
[stderr] Error: Timed out waiting for condition
    at CdpPage.waitFor (file:///home/runner/work/mdr/mdr/tests/e2e/lib/cdp-browser.mjs:200:11)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:353:7
    at async test (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:27:5)
    at async runAppSuite (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:350:5)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:414:13
[stderr]   screenshot: /home/runner/work/mdr/mdr/artifacts/stage-00/browser/04-application-keeps-only-one-direct-editor-active.png
[stderr] not ok - application Mermaid presentation stays normalized across hybrid and preview layouts (28097ms)
[stderr] Error: Timed out waiting for hybrid Mermaid SVG
    at CdpPage.waitFor (file:///home/runner/work/mdr/mdr/tests/e2e/lib/cdp-browser.mjs:200:11)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:367:7
    at async test (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:27:5)
    at async runAppSuite (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:364:5)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:414:13
[stderr]   screenshot: /home/runner/work/mdr/mdr/artifacts/stage-00/browser/05-application-mermaid-presentation-stays-normalized-across-hybrid-and-preview-layouts.png
[stderr] not ok - application source edit exits when pointer moves outside the source range (19100ms)
[stderr] Error: Timed out waiting for source range open
    at CdpPage.waitFor (file:///home/runner/work/mdr/mdr/tests/e2e/lib/cdp-browser.mjs:200:11)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:380:7
    at async test (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:27:5)
    at async runAppSuite (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:376:5)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:414:13
[stderr]   screenshot: /home/runner/work/mdr/mdr/artifacts/stage-00/browser/06-application-source-edit-exits-when-pointer-moves-outside-the-source-range.png
[stdout] ok - application pointer drag maps to exact editor characters (18771ms)
[stdout] 
Browser tests: 7, passed: 2, failed: 5
```

</details>

## 硬性失败 2：Rust 声明版本与锁定依赖不兼容

`src-tauri/Cargo.toml` 声明：

- edition：2021
- rust-version：1.77.2

但 `Cargo.lock` 解析到的 `dlopen2_derive v0.4.2` 需要 Cargo 的 Edition 2024 支持。Cargo 1.77.2 无法解析该依赖清单，导致：

- `cargo +1.77.2 test --locked`：退出码 101；
- `cargo +1.77.2 check --locked`：退出码 101；
- Tauri Linux build：在 Rust 编译阶段失败。

这不是 runner 缺少 WebKitGTK 或编译工具造成的失败；相关系统依赖已经安装成功。当前仓库的声明 MSRV、锁文件和实际依赖链不一致。

<details>
<summary>Rust 失败日志摘录</summary>

```text
[stderr]   Downloaded byteorder v1.5.0
[stderr]   Downloaded bitflags v2.13.0
[stderr]   Downloaded bitflags v1.3.2
[stderr]   Downloaded bit-vec v0.8.0
[stderr]   Downloaded alloc-stdlib v0.2.4
[stderr]   Downloaded alloc-no-stdlib v2.0.4
[stderr]   Downloaded schemars v0.8.22
[stderr]   Downloaded ryu v1.0.23
[stderr]   Downloaded rustls-pki-types v1.15.0
[stderr]   Downloaded dpi v0.1.2
[stderr]   Downloaded deranged v0.4.0
[stderr]   Downloaded crypto-common v0.1.7
[stderr]   Downloaded cfg-if v1.0.4
[stderr]   Downloaded selectors v0.36.1
[stderr]   Downloaded digest v0.10.7
[stderr]   Downloaded compression-core v0.4.32
[stderr]   Downloaded block-buffer v0.10.4
[stderr]   Downloaded rustc-hash v2.1.3
[stderr]   Downloaded dirs v6.0.0
[stderr]   Downloaded cpufeatures v0.2.17
[stderr]   Downloaded gobject-sys v0.18.0
[stderr]   Downloaded cargo-platform v0.1.8
[stderr]   Downloaded dlopen2_derive v0.4.2
[stderr] error: failed to download replaced source registry `crates-io`

Caused by:
  failed to parse manifest at `/home/runner/.cargo/registry/src/index.crates.io-6f17d22bba15001f/dlopen2_derive-0.4.2/Cargo.toml`

Caused by:
  feature `edition2024` is required

  The package requires the Cargo feature called `edition2024`, but that feature is not stabilized in this version of Cargo (1.77.2 (e52e36006 2024-03-26)).
  Consider trying a newer version of Cargo (this may require the nightly release).
  See https://doc.rust-lang.org/nightly/cargo/reference/unstable.html#edition-2024 for more information about the status of this feature.
```

</details>

<details>
<summary>Tauri build 失败日志摘录</summary>

```text
dist/assets/sequenceDiagram-DBY2YBRQ-CkwpMkeG.js        117.00 kB │ gzip:  31.16 kB
[stdout] dist/assets/swimlanes-5IMT3BWC-r6p67yPZ.js              118.90 kB │ gzip:  43.67 kB
dist/assets/architectureDiagram-ZJ3FMSHR-8zgIzPCF.js    151.40 kB │ gzip:  43.02 kB
dist/assets/cytoscape.esm-D3_iZ_3b.js                   442.92 kB │ gzip: 141.93 kB
[stdout] dist/assets/mermaid.core-JMHOLC4Y.js                    581.90 kB │ gzip: 136.90 kB
dist/assets/cynefin-VYW2F7L2-jq6gSZGO.js                688.17 kB │ gzip: 154.20 kB
dist/assets/index-DIGGSYZe.js                         1,047.60 kB │ gzip: 337.04 kB
[stderr] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
[stdout] ✓ built in 10.57s
[stderr]      Running [tauri_cli] Command `cargo build --bins --features tauri/custom-protocol --release`
[stderr]  Downloading crates ...
[stderr] error: failed to download `dlopen2_derive v0.4.2`

Caused by:
  unable to get packages from source

Caused by:
  failed to download replaced source registry `crates-io`

Caused by:
  failed to parse manifest at `/home/runner/.cargo/registry/src/index.crates.io-6f17d22bba15001f/dlopen2_derive-0.4.2/Cargo.toml`

Caused by:
[stderr]   feature `edition2024` is required

  The package requires the Cargo feature called `edition2024`, but that feature is not stabilized in this version of Cargo (1.77.2 (e52e36006 2024-03-26)).
  Consider trying a newer version of Cargo (this may require the nightly release).
  See https://doc.rust-lang.org/nightly/cargo/reference/unstable.html#edition-2024 for more information about the status of this feature.
[stderr] failed to build app: failed to build app[stderr] 
[stderr]        Error [tauri_cli_node] failed to build app: failed to build app
```

</details>

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

## 契约采集结果

- 跟踪文件：122 个。
- 冻结模型：9 个。
- Tauri command 注解：19 个。
- `generate_handler!` 注册项：19 个。
- storage key：31 个。
- 当前注解命令：`abort_document_snapshot_upload`、`append_document_snapshot_chunk`、`begin_document_snapshot_upload`、`commit_document_snapshot_upload`、`delete_document_state`、`fetch_url`、`initial_file_path`、`list_text_file_tree`、`load_document_manifest`、`load_document_state`、`open_external_url`、`read_document_chunk`、`read_dropped_file`、`read_local_image`、`save_document_state`、`search_document_state`、`write_local_binary_file`、`write_local_text_file`、`write_performance_logs`。

注：首轮采集器的单条 `registered` 布尔值只按裸函数名匹配，而注册项包含模块前缀；应以本记录中的“注解数量 19 / handler 注册数量 19”和原始列表为准，不将该布尔字段作为契约缺失结论。

## 当前被跟踪的运行或生成产物

- `.vite/deps/_metadata.json`
- `.vite/deps/package.json`
- `logs/performance-2026-07-25_17-18-03-768_pid-3260.jsonl`
- `logs/performance-2026-07-25_17-29-13-389_pid-20484.jsonl`

上述文件在阶段 0 仅记录，不擅自删除；清理必须按任务书进入对应 Atomic Task 并验证。

## 当前大型生产文件信号

- `src-tauri/gen/schemas/desktop-schema.json`：5934 行，396614 bytes。
- `src-tauri/gen/schemas/windows-schema.json`：5934 行，396614 bytes。
- `src/styles/main.css`：4960 行，119418 bytes。
- `package-lock.json`：2674 行，94961 bytes。
- `public/app/core.js`：2418 行，101501 bytes。
- `public/i18n.js`：1906 行，104672 bytes。
- `src/editor/hybrid/widgets.js`：1785 行，66404 bytes。
- `public/app/scroll-sync.js`：1369 行，60811 bytes。
- `public/app/preview.js`：1271 行，55146 bytes。
- `src-tauri/src/document_store.rs`：1159 行，39644 bytes。
- `public/app/editor-tools.js`：1103 行，40955 bytes。
- `index.html`：944 行，68834 bytes。
- `public/app/export.js`：927 行，36448 bytes。
- `src/editor/hybrid/inline-presentation.js`：905 行，35970 bytes。
- `src/preview/virtual-preview.js`：760 行，29897 bytes。

行数只作为风险信号；后续拆分仍以职责、状态所有权和依赖边界为依据。

## 修改范围

本节点未修改业务源码、模型算法、公共接口、持久化格式或用户行为。新增内容仅包括：

- GitHub Actions 阶段 0 工作流；
- 基线与契约采集脚本；
- 命令执行记录器；
- 本阶段验证记录与证据文件。

## 尚未排除的风险

- 应用级浏览器失败是否同时存在于 Windows Chrome/Edge，需要后续在 Windows runner 或真实桌面环境复核。
- Rust 依赖链需要在独立决策中选择：提高并准确声明 MSRV，或回退/约束依赖以继续支持 Rust 1.77.2。阶段 0 不擅自选择。
- Tauri Linux 打包尚未通过，原因受 Rust 版本冲突阻断。
- 工作流只验证 Linux runner；Windows 原生窗口、文件关联和桌面拖放仍未验证。

## 阶段结论

阶段 0 已成功建立可复现验证环境并捕获当前真实基线，但退出条件尚未满足。必须先处理或明确接受以下基线阻塞：

1. 5 项应用级浏览器回归失败；
2. Rust 1.77.2 与锁定依赖 Edition 2024 不兼容；
3. Rust/Tauri 构建链因此无法通过。

在这些硬性问题解决并重新验证前，不进入阶段 1。
