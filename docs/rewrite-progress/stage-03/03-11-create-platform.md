# Stage 3 / Atomic Task 3.11 — createPlatform

## Result

Atomic Task 3.11 implementation is complete and awaiting controlled Windows/browser validation. One capability-driven `createPlatform()` now composes the frozen twelve-Port surface; Atomic Task 3.12 caller cutover and legacy runtime deletion remain intentionally deferred.

## Implemented scope

- Added `src/platform/create-platform.js` as the single platform composition root.
- Added `src/platform/desktop/desktop-platform.js` to compose the existing Atomic 3.3–3.9 desktop clients and normalize only their runtime-specific result shapes into frozen Port contracts.
- Exported `createPlatform`, `PlatformCapabilityUnavailableError` and `createDesktopPlatform` through `src/platform/index.js`.
- Added focused `create-platform.test.mjs` and `desktop-platform-contract.test.mjs` suites.
- Advanced the Stage 3 workflow and prior Atomic ordering guards through 3.11.
- Registered the two production modules. Current inventory target is **174 production modules / 35 platform modules**.

## Capability composition

`createPlatform()` owns runtime detection, immutable capability snapshot consumption and adapter selection only. Browser/WebView capabilities use the Atomic 3.10 Storage, FileReader/Download, Clipboard, Fullscreen and Print adapters plus browser fetch/open/confirm surfaces. Desktop-only FileSystem, Dialog, Window, DragDrop, DocumentStore, Web, Link and Log responsibilities select the Atomic 3.3–3.9 desktop implementation set.

Desktop result normalization remains isolated in `desktop-platform.js`: native dropped-text results become Port text, native image results become data URLs, and native web-fetch results become text. Malformed results fail explicitly; native exceptions retain their original identity. No business workflow, Toast, document state or export policy is moved into this layer.

## Unsupported capability contract

Unavailable operations never resolve through an empty function or fabricated success value. They throw `PlatformCapabilityUnavailableError` with code `PLATFORM_CAPABILITY_UNAVAILABLE` plus the affected Port, method and capability identifier. This keeps a complete twelve-Port shape without pretending unavailable runtime behavior exists.

## Capability consistency repair

Atomic 3.11 also closes two same-chain capability mismatches discovered during composition review:

- WebKit-only fullscreen surfaces are now detected consistently with the existing Browser Fullscreen adapter.
- Browser file-download capability now requires `Blob` in addition to anchor/ObjectURL surfaces, matching what `files.writeText()` and `files.writeBinary()` actually execute.

Both paths have focused capability tests.

## Lifecycle and compatibility

The returned Platform object is immutable and delegates lifecycle ownership to the existing `createPlatformPortSet()`, retaining reverse/idempotent destruction and subscription disposal semantics.

`src/runtime/tauri.js` and all classic/business callers remain unchanged in Atomic 3.11. They continue using the current compatibility facade until Atomic Task 3.12 performs progressive caller replacement and deletes the obsolete facade. No Rust command, DTO, persistence format, public legacy method, dependency, `package.json` or `package-lock.json` is changed here.

## Evidence and verification

The established Stage 3 evidence recorder keeps all 3.1–3.10 checks, advances current inventory expectations to **174 / 35**, recognizes `desktop-platform.js`, and then invokes a separate `record-create-platform-evidence.mjs`. The new evidence responsibility is intentionally separate instead of adding another Atomic implementation into the existing large Stage 3 recorder.

The 3.11 evidence verifies Browser and Desktop composition, explicit unavailable-capability errors, twelve-Port shape, runtime selection, WebKit fullscreen consistency, production registration, legacy-facade retention and the absence of business/feature imports from the composition layer.

Controlled validation is pending. Required order: 3.11 focused suites → complete Platform unit regression → architecture hard gate → Node regression → browser contract → production build → built-app browser regression → Stage 3 evidence generation → npm audit.

## Remaining risk

Until Windows validation runs, real desktop integration and complete repository regression remain unverified for this commit. Atomic Task 3.12 must not start until these 3.11 hard checks pass and this record is updated with actual results.
