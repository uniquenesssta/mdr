# Stage 3 / Atomic Task 3.10 — Browser adapters

## Result

Atomic Task 3.10 implementation is complete and awaiting controlled Windows/browser validation. Browser runtime responsibilities are split into six independent adapters; `createPlatform` composition and caller cutover remain intentionally deferred to Atomic Task 3.11.

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

Controlled validation is pending. Required verification order is: six Atomic 3.10 unit suites → architecture hard gate → Node regression → browser contract → production build → built-app browser regression → Stage 3 evidence generation → npm audit.

The machine evidence recorder now validates all prior Stage 3 nodes plus the six Browser adapters, explicit FileReader cancellation, download cleanup, fullscreen disposer cleanup and the **172 / 33** inventory counts.

## Remaining risk

The adapters are implemented and exported but are not yet composed into one capability-driven Platform object. Existing classic callers therefore still use their current browser surfaces until Atomic Task 3.11. That deferred integration is the planned next Atomic Task, not an incomplete 3.10 responsibility.
