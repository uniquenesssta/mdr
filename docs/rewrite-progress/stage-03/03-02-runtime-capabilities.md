# Stage 3 / Atomic Task 3.2 — Runtime capabilities

## Result

Atomic Task 3.2 separates runtime environment detection from platform behavior and exposes immutable capability snapshots through `src/platform/index.js`.

## Implemented scope

- `src/platform/environment/platform-detection.js` is the sole production owner of the Tauri runtime sentinel and returns a frozen browser/desktop environment snapshot.
- `src/platform/environment/runtime-capabilities.js` performs guarded, non-executing browser-surface probes and returns frozen desktop/browser capability groups.
- `src/runtime/tauri.js` derives its existing `isAvailable` compatibility value from `capabilities.desktop.invoke`; the existing 33 native methods, command names, arguments, return values and errors are unchanged.
- Stage 3 verification now runs the 3.2 contract before architecture, Node, browser and build regression, and records a dedicated `03-02-runtime-capabilities-evidence.json` artifact.

## Compatibility

No Rust command, DTO, persistence format, public business behavior, dependency, lock file or frozen model contract changed. Invoke, dialog, window and other concrete adapters remain owned by Atomic Task 3.3 and later tasks.

## Verification

- Isolated Atomic Task 3.2 contract: `8/8` passed.
- JavaScript syntax checks for the two environment modules, updated runtime bridge, tests and evidence recorder: passed.
- Full repository architecture, Node, browser and build regression: delegated to the branch Stage 3 workflow because the current execution environment has no local repository checkout or dependency tree; no full-pass claim is made until that run completes.

## Remaining risk

Real Windows desktop execution is not exercised by this task-local verification. The production native behavior remains unchanged; this task only centralizes the boolean environment decision and exposes its immutable snapshot.
