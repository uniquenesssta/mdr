/**
 * Responsibility: Own the immutable Stage 7 preview behavior thresholds frozen from the Stage 6 baseline.
 * Imports: None.
 * Exports: PREVIEW_BEHAVIOR_THRESHOLDS only.
 * State/side effects: None; the exported configuration is recursively frozen at module evaluation.
 * Lifecycle: Pure configuration module; no start/destroy contract.
 */

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

export const PREVIEW_BEHAVIOR_THRESHOLDS = deepFreeze({
  mode: {
    workerChars: 100000,
    virtualChars: 400000,
    chapterChars: 1000000,
    virtualBlocks: 1400,
    chapterBlocks: 12000,
    badgeChars: 100000
  },
  scheduling: {
    input: {
      defaultMs: 18,
      mediumChars: 40000,
      mediumMs: 70,
      workerMs: 120,
      virtualMs: 420
    },
    focusMs: 120,
    layout: {
      maxAttempts: 18,
      stableFrames: 2,
      retryMs: 34
    },
    postprocess: {
      deferChars: 80000,
      idleTimeoutMs: 260,
      fallbackMs: 32
    },
    prewarmTimeoutMs: 700,
    enhancement: {
      idleTimeoutMs: 180,
      fallbackMs: 16,
      minimumTimeRemainingMs: 3
    }
  },
  virtualWindow: {
    overscanPx: 1000,
    minimumBlocks: 24,
    maximumBlocks: 180,
    prewarmBlocks: 96
  },
  chapter: {
    minimumBlocks: 24,
    priorityBlocks: 96,
    priorityChars: 120000
  }
});
