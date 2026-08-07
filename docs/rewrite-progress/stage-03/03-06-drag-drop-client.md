# Stage 3 / Atomic Task 3.6 — DragDrop client

## Result

Atomic Task 3.6 implementation is complete and awaiting controlled validation. Native Tauri drag/drop subscription and event normalization now have one responsibility-focused owner under `src/platform/desktop/`; file interpretation remains in the application layer.

## Implemented scope

- Added `src/platform/desktop/drag-drop-client.js` as the sole production owner of `@tauri-apps/api/webview` drag/drop registration.
- Added frozen `createDragDropClient()` through `src/platform/index.js`.
- Normalized native payloads into immutable `{ type, paths, position }` platform events without extension, MIME or file-kind classification.
- Added owned idempotent subscription disposers, reverse-order `destroy()` cleanup and immediate cleanup of subscriptions that resolve after destruction.
- Preserved native registration/cleanup error identity and handler return/error semantics.
- Removed direct `getCurrentWebview().onDragDropEvent()` use from `src/runtime/tauri.js`; the compatibility facade delegates through the public client and preserves its existing `{ payload }` callback shape and unavailable `null` fallback.
- Updated the production ownership fixture, Stage 3 evidence recorder and Stage 3 workflow for node 3.6.

## Compatibility

`public/app/events.js` is unchanged. Drop-overlay behavior, first-path selection, text/image interpretation and `readDroppedFile()` handling remain in the application layer. No Rust command, DTO, persistence format, frozen model contract, production dependency or lock file is changed by Atomic Task 3.6.

## Verification

Controlled validation is pending for the implementation commit. The required Stage 3 order is 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → architecture hard gate → full Node/browser/build regression → evidence generation.

Production inventory target after this task: 161 modules total, 22 platform modules.

## Remaining risk

Until controlled validation completes, full architecture, browser, build and native desktop regression are not claimed as passed. Atomic Task 3.7 FileSystem client remains deferred.
