# Stage 3 / Atomic Task 3.10 — Browser adapters

## Result

Atomic Task 3.10 implementation is complete. Browser runtime responsibilities are split into six independent adapters; `createPlatform` composition and caller cutover remain intentionally deferred to Atomic Task 3.11.

Windows validation on 2026-08-07 passed architecture, Node regression, browser contract, production build, built-app browser regression, Stage 3 evidence generation and npm audit. The Platform unit suite reported 113/114 because the Print boundary test incorrectly treated the ESM `export` keyword as forbidden export-business behavior. The production adapter did not violate the boundary. The test matcher has been corrected and requires one rerun before Atomic 3.10 is marked PASS.

## Implemented scope

- Added `src/platform/browser/browser-storage.js` for string `localStorage` get/set/remove/clear semantics.
- Added `src/platform/browser/browser-file-download.js` for temporary download anchors plus object-URL creation/revocation cleanup.
- Added `src/platform/browser/browser-clipboard.js` for `navigator.clipboard.writeText()` with explicit `execCommand('copy')` fallback only when the native clipboard API is unavailable.
- Added `src/platform/browser/browser-fullscreen.js` for standard/WebKit fullscreen capability, enter/exit state and owned change subscriptions.
- Added `src/platform/browser/browser-print.js` for browser print invocation only.
- Added `src/platform/browser/browser-file-reader.js` for text/data-URL reads and explicit `BrowserFileReadCancelledError` cancellation with code `BROWSER_FILE_READ_CANCELLED`.
- Exported all six adapters through `src/platform/index.js` without introducing a new browser global bridge.
- Added six focused unit-test files and advanced the Stage 3 hard-gate workflow/evidence node to 3.10.
- Registered the six production modules. Current inventory target is **172 production modules / 33 platform modules**.

## Responsibility boundaries

- Storage does not parse/stringify settings JSON and does not know application storage keys.
- Download does not decide export format, filename policy, Toast messaging or document state.
- Clipboard does not own UI success/failure messaging. Native clipboard rejection remains an error; fallback is used only when the native API is absent.
- Fullscreen does not toggle application CSS classes, page-fullscreen state or persisted layout settings.
- Print does not prepare export DOM or own `afterprint`/preview restoration.
- FileReader does not create documents, insert images or show Toasts.

## Error, cancellation and cleanup contracts

- Native storage, clipboard, print and FileReader errors preserve their original identity where applicable.
- FileReader abort is explicit cancellation rather than a generic read failure.
- Clipboard fallback failure is explicit and temporary textarea cleanup runs in `finally`.
- Download anchor cleanup and object-URL revocation run even if the browser click path throws.
- Fullscreen subscriptions return an idempotent disposer and remove both standard and WebKit listeners.

## Compatibility

Existing classic business modules remain unchanged in Atomic Task 3.10. Their current browser API calls are not redirected through a new global facade because unified capability-based composition belongs to Atomic Task 3.11 `createPlatform`. This preserves current user-visible behavior while avoiding a second temporary platform authority.

No Rust source, Tauri command, public native compatibility method, dependency, `package.json` or `package-lock.json` is changed by this task.

## Verification

Actual Windows results before the Print-test repair:

- Platform unit suite: **113/114**, one false-positive test failure in `browser-print.test.mjs`.
- `npm run verify:architecture`: **passed**.
- `npm test`: **42/42 passed**.
- `npm run test:browser:contract`: **10/10 passed**.
- `npm run build`: **passed**; existing large-chunk warning only.
- `npm run test:browser`: **12/12 passed**.
- `node scripts/stage-03/record-platform-evidence.mjs`: **passed**.
- `npm audit`: **0 vulnerabilities**.

The false positive was caused by `/afterprint|restorePreview|export|setTimeout|markdown-body/`, where `export` matched the normal ESM declaration `export function createBrowserPrint`. The repaired assertion now forbids only the actual business markers `afterprint`, `restorePreview`, `setTimeout`, `markdown-body` and `public/app/export`.

Required remaining verification: rerun the Platform unit suite and confirm **114/114**. Because the repair changes only the test matcher and not production code, the already-passed architecture, application, browser, build, evidence and audit results remain valid unless the rerun exposes another failure.

## Remaining risk

Atomic 3.10 is not marked PASS until the corrected Platform suite is rerun successfully. The adapters are implemented and exported but are not yet composed into one capability-driven Platform object; existing classic callers therefore still use their current browser surfaces until Atomic Task 3.11.
