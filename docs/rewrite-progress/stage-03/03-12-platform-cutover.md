# Stage 3 / Atomic Task 3.12 — Platform final cutover

## Result

Atomic Task 3.12 is **PASS** and Stage 3 is **PASS**. All production callers have been cut away from the legacy native facade; `src/runtime/tauri.js` is deleted and no production JavaScript module references `window.markdownEditorNative`. User-local acceptance, the clean-commit Stage 3 Atomic workflow and the real Windows Native window lifecycle workflow all pass.

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

## Windows automation repairs

The Windows native window automation no longer monkey-patches the deleted facade. It calls the final scoped Platform window port for state/subscription/force-close operations. Native title-bar drag is verified by a real Win32 window-position change plus the effective menu-bar mousedown target, and the normal application close-button scenario exercises the production save-before-close/native-exit chain.

### Repair 1 — WebDriver host build isolation

The original clean 3.12 Windows Native run `31210498776` reached the native window but could not establish an embedded WebDriver session and reported `No window could be found`.

Historical workflow comparison found that the last successful native run before that blocker, commit `7bc155b562eb645063152a0ff82ad953a7d83313`, used a separate Cargo target for the isolated WebDriver host. Dependency/cache externalization commit `344c9274b0cdbb376ab5043107d7feb410008534` had moved both production and isolated-host builds under the same external target.

The repair keeps all heavy targets outside the repository while restoring isolation:

- production target remains `../.cargo-target/markdown-editor`;
- isolated WebDriver host uses `../.cargo-target/markdown-editor-windows-driver-host`;
- workflow host build explicitly passes its own `--target-dir`;
- `MARKDOWN_EDITOR_BINARY` and driver-host evidence point to the isolated target;
- static dependency/window automation contracts require the targets to remain distinct.

Clean repair commit `e67546b27c93932efa6ca767fddc4921934b5214` confirmed the old session blocker was removed: WebDriver attached successfully and JavaScript executed.

### Repair 2 — first-run Help Modal initialization race

Once session attachment worked, Windows Native run `31235397046` reached the title-bar behavior test but correctly refused to drag because `#help-modal.modal-overlay.show` covered every valid drag target.

The test surface had been checking Help immediately after session attachment, while application `init()` was still asynchronous and opens first-run Help near its end. The repair uses the existing application lifecycle signal rather than a delay or DOM bypass:

- wait for `window.__markdownEditorInitPromise` to become available;
- await that exact application initialization promise;
- then inspect first-run Help;
- when open, use the visible normal close button and wait for the normal close transition;
- no localStorage mutation, `.show` removal, pointer-event override, private modal event or arbitrary sleep is used.

`tests/windows-window-automation.test.mjs` locks this ordering and explicitly rejects the bypasses above.

## Final validation

User-local Windows validation on implementation commit `0209e1301711d46c45120426bcbfba46c6e35a25`:

- Atomic 3.12 focused tests: **6/6 passed**.
- Complete Platform suite: **135/135 passed**.
- `verify:architecture`, `verify:no-legacy-runtime`, `verify:generated-files`, `verify:readme-record`: **passed**.
- Node regression: **42/42 passed**.
- Browser contract: **10/10 passed**.
- Vite production build: **passed**; the existing >500 kB chunk-size advisory remains non-failing.
- Built-application browser regression: **12/12 passed**.
- `record-platform-evidence.mjs`: **passed**.
- `npm audit`: **0 vulnerabilities**.

Final executable repair commit `1921684fd0a402d92a7426994c85765820f9cc0e`:

- Stage 3 Atomic Verification run `31236205911`: **PASS** — all 3.1–3.12 checks, architecture, Node, Browser Contract, build, built-app browser regression and evidence completed successfully.
- Stage 3 Windows Window Automation run `31236205921`: **PASS**.
- Windows native static/dependency contracts: **5/5 passed**.
- real Windows release build: **passed**.
- isolated embedded WebDriver host build: **passed** using `../.cargo-target/markdown-editor-windows-driver-host`.
- native scenario `native-window-state-subscriptions-and-drag`: **passed**. Maximize reached `showCmd=3`; restore/minimize state was verified; one resize event was received and no extra event appeared after disposer; Win32 drag moved the window from `(0,0)` to `(120,80)` and the menu bar recorded one mousedown.
- native scenario `application-close-button-save-and-native-exit`: **passed**, process exited.
- native scenario `force-close-destroys-native-window`: **passed**, process exited.
- Windows evidence artifact `stage-03-windows-window-31236205921-1` uploaded successfully with status `passed`.

The two native automation defects were fixed without weakening the gate or changing production Rust, production dependencies or lock files. No remaining Stage 3 hard-validation gap is known. Atomic Task 3.12 and Stage 3 are complete; Stage 4 may start.
