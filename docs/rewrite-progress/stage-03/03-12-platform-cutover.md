# Stage 3 / Atomic Task 3.12 — Platform final cutover

## Result

Atomic Task 3.12 implementation is complete. User-local Windows acceptance and the clean-commit Stage 3 Atomic workflow pass. Windows Native validation has progressed through two separately identified automation defects: the embedded WebDriver host build was no longer isolated from the production Cargo target, and after that isolation was restored the session attached successfully but the first-run Help Modal could still race with asynchronous application initialization and cover the title-bar drag surface. The second repair now waits for application initialization before closing the modal through its normal UI path. Atomic 3.12 / Stage 3 remain pending until the real Windows maximize/resize/drag/close rerun succeeds.

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

The Windows native window automation no longer monkey-patches the deleted facade. It calls the final scoped Platform window port for state/subscription/force-close operations. Native title-bar drag must be verified by a real Win32 window-position change plus the effective menu-bar mousedown target, and the normal application close-button scenario must exercise the production save-before-close/native-exit chain.

### Blocker 1 — WebDriver host build isolation

The original clean 3.12 Windows Native run `31210498776` successfully completed dependency preparation, the automation architecture contract, frontend build, the real Windows release build, preparation/build of the isolated embedded WebDriver host, evidence setup and input verification. The automation step then failed before behavioral checks started: the native window became available, but the embedded WebDriver session could not be created and reported `No window could be found`; `state-application.log` was empty.

Historical workflow comparison found that the last successful Windows Native run was commit `7bc155b562eb645063152a0ff82ad953a7d83313`. Its isolated WebDriver host used its own Cargo target. The immediately following dependency/cache externalization commit `344c9274b0cdbb376ab5043107d7feb410008534` moved both production and isolated-host builds under the same external target `../.cargo-target/markdown-editor`. The embedded WebDriver session implementation itself was unchanged between the successful commit and the failing code.

The repair preserves the external-cache policy while restoring build isolation:

- production Cargo target remains `../.cargo-target/markdown-editor`;
- isolated WebDriver host builds into `../.cargo-target/markdown-editor-windows-driver-host`;
- the Windows workflow passes that target explicitly with `--target-dir` so root `.cargo/config.toml` cannot collapse both builds back into one target;
- `MARKDOWN_EDITOR_BINARY` and generated driver-host evidence point to the dedicated target;
- dependency-location and Windows automation architecture tests require two distinct repository-parent Cargo targets.

The clean repair commit `e67546b27c93932efa6ca767fddc4921934b5214` proved this fix materially changed the failure point: the WebDriver session attached successfully and JavaScript executed. Therefore the old `No window could be found` session-creation blocker is resolved. Increasing session timeouts or weakening the native gate was not used.

### Blocker 2 — first-run Help Modal initialization race

After session attachment recovered, Windows Native run `31235397046` reached the actual title-bar test and failed because every candidate drag point was covered by `#help-modal.modal-overlay.show` with `pointer-events: auto`, fixed positioning and z-index 200. The automation therefore correctly refused to synthesize a drag through an obstructing modal.

`tests/e2e/windows/window-test-surface.mjs` itself matched the last historically successful version, so the close path had not been deleted. The problem is readiness ordering: the helper previously inspected the Help Modal immediately after the WebDriver session attached. Application startup is asynchronous, and `public/app/events.js` exposes the existing `window.__markdownEditorInitPromise` around `init()`. `public/app/bootstrap.js` opens first-run Help near the end of that `init()` call. The helper could therefore observe the modal as closed, return, and then have initialization open it before the drag scenario.

The repair keeps the normal UI behavior intact:

- wait until `window.__markdownEditorInitPromise` exists and is promise-like;
- await that exact application initialization promise;
- only then inspect `#help-modal`;
- if first-run Help is open, close it through the existing visible header close button and wait for the normal transition to complete;
- do not mutate localStorage, remove the `.show` class, disable pointer events, dispatch a private close event or add arbitrary sleeps.

`tests/windows-window-automation.test.mjs` now locks this ordering by requiring the initialization barrier before the first Help surface read and explicitly bans direct modal-state bypasses and `setTimeout` delays in the test-surface helper.

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

Clean repair commit `e67546b27c93932efa6ca767fddc4921934b5214` also passed the complete Stage 3 Atomic Verification workflow. Its Windows Native run confirmed the dedicated-target repair by successfully establishing the WebDriver session, then exposed the Help Modal readiness race described above.

No production Rust source, production dependency declaration or lock file is changed by either Windows automation repair. The application-initialization barrier is implemented and requires one successful real Windows Native rerun before Atomic 3.12 / Stage 3 can be marked final PASS.
