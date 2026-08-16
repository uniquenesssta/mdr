/**
 * Responsibility: Public Stage 9 synchronization contract. R9-04, R9-05, R9-06 and R9-07 remain frozen while R9-08 adds the canonical SelectionFeedbackGuard; later selection policy remains unmigrated.
 * Imports: Public synchronization modules only.
 * Exports: Scroll owners/mappers/geometry, Selection Readers and the R9-08 Feedback Guard classes/factories.
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
