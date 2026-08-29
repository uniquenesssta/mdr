#!/usr/bin/env bash
set -euo pipefail
{
  echo '=== CONTROLLER IMPORTS/CALLS ==='
  grep -R -n -E 'createSelectionSyncController|SelectionSyncController|syncEditorToPreview|syncPreviewToEditor|\.configure\(' tests/stage-09* tests/architecture/stage-09* 2>/dev/null || true
} > .agent/r9_12_inventory.txt
