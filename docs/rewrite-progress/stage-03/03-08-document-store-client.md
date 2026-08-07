# Stage 3 / Atomic Task 3.8 — DocumentStore client

## Result

Atomic Task 3.8 is **PASS**. The ten existing Rust document-store commands now have one responsibility-focused desktop adapter under `src/platform/desktop/`; document sessions, version-mismatch recovery, cancellation and persistence policy remain in `src/storage/native-document-store.js` and Rust.

## Implemented scope

- Added `src/platform/desktop/document-store-client.js` and exported `createDocumentStoreClient()` through `src/platform/index.js`.
- Mapped exactly `save_document_state`, `begin_document_snapshot_upload`, `append_document_snapshot_chunk`, `commit_document_snapshot_upload`, `abort_document_snapshot_upload`, `load_document_state`, `load_document_manifest`, `read_document_chunk`, `search_document_state` and `delete_document_state` through the existing Invoke client.
- Preserved request-object identity, camelCase field names, version fields, chunk upload fields, read-chunk defaults/minimums, telemetry details and native result/error identity.
- Removed those ten direct Invoke mappings from `src/runtime/tauri.js`; the compatibility facade keeps the existing public method names and unavailable-runtime fallbacks.
- Kept sessions, `VERSION_MISMATCH` recovery, load sequencing/cancellation, chunking policy and document events outside the platform client.
- Updated production ownership, Stage 3 verification and machine-readable evidence for node 3.8.

## Browser test popup fix

The E2E launcher already ran the actual Chrome/Edge session with `--headless=new`. The visible Windows popup risk came from executable discovery executing each browser candidate with `--version`. Discovery now uses side-effect-free filesystem/PATH resolution and never launches a browser merely to probe its existence. Browser regression behavior and CDP coverage remain unchanged.

## Compatibility

`src/storage/native-document-store.js`, `src-tauri/src/document_store.rs` and business callers are unchanged. No Rust command, DTO field, persistence format, version semantics, production dependency or lock file changed. After this task the legacy runtime has only `fetch_url`, `open_external_url` and `write_performance_logs` as direct Invoke mappings, reserved for Atomic Task 3.9.

## Verification

Windows validation was performed against implementation commit `1bfca7c1ebe37c4b2ec9ebb1fa6c3faccea7b375`:

- `node --test tests/unit/platform/document-store-client.test.mjs`: **9/10 passed initially**. The only failure was a source-boundary assertion whose forbidden-token regex matched the word `sessions` in the client JSDoc; executable code contained none of the forbidden state/session policy. The follow-up changed that comment only and the exact failing regex was rechecked against the corrected source with no match.
- `npm run verify:architecture`: **passed**.
- `npm test`: **42/42 passed**.
- `npm run test:browser:contract`: **10/10 passed**.
- `npm run build`: **passed**, 2203 modules transformed; Vite reported the existing >500 kB chunk-size advisory.
- `npm run test:browser`: **12/12 passed**.
- `node scripts/stage-03/record-platform-evidence.mjs`: **passed** with no error output.
- `npm audit`: **0 vulnerabilities**.

Production inventory after this task: **163 modules total, 24 platform modules**.

## Remaining risk

No task-blocking validation gaps remain for Atomic Task 3.8. The uploaded console output cannot independently prove whether a visible Chrome/Edge window appeared on screen; automated coverage verifies side-effect-free executable discovery and headless browser startup. If a visible window still appears, treat it as a separate E2E launcher regression. Atomic Task 3.9 Web/Link/Log clients remains deferred.
