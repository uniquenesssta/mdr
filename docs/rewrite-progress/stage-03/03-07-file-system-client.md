# Stage 3 / Atomic Task 3.7 — FileSystem client

## Result

Atomic Task 3.7 implementation is complete and awaiting controlled validation. The six existing Rust local-file commands now have one responsibility-focused desktop adapter under `src/platform/desktop/`; document creation, Toasts and file-kind reactions remain in the application layer.

## Implemented scope

- Added `src/platform/desktop/file-system-client.js` and exported `createFileSystemClient()` through `src/platform/index.js`.
- Mapped exactly `read_dropped_file`, `list_text_file_tree`, `read_local_image`, `initial_file_path`, `write_local_text_file` and `write_local_binary_file` through the existing measured Invoke client.
- Moved binary Base64 transport encoding out of `src/runtime/tauri.js` with the file-command responsibility.
- Preserved the legacy facade method names, unavailable-runtime fallbacks, argument normalization, telemetry details and native result/error identity.
- Kept Rust as the authority for native path resolution, supported file kinds, `DroppedFile`/tree/write DTOs and image MIME generation.
- Updated the production ownership fixture, Stage 3 evidence recorder and Stage 3 workflow for node 3.7.

## Compatibility

`public/app/events.js`, `public/app/export.js` and Rust command implementations are unchanged. Drag/drop document creation, image insertion, save/export workflows and Toast handling remain above the platform client. No Rust command name, DTO field, persistence format, frozen model contract, production dependency or lock file is changed by Atomic Task 3.7.

## Verification

Controlled validation is pending for the implementation commit. Required order: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → architecture hard gate → full Node/browser/build regression → evidence generation.

Production inventory target after this task: 162 modules total, 23 platform modules.

## Remaining risk

Until controlled validation completes, architecture, browser/build and native Windows file-path regression are not claimed as passed. Atomic Task 3.8 DocumentStore client remains deferred.
