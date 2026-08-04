# 阶段 0 / 节点 00-02：GitHub Actions 基线验证结果

## 节点状态

- 结果：**失败，阶段 0 硬性门禁未通过**
- 后续阶段：**禁止进入阶段 1**
- 工作流：`Stage 0 Baseline Verification`
- Actions run：`30895471055`，attempt `1`
- 证据工件：`stage-00-baseline-30895471055-1`
- 工作分支：`rewrite/modular-rebuild`
- 验证提交：`5c97dec408794d4a55045a94b77211bd71b61f3b`
- 原始业务源码基线：`main@8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62`
- 运行环境：GitHub-hosted `ubuntu-22.04`、Node 22、Rust 1.77.2、Chrome headless

## 实际执行结果

### 硬性检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
| `rust-toolchain` | passed | 0 | 8758 |
| `tauri-system-deps` | passed | 0 | 24726 |
| `npm-ci` | passed | 0 | 5933 |
| `npm-test` | passed | 0 | 490 |
| `browser-contract` | passed | 0 | 10882 |
| `frontend-build` | passed | 0 | 11166 |
| `browser-app` | failed | 1 | 14793 |
| `cargo-test` | passed | 0 | 112036 |
| `cargo-check` | passed | 0 | 65727 |

### 扩展检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
| `tauri-build` | passed | 0 | 225499 |

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

- application code block placeholder never receives a phantom source highlight (5727ms)

这些失败发生在当前未修改的业务实现上。阶段 0 不修改实现，因此本节点仅冻结现象并阻止进入后续重写阶段。

<details>
<summary>浏览器失败日志摘录</summary>

```text
[stdout] 
> markdown-editor@1.0.0 test:browser
> node tests/e2e/run-browser-tests.mjs --app

[stdout] Browser artifacts: /home/runner/work/mdr/mdr/artifacts/stage-00/browser
[stdout] ok - application switches deterministically across every layout mode (900ms)
[stderr] not ok - application code block placeholder never receives a phantom source highlight (5727ms)
[stderr] Error: Timed out waiting for trailing source active line
    at CdpPage.waitFor (file:///home/runner/work/mdr/mdr/tests/e2e/lib/cdp-browser.mjs:200:11)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:345:7
    at async test (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:27:5)
    at async runAppSuite (file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:325:5)
    at async file:///home/runner/work/mdr/mdr/tests/e2e/run-browser-tests.mjs:438:13
[stderr]   screenshot: /home/runner/work/mdr/mdr/artifacts/stage-00/browser/02-application-code-block-placeholder-never-receives-a-phantom-source-highlight.png
[stdout] ok - application code block ignores single click and opens on strict double click (867ms)
[stdout] ok - application keeps only one direct editor active (896ms)
[stdout] ok - application Mermaid presentation stays normalized across hybrid and preview layouts (1295ms)
[stdout] ok - application source edit exits when pointer moves outside the source range (997ms)
[stdout] ok - application pointer drag maps to exact editor characters (1586ms)
[stdout] 
Browser tests: 7, passed: 6, failed: 1
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
[stderr]    Compiling ryu v1.0.23
[stderr]    Compiling tower-http v0.6.11
[stderr]    Compiling serde_urlencoded v0.7.1
[stderr]    Compiling hyper-rustls v0.27.7
[stderr]    Compiling markdown-editor v1.0.0 (/home/runner/work/mdr/mdr/src-tauri)
[stderr]    Compiling reqwest v0.12.28
[stderr] warning: unused import: `std::io::Write`
    --> src/document_store.rs:1011:9
     |
1011 |     use std::io::Write as _;
     |         ^^^^^^^^^^^^^^
     |
     = note: `#[warn(unused_imports)]` on by default

[stderr] warning: `markdown-editor` (bin "markdown-editor" test) generated 1 warning
[stderr]     Finished `test` profile [unoptimized + debuginfo] target(s) in 1m 51s
[stderr]      Running unittests src/main.rs (src-tauri/target/debug/deps/markdown_editor-b81fe3d9e1fe4efd)
[stdout] 
running 12 tests
[stdout] test document_store::tests::alternates_snapshot_slots_without_overwriting_current_snapshot ... ok
test document_store::tests::applies_utf16_changes_for_chinese_and_emoji ... ok
[stdout] test document_store::tests::builds_sparse_index_and_ignores_fenced_headings ... ok
[stdout] test external_link::tests::accepts_supported_schemes ... ok
test external_link::tests::rejects_unsupported_schemes ... ok
[stdout] test local_file::tests::lists_supported_text_files_as_a_nested_tree ... ok
[stdout] test local_file::tests::recognizes_supported_text_extensions_case_insensitively ... ok
test local_file::tests::resolves_relative_image_against_document_directory ... ok
test local_file::tests::writes_text_and_binary_to_absolute_paths ... ok
[stdout] test document_store::tests::repairs_truncated_journal_after_last_valid_transaction ... ok
[stdout] test document_store::tests::falls_back_to_other_snapshot_slot_when_latest_is_corrupt ... ok
[stdout] test document_store::tests::saves_million_character_snapshot_from_chunks ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
```

</details>

<details>
<summary>Tauri build 失败日志摘录</summary>

```text
[stderr]    Compiling serialize-to-javascript-impl v0.1.2
[stderr]    Compiling tracing-core v0.1.36
[stderr]    Compiling atomic-waker v1.1.2
[stderr]    Compiling subtle v2.6.1
[stderr]    Compiling compression-core v0.4.32
[stderr]    Compiling compression-codecs v0.4.38
[stderr]    Compiling hyper v1.10.1
[stderr]    Compiling tracing v0.1.44
[stderr]    Compiling serialize-to-javascript v0.1.2
[stderr]    Compiling tauri-macros v2.6.3
[stderr]    Compiling muda v0.19.3
[stderr]    Compiling tauri-plugin-dialog v2.7.1
[stderr]    Compiling serde_repr v0.1.20
[stderr]    Compiling sync_wrapper v1.0.2
[stderr]    Compiling rfd v0.16.0
[stderr]    Compiling mime v0.3.17
[stderr]    Compiling ipnet v2.12.0
[stderr]    Compiling futures-sink v0.3.32
[stderr]    Compiling tower-layer v0.3.3
[stderr]    Compiling tower v0.5.3
[stderr]    Compiling tokio-util v0.7.18
[stderr]    Compiling hyper-util v0.1.20
[stderr]    Compiling tokio-rustls v0.26.4
[stderr]    Compiling async-compression v0.4.36
[stderr]    Compiling http-body-util v0.1.3
[stderr]    Compiling webpki-roots v1.0.8
[stderr]    Compiling ryu v1.0.23
[stderr]    Compiling serde_urlencoded v0.7.1
[stderr]    Compiling hyper-rustls v0.27.7
[stderr]    Compiling tower-http v0.6.11
[stderr]    Compiling markdown-editor v1.0.0 (/home/runner/work/mdr/mdr/src-tauri)
[stderr]    Compiling reqwest v0.12.28
[stderr]     Finished `release` profile [optimized] target(s) in 3m 33s
[stderr]        Built [tauri_cli::build] application at: /home/runner/work/mdr/mdr/src-tauri/target/release/markdown-editor
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

- 跟踪文件：129 个。
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
- `src/editor/hybrid/widgets.js`：1788 行，66491 bytes。
- `public/app/scroll-sync.js`：1369 行，60811 bytes。
- `public/app/preview.js`：1271 行，55146 bytes。
- `src-tauri/src/document_store.rs`：1159 行，39644 bytes。
- `public/app/editor-tools.js`：1103 行，40955 bytes。
- `src/editor/hybrid/inline-presentation.js`：959 行，37904 bytes。
- `index.html`：944 行，68834 bytes。
- `public/app/export.js`：927 行，36448 bytes。
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
