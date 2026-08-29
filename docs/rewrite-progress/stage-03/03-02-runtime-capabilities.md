# Stage 3 / Atomic Task 3.2 — Runtime capabilities

## Result

Atomic Task 3.2 is complete. Runtime environment detection is separated from platform behavior, and immutable capability snapshots are exposed through `src/platform/index.js`.

## Implemented scope

- `src/platform/environment/platform-detection.js` is the sole production owner of the Tauri runtime sentinel and returns a frozen browser/desktop environment snapshot.
- `src/platform/environment/runtime-capabilities.js` performs guarded, non-executing browser-surface probes and returns frozen desktop/browser capability groups.
- `src/runtime/tauri.js` derives its existing `isAvailable` compatibility value from `capabilities.desktop.invoke`; the existing 33 native methods, command names, arguments, return values and errors are unchanged.
- Stage 3 verification runs the 3.2 contract before architecture, Node, browser and build regression, and records a dedicated `03-02-runtime-capabilities-evidence.json` artifact.

## Compatibility

No Rust command, DTO, persistence format, public business behavior, dependency, lock file or frozen model contract changed. Invoke, dialog, window and other concrete adapters remain owned by Atomic Task 3.3 and later tasks.

## Verification

Controlled GitHub run `31096349173` on commit `bc80daea6dce1b9d1b19ccd536073287e8f029f0` used Node `22.23.1` and npm `10.9.8` and passed:

- Stage 2 shell handoff: `5/5`.
- Atomic Task 3.1 port contract: `9/9`.
- Atomic Task 3.2 capability contract: `8/8`.
- Architecture hard gate: passed with `157` production modules and `18` platform modules.
- Existing Node regression: `36/36`.
- Chromium interaction contract: `10/10`.
- Vite production build: passed, `2197` modules transformed.
- Built-application Chromium regression: `12/12`.
- Stage 3 evidence generation and upload: passed.

Evidence artifact: `stage-03-platform-foundation-31096349173-1`, artifact `8965610814`, zip SHA-256 `d68dd2137fe182ce1f67a06fed0f5731cddc8b78fb18fd96f69dd9187586c54e`.

Stage 1 run `31096349529` and Stage 2 run `31096349302` also passed on the same commit. Dependency installation continued to report the existing `1 low / 1 high` audit advisories; no dependency changes were made in this task.

## Remaining risk

Real Windows desktop execution was not exercised by the Ubuntu workflow. The production native behavior remains unchanged; this task centralizes only the environment decision and capability snapshot. Windows-native runtime coverage remains required when later adapter tasks modify invoke, dialog, window, drag/drop or filesystem behavior.
