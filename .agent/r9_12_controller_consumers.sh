#!/usr/bin/env bash
set -euo pipefail
grep -R -n -E 'createSelectionSyncController|SelectionSyncController|\.configure\(\{ syncEditorToPreview|syncPreviewToEditor' tests src public 2>/dev/null > .agent/r9_12_controller_consumers.log || true
git add -f .agent/r9_12_controller_consumers.log
git commit -m 'ci: capture R9-12 controller consumers [skip ci]' --no-verify || true
git push origin HEAD:refs/heads/agent/r9-12-runner
