/**
 * Responsibility: Public Stage 9 synchronization contract. R9-06 adds ScrollGeometrySession beside the Scroll Controller, sole source owner, R9-04 EditorScrollMapper and R9-05 PreviewScrollMapper; selection responsibilities remain later Atomic Tasks.
 * Imports: Public synchronization modules only.
 * Exports: Scroll controller, source ownership, editor/preview mappers and geometry session classes/factories.
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
