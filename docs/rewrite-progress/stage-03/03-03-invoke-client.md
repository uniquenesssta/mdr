# Stage 3 / Atomic Task 3.3 — Invoke client

## Result

Atomic Task 3.3 is complete. The Tauri invoke transport now has one responsibility-focused owner under `src/platform/desktop/`, and the legacy runtime delegates every existing Rust command through that public client.

## Implemented scope

- Added `src/platform/desktop/invoke-client.js` as the sole production owner of `@tauri-apps/api/core` invoke.
- Added a frozen `createInvokeClient()` public factory through `src/platform/index.js`.
- Preserved exact command strings and argument-object identity for all 19 existing Rust commands.
- Recorded native round-trip duration for success and error paths while rethrowing the original error object unchanged.
- Isolated telemetry failures so they cannot replace invoke results or errors.
- Routed performance-log writes through the same client with explicit telemetry suppression to prevent recursive log generation.
- Removed the direct invoke import and `invokeMeasured` implementation from `src/runtime/tauri.js`.

## Compatibility

The 33 methods on the temporary `window.markdownEditorNative` compatibility surface remain unchanged. No Rust command, DTO, persistence format, cancellation value, public business behavior, dependency, lock file or frozen model contract changed. Dialog, Window, DragDrop, FileSystem, DocumentStore, Web, Link and Log adapters remain assigned to Atomic Task 3.4 and later.

## Verification

Implementation commit: `9f0fd626b4641a2ff65f290c03db66b8aebbce41`.

- Stage 0 Baseline Verification: run `31099246681`, passed, including Node, browser, build, Rust test/check and Tauri Linux build.
- Stage 1 Atomic Verification: run `31099246710`, passed.
- Stage 2 Atomic Verification: run `31099246709`, passed.
- Stage 3 Atomic Verification: run `31099246731`, passed, including the new 3.3 contract before architecture and full regression.
- Stage 3 evidence artifact: `stage-03-platform-foundation-31099246731-1`, artifact `8966773990`, digest `sha256:2f268facc4a9ddc1a820bcc2850f8f1907769b6dba1a6e2d23b7b82cd0b00d50`.
- Production inventory: 158 modules total, 19 platform modules.

## Remaining risk

Ubuntu verification does not exercise the Windows-native WebView invoke path. The client preserves the existing Tauri command transport and is contract-tested with injected implementations; Windows-native runtime coverage remains required when later desktop adapters change concrete dialog, window, drag/drop or filesystem behavior.
