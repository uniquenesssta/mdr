# Stage 3 / Atomic Task 3.12 — Platform final cutover

## Result

Atomic Task 3.12 implementation is complete and awaiting final Windows Stage 3 validation. All production callers have been cut away from the legacy native facade; `src/runtime/tauri.js` is deleted and no production JavaScript module references `window.markdownEditorNative`.

## Final architecture

- `src/main.js` creates the single capability-driven Platform and injects responsibility-focused ports into ESM consumers.
- `src/platform/compatibility/classic-platform-port.js` is a scoped, destroyable migration bridge mounted only on the existing hidden `#compatibility-business-ports` host. It exposes `supports()` and `call()` only; it does not publish Platform or a native object on `window`.
- `NativeDocumentStore`, folder tree, link preview, performance logging and hybrid local-image resolution consume explicit Port contracts.
- Classic `core/events/export/web-clipper` call the scoped compatibility bridge while their broader business rewrites remain scheduled for later stages.
- Native drag/drop classification remains application policy: text/image extension classification is in `events.js`; actual local image MIME/path reading remains behind FilesPort/Rust.

## Removed authority

`src/runtime/tauri.js` has been deleted. The architecture baseline entry for `window.markdownEditorNative` was removed as a verified migration reduction; the current business-global baseline is 37 while Stage 1 historical documentation remains unchanged at the original 38.

## Compatibility

No Rust command, DTO, persistence format, dependency, package metadata or lock file is changed. Existing low-level desktop clients remain the sole Tauri API owners. Existing browser-only classic behaviors that are unrelated to the native facade remain unchanged for their later feature-stage rewrites.

## Tests and evidence

Historical Stage 3 client tests keep their low-level command, error, cancellation and lifecycle assertions, while former facade-integration assertions now verify the final `desktop-platform/createPlatform` composition and real callers. Focused 3.12 tests verify facade deletion, scoped classic bridging, ESM Port injection and native drag/drop responsibility boundaries.

Stage 3 evidence now targets 174 production modules / 36 platform modules and chains a dedicated `03-12-platform-cutover-evidence.json` recorder. The final recorder rejects any production `markdownEditorNative` owner, Tauri import outside platform desktop adapters, replacement global Platform facade, stale Windows automation dependency or missing 3.12 workflow gate.

## Windows automation

The Windows native window automation no longer monkey-patches the deleted facade. It calls the final scoped Platform window port for state/subscription/force-close operations. Native title-bar drag remains verified by a real Win32 window-position change plus the effective menu-bar mousedown target, and the normal application close-button scenario continues to exercise the production save-before-close/native-exit chain.

## Validation status

Remote guarded transformations have already demonstrated focused cutover tests and a production build, and the migrated complete Platform suite reached 135/135 with architecture and Node 42/42 passing. These are implementation-time checks only. Final browser, evidence and Windows-native validation must run on the clean final 3.12 commit before Stage 3 is marked PASS.
