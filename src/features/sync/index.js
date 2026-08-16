/**
 * Responsibility: Public Stage 9 synchronization contract. R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07 and R9-08 owners remain frozen while R9-09 adds the canonical SelectionHighlightSession; R9-10+ selection policy remains unmigrated.
 * Imports: Public synchronization modules only.
 * Exports: Scroll owners/mappers/geometry, Selection Readers, Feedback Guard and the R9-09 Highlight Session classes/factories.
 * State/side effects: None; import-only facade.
 * Lifecycle: None.
 */

export {
  ScrollSyncController,
  createScrollSyncController
} from './scroll/scroll-sync-controller.js';
export {
  ScrollSourceOwnership,
  createScrollSourceOwnership
} from './scroll/scroll-source-ownership.js';
export {
  EditorScrollMapper,
  createEditorScrollMapper
} from './scroll/editor-scroll-mapper.js';
export {
  PreviewScrollMapper,
  createPreviewScrollMapper
} from './scroll/preview-scroll-mapper.js';
export {
  ScrollGeometrySession,
  createScrollGeometrySession
} from './scroll/scroll-geometry-session.js';
export {
  EditorSelectionReader,
  createEditorSelectionReader
} from './selection/editor-selection-reader.js';
export {
  PreviewSelectionReader,
  createPreviewSelectionReader
} from './selection/preview-selection-reader.js';
export {
  SelectionFeedbackGuard,
  createSelectionFeedbackGuard
} from './selection/selection-feedback-guard.js';
export {
  SelectionHighlightSession,
  createSelectionHighlightSession
} from './selection/selection-highlight-session.js';
