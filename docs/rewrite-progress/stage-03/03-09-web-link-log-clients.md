# Stage 3 / Atomic Task 3.9 — Web / Link / Log clients

## Result

Atomic Task 3.9 is **PASS**. The three remaining native command responsibilities are separated into dedicated desktop clients; no generic native client was introduced, and the legacy compatibility runtime now has zero direct `invokeClient.invoke()` calls.

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

Windows validation completed on 2026-08-07 after fast-forwarding `rewrite/modular-rebuild` to Atomic 3.9:

- Atomic 3.9 Web / Link / Log client tests: **16/16 passed**.
- `npm run verify:architecture`: **passed**.
- `npm test`: **42/42 passed**.
- `npm run test:browser:contract`: **10/10 passed**.
- `npm run build`: **passed**, Vite transformed 2206 modules; the existing chunk-size warning for minified chunks above 500 kB remains informational and was not changed by this task.
- `npm run test:browser`: **12/12 passed**.
- `node scripts/stage-03/record-platform-evidence.mjs`: **completed successfully** with no error output.
- `npm audit`: **0 vulnerabilities**.

Production inventory is **166 modules total, 27 platform modules**. The legacy compatibility runtime has **zero direct `invokeClient.invoke()` calls**.

## Remaining risk

No Atomic 3.9 acceptance failure remains. This task did not alter Rust implementations, dependencies or lock files. Atomic Task 3.10 Browser adapters remains deferred and must be executed as a separate Atomic Task.
