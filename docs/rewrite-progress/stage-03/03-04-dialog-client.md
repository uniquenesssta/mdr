# Stage 3 / Atomic Task 3.4 — Dialog client

## Result

Atomic Task 3.4 is complete. Desktop open-file, directory, save-file and confirmation dialogs now have one responsibility-focused owner under `src/platform/desktop/`.

## Implemented scope

- Added `src/platform/desktop/dialog-client.js` as the sole production owner of `@tauri-apps/plugin-dialog`.
- Added a frozen `createDialogClient()` factory through `src/platform/index.js`.
- Preserved open-file, directory and save cancellation as `null`; confirmation cancellation remains `false`.
- Preserved filename sanitization, native default-path joining, accepted-extension checks and missing-extension completion.
- Preserved native error identity and isolated telemetry failures from dialog results and errors.
- Removed dialog-plugin imports and duplicate filename/path helpers from `src/runtime/tauri.js`.

## Compatibility

The temporary `window.markdownEditorNative` methods `chooseOpenPath`, `chooseDirectoryPath`, `chooseSavePath` and `confirmAction` retain their existing signatures and browser/unavailable fallbacks. No Rust command, DTO, persistence format, dependency, lock file, frozen model contract or user-visible business behavior changed. Window and other desktop adapters remain assigned to Atomic Task 3.5 and later.

## Verification

Implementation commit: `bf13bf9083e4b9c2d155f8ae3b38ce08436f551c`. Validation commit: `ab791c10c50a5817f510785af15b4aafa478a4fc`.

- Stage 0 Baseline Verification: run `31101813428`, passed, including Node, browser, build, Rust test/check and Tauri Linux build.
- Stage 1 Atomic Verification: run `31101814002`, passed.
- Stage 2 Atomic Verification: run `31101813750`, passed.
- Stage 3 Atomic Verification: run `31101813553`, passed, including the new 3.4 contract before architecture and full regression.
- Stage 3 evidence artifact: `stage-03-platform-foundation-31101813553-1`, artifact `8967804492`, digest `sha256:54340e272d1b193e14bdef4edff3467c1ac4f19a3bfe68583fbcf2b0afbe9211`.
- Production inventory: 159 modules total, 20 platform modules.

## Remaining risk

Ubuntu verification does not exercise Windows-native WebView dialog behavior. Real Windows open/save/directory/confirm coverage remains required when desktop runtime validation is performed.
