# Stage 3 / Atomic Task 3.6 — DragDrop client

## Result

Atomic Task 3.6 is complete and accepted. Native Tauri drag/drop subscription and event normalization have one responsibility-focused owner under `src/platform/desktop/`; file interpretation remains in the application layer.

## Implemented scope

- Added `src/platform/desktop/drag-drop-client.js` as the sole production owner of `@tauri-apps/api/webview` drag/drop registration.
- Added frozen `createDragDropClient()` through `src/platform/index.js`.
- Normalized native payloads into immutable `{ type, paths, position }` platform events without extension, MIME or file-kind classification.
- Added owned idempotent subscription disposers, reverse-order `destroy()` cleanup and immediate cleanup of subscriptions that resolve after destruction.
- Preserved native registration/cleanup error identity and handler return/error semantics.
- Removed direct `getCurrentWebview().onDragDropEvent()` use from `src/runtime/tauri.js`; the compatibility facade delegates through the public client and preserves its existing `{ payload }` callback shape and unavailable `null` fallback.
- Updated the production ownership fixture, Stage 3 evidence recorder and Stage 3 workflow for node 3.6.

## Compatibility

`public/app/events.js` is unchanged. Drop-overlay behavior, first-path selection, text/image interpretation and `readDroppedFile()` handling remain in the application layer. No Rust command, DTO, persistence format, frozen model contract or production dependency changed. Atomic Task 3.6 did not modify `package-lock.json`.

## Verification

Windows local validation supplied on 2026-08-07 completed with these results:

- `node --test tests/unit/platform/drag-drop-client.test.mjs` — 10/10 passed.
- `npm run verify:architecture` — passed.
- `npm test` — 42/42 passed.
- `npm run test:browser:contract` — 10/10 passed.
- `npm run build` — Vite production build passed; only the existing chunk-size warning was reported.
- `npm run test:browser` — 12/12 passed.
- `node scripts/stage-03/record-platform-evidence.mjs` — completed without a reported error.
- `npm audit` — 0 vulnerabilities.

Production inventory after this task: 161 modules total, 22 platform modules.

## Remaining risk

A separate manual live Tauri drag/drop gesture was not recorded in this Atomic Task validation. The task did not modify Rust/native commands, and the affected JavaScript adapter, architecture ownership, browser compatibility and production build paths all passed their defined checks. Stage 3 final native acceptance remains a stage-level gate.

Atomic Task 3.7 FileSystem client is the next planned task.
