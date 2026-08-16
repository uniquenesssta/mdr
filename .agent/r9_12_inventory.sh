#!/usr/bin/env bash
set -euo pipefail
{
  echo '=== SYNC GLOBAL CONSUMERS ==='
  grep -R -n -E 'markdownEditorScrollSync|markdownEditorScrollController|markdownEditorSelectionController|markdownEditorSelectionMapping' src public tests 2>/dev/null || true
  echo
  echo '=== CLASSIC SCROLL FUNCTIONS ==='
  grep -R -n -E 'preparePreviewEditorMetrics|invalidatePreviewAnchorMetrics|invalidatePreviewAnchorStructure|annotatePreviewSourceLines|refreshPreviewAnchorStructure|getPreviewAnchorMetrics|getPreviewAnchorCount|scrollPreviewToLine|syncEditorSelectionToPreview|syncPreviewSelectionToEditor' src public tests 2>/dev/null || true
  echo
  echo '=== MAIN DECLARATIONS ==='
  grep -n -E 'let previewScrollMapper|let previewController|let previewCommandHandler|let unregisterPreviewEditorCommands|destroyDocumentFeatures' src/main.js || true
} > .agent/r9_12_inventory.log
