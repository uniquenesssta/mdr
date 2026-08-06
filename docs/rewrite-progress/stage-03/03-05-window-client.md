# Stage 3 / Atomic Task 3.5 — Window client

## Result

Atomic Task 3.5 is complete. Desktop application-window behavior now has one responsibility-focused owner under `src/platform/desktop/`, while save-before-close policy remains in the application layer.

## Implemented scope

- Added `src/platform/desktop/window-client.js` as the sole production owner of `@tauri-apps/api/window`.
- Added the frozen `createWindowClient()` factory through `src/platform/index.js`.
- Unified start-drag, minimize, toggle-maximize, maximized-state, resize subscription, close-request subscription, normal close and force close.
- Preserved native result and error semantics.
- Added owned, idempotent subscription disposers and idempotent reverse-order client cleanup.
- Disposed subscription results that resolve after client destruction instead of publishing them as active resources.
- Removed direct `getCurrentWindow()` use from `src/runtime/tauri.js` and delegated all eight compatibility methods through the public platform entry.

## Compatibility

The temporary `window.markdownEditorNative` methods `onCloseRequested`, `startWindowDragging`, `minimizeWindow`, `toggleMaximizeWindow`, `isWindowMaximized`, `onWindowResized`, `closeWindow` and `destroyWindow` retain their signatures, return values and unavailable fallbacks. `public/app/events.js` still owns close prevention, final document persistence, snapshot waiting and fallback force-close. The platform adapter does not contain document, save or confirmation policy.

No Rust command, DTO, persistence format, frozen model contract, production dependency, lock file or user-visible business behavior changed.

## Verification

Implementation commit: `227a1d86f6c959ecc14874a0e2b151abff6ae113`. Validation commit: `77fce3ef8041d54b5cd6a67edbea03d9facbd637`.

- Stage 0 Baseline Verification: run `31105812402`, passed, including Node, browser, build, Rust test/check and Tauri Linux build.
- Stage 1 Atomic Verification: run `31105812432`, passed.
- Stage 2 Atomic Verification: run `31105812320`, passed.
- Stage 3 Atomic Verification: run `31105812338`, passed, including the new 3.5 contract before architecture and full regression.
- Stage 3 evidence artifact: `stage-03-platform-foundation-31105812338-1`, artifact `8969486354`, digest `sha256:d731c13a4a52fbdf79b774f95c6d63e431fb609b906e944647d7fbfe34fd68e9`.
- Production inventory: 160 modules total, 21 platform modules.
- Existing dependency audit remains 1 low / 1 high; no dependency or lock-file change was made.

## Remaining risk

Ubuntu verification does not exercise Windows-native WebView window behavior. Real Windows drag, minimize/maximize, resize, close-request, normal-close, force-close and native disposer coverage remains required when desktop runtime validation is performed.

DragDrop and later concrete adapters remain assigned to subsequent Atomic Tasks.
