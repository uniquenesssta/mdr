#!/usr/bin/env bash
set -euo pipefail
{
  echo '=== STATUS ==='
  git status --short --branch
  echo
  echo '=== BASE HEAD ==='
  git rev-parse HEAD
  echo
  echo '=== SCROLL-SYNC REFERENCES ==='
  grep -R -n -E \
    'scroll-sync\.js|syncFromEditorScroll|syncFromPreviewScroll|syncEditorSelectionToPreview|syncPreviewSelectionToEditor|annotatePreviewSourceLines|preparePreviewEditorMetrics|getPreviewAnchorMetrics|getPreviewAnchorCount|scrollPreviewToLine|markdownEditorScrollSync|markdownEditorSelectionController|markdownEditorSelectionMapping|editor\.value|buildNormalizedTextMap|buildNormalizedSourceMap|findMarkdownRangeForPreviewSelection|createElement\(.canvas.|measureText|lineHeights|lineOffsets' \
    src public tests index.html package.json 2>/dev/null || true
  echo
  echo '=== CLASSIC SYNC CALLERS ==='
  grep -R -n -E \
    'preparePreviewEditorMetrics|invalidatePreviewAnchorMetrics|invalidatePreviewAnchorStructure|annotatePreviewSourceLines|refreshPreviewAnchorStructure|getPreviewAnchorMetrics|getPreviewAnchorCount|scrollPreviewToLine|scheduleSourceScrollSync|syncFromEditorScroll|syncFromPreviewScroll|syncEditorSelectionToPreview|syncPreviewSelectionToEditor' \
    public/app src tests 2>/dev/null || true
  echo
  echo '=== SYNC PRODUCTION FILES ==='
  find src/features/sync src/sync public/app -maxdepth 3 -type f | sort
} > .agent/r9_12_inventory.log
