# Stage 3 / Atomic Task 3.8 — DocumentStore client

## Result

Atomic Task 3.8 implementation is complete and awaiting controlled validation. The ten existing Rust document-store commands now have one responsibility-focused desktop adapter under `src/platform/desktop/`; document sessions, version-mismatch recovery, cancellation and persistence policy remain in `src/storage/native-document-store.js` and Rust.

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

Controlled validation is pending. Required order: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → architecture hard gate → Node/browser/build regression → evidence generation. Browser validation must also confirm no visible Chrome/Edge window opens during executable discovery or headless regression.

Production inventory target after this task: **163 modules total, 24 platform modules**.

## Remaining risk

Until Windows validation completes, the DocumentStore cutover and no-popup E2E launcher are not claimed as passed. Atomic Task 3.9 Web/Link/Log clients remains deferred.
