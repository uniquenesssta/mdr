# Stage 3 / Atomic Task 3.12 — Platform final cutover

## Result

Atomic Task 3.12 implementation is complete. Local Windows acceptance and the clean-commit Stage 3 Atomic workflow pass. The remaining native Windows automation blocker was traced to the isolated WebDriver host sharing the production Cargo target after dependency/cache externalization; a dedicated external target fix is now implemented and awaiting the real native rerun. Atomic 3.12 / Stage 3 are not marked final PASS until that rerun succeeds.

All production callers have been cut away from the legacy native facade; `src/runtime/tauri.js` is deleted and no production JavaScript module references `window.markdownEditorNative`.

## Final architecture

- `src/main.js` creates the single capability-driven Platform and injects responsibility-focused ports into ESM consumers.
- `src/platform/compatibility/classic-platform-port.js` is a scoped, destroyable migration bridge mounted only on the existing hidden `#compatibility-business-ports` host. It exposes `supports()` and `call()` only; it does not publish Platform or a native object on `window`.
- `NativeDocumentStore`, folder tree, link preview, performance logging and hybrid local-image resolution consume explicit Port contracts.
- Classic `core/events/export/web-clipper` call the scoped compatibility bridge while their broader business rewrites remain scheduled for later stages.
- Native drag/drop classification remains application policy: text/image extension classification is in `events.js`; actual local image MIME/path reading remains behind FilesPort/Rust.

## Removed authority

`src/runtime/tauri.js` has been deleted. The architecture baseline entry for `window.markdownEditorNative` was removed as a verified migration reduction; the current business-global baseline is 37 while Stage 1 historical documentation remains unchanged at the original 38.

## Compatibility

No Rust command, DTO, persistence format, production dependency, package metadata or lock file is changed. Existing low-level desktop clients remain the sole Tauri API owners. Existing browser-only classic behaviors that are unrelated to the native facade remain unchanged for their later feature-stage rewrites.

## Tests and evidence

Historical Stage 3 client tests keep their low-level command, error, cancellation and lifecycle assertions, while former facade-integration assertions now verify the final `desktop-platform/createPlatform` composition and real callers. Focused 3.12 tests verify facade deletion, scoped classic bridging, ESM Port injection and native drag/drop responsibility boundaries.

Stage 3 evidence targets 174 production modules / 36 platform modules and chains a dedicated `03-12-platform-cutover-evidence.json` recorder. The final recorder rejects any production `markdownEditorNative` owner, Tauri import outside platform desktop adapters, replacement global Platform facade, stale Windows automation dependency or missing 3.12 workflow gate.

## Windows automation

The Windows native window automation no longer monkey-patches the deleted facade. It calls the final scoped Platform window port for state/subscription/force-close operations. Native title-bar drag remains intended to be verified by a real Win32 window-position change plus the effective menu-bar mousedown target, and the normal application close-button scenario continues to exercise the production save-before-close/native-exit chain once a WebDriver session is established.

The clean 3.12 workflow successfully completed dependency preparation, the automation architecture contract, frontend build, the real Windows release build, preparation/build of the isolated embedded WebDriver host, evidence setup and input verification. The automation step then failed before behavioral checks started: the native window became available, but the embedded WebDriver session could not be created and reported `No window could be found`. `state-application.log` was empty.

### Native blocker root cause and fix

Historical workflow comparison found that the last successful Windows Native run was commit `7bc155b562eb645063152a0ff82ad953a7d83313`. Its isolated WebDriver host used its own Cargo target. The immediately following dependency/cache externalization commit `344c9274b0cdbb376ab5043107d7feb410008534` moved both production and isolated-host builds under the same external target `../.cargo-target/markdown-editor`. The embedded WebDriver session implementation itself is unchanged between the successful commit and current code.

The fix preserves the external-cache policy while restoring build isolation:

- production Cargo target remains `../.cargo-target/markdown-editor`;
- isolated WebDriver host now builds into `../.cargo-target/markdown-editor-windows-driver-host`;
- the Windows workflow passes that target explicitly with `--target-dir` so root `.cargo/config.toml` cannot collapse both builds back into one target;
- `MARKDOWN_EDITOR_BINARY` and generated driver-host evidence point to the dedicated target;
- dependency-location and Windows automation architecture tests now require two distinct repository-parent Cargo targets.

No production Rust source, dependency declaration or lock file is changed by this fix. Increasing WebDriver timeouts or weakening the native gate was intentionally avoided.

## Validation status

User-local Windows validation on implementation commit `0209e1301711d46c45120426bcbfba46c6e35a25`:

- Atomic 3.12 focused tests: 6/6 passed.
- Complete Platform suite: 135/135 passed.
- `verify:architecture`, `verify:no-legacy-runtime`, `verify:generated-files`, `verify:readme-record`: passed.
- Node regression: 42/42 passed.
- Browser contract: 10/10 passed.
- Vite production build: passed; the existing >500 kB chunk-size advisory remains non-failing.
- Built-application browser regression: 12/12 passed.
- `record-platform-evidence.mjs`: completed without error.
- `npm audit`: 0 vulnerabilities.

The clean-commit Stage 3 Atomic Verification workflow also passed before the native-target fix. The original Windows Native blocker was run `31210498776`, which failed only at `Run native Windows window automation` because the embedded WebDriver session could not attach to a window. The dedicated external-target fix is implemented but still requires a successful real Windows Native rerun before Atomic 3.12 / Stage 3 can be marked final PASS.
