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
  rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' \
    'scroll-sync\.js|syncFromEditorScroll|syncFromPreviewScroll|syncEditorSelectionToPreview|syncPreviewSelectionToEditor|annotatePreviewSourceLines|preparePreviewEditorMetrics|getPreviewAnchorMetrics|getPreviewAnchorCount|scrollPreviewToLine|markdownEditorScrollSync|markdownEditorSelectionController|markdownEditorSelectionMapping|editor\.value|buildNormalizedTextMap|buildNormalizedSourceMap|findMarkdownRangeForPreviewSelection|line arrays|canvas' \
    src public tests index.html package.json || true
  echo
  echo '=== SYNC PRODUCTION FILES ==='
  find src/features/sync src/sync public/app -maxdepth 3 -type f | sort
} > .agent/r9_12_inventory.log
