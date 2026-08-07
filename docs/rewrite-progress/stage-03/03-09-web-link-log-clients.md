# Stage 3 / Atomic Task 3.9 — Web / Link / Log clients

## Result

Atomic Task 3.9 implementation is complete and awaiting controlled validation. The three remaining native command responsibilities are now separated into dedicated desktop clients; no generic native client was introduced.

## Implemented scope

- Added `src/platform/desktop/web-fetch-client.js` for `fetch_url` only.
- Added `src/platform/desktop/link-client.js` for `open_external_url` only.
- Added `src/platform/desktop/performance-log-client.js` for `write_performance_logs` only.
- Exported all three clients through `src/platform/index.js`.
- Removed the last three direct `invokeClient.invoke()` calls from `src/runtime/tauri.js`; the compatibility facade now delegates every current native command through responsibility-focused clients.
- Preserved Web `inputLength`, Link trim/scheme/input-length telemetry and Log `{ record: false }` recursive-telemetry suppression.
- Updated Stage 3 workflow, production ownership, regression assertions and machine-readable evidence for node 3.9.

## Responsibility boundaries

- `web-fetch-client.js` does not normalize URLs, follow redirects, validate HTTP status or interpret HTML. Those remain in Rust `web_fetch.rs` and the web-clipper business flow.
- `link-client.js` does not own the supported-scheme whitelist or operating-system launch behavior. Rust `external_link.rs` remains the native security authority.
- `performance-log-client.js` does not own queue size, aggregation, diagnostics, retry/requeue, timers or flush state. Those remain in `src/runtime/performance.js`; Rust remains responsible for durable log persistence and limits.

## Compatibility

Existing `window.markdownEditorNative.fetchUrl()`, `openExternalUrl()` and `writePerformanceLogs()` names and unavailable-runtime behavior remain unchanged. Native command names, DTOs, errors, Rust implementations, business callers, dependencies and lock files are unchanged.

## Verification

Controlled validation is pending. Required order: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9 → architecture hard gate → Node/browser/build regression → evidence generation.

Production inventory target after this task: **166 modules total, 27 platform modules**. The legacy compatibility runtime target is **zero direct `invokeClient.invoke()` calls**.

## Remaining risk

Until Windows validation completes, the three client cutovers and zero-direct-invoke target are not claimed as passed. Atomic Task 3.10 Browser adapters remains deferred.
