/**
 * Responsibility: Resolve the preview presentation mode from the persisted preview setting and document size signals.
 * Imports: Frozen preview behavior thresholds only.
 * Exports: normalizePreviewModeSetting(), resolvePreviewMode().
 * State/side effects: None; inputs are read-only and no DOM, storage, Worker, timers or runtime globals are accessed.
 * Lifecycle: Pure functions; no start/destroy contract.
 */
import { PREVIEW_BEHAVIOR_THRESHOLDS } from './preview-thresholds.js';

const PREVIEW_MODE_SETTINGS = new Set(['auto', 'full', 'virtual', 'chapter']);

export function normalizePreviewModeSetting(value) {
  const mode = String(value || 'auto');
  return PREVIEW_MODE_SETTINGS.has(mode) ? mode : 'auto';
}

function normalizeCount(value) {
  const count = Number(value);
  if (Number.isNaN(count) || count <= 0) return 0;
  return count;
}

export function resolvePreviewMode(settings = {}, characterCount = 0, blockCount = 0) {
  const requested = normalizePreviewModeSetting(settings?.previewPerformanceMode);
  if (requested !== 'auto') return requested;

  const characters = normalizeCount(characterCount);
  const blocks = normalizeCount(blockCount);
  const thresholds = PREVIEW_BEHAVIOR_THRESHOLDS.mode;

  if (characters >= thresholds.chapterChars || blocks >= thresholds.chapterBlocks) return 'chapter';
  if (characters >= thresholds.virtualChars || blocks >= thresholds.virtualBlocks) return 'virtual';
  return 'full';
}
