/**
 * Responsibility: Public Stage 9 synchronization contract. R9-05 exposes PreviewScrollMapper alongside the R9-04 EditorScrollMapper, sole scroll source owner and cancellable Scroll Controller; Geometry Session and selection responsibilities remain later Atomic Tasks.
 * Imports: Public synchronization modules only.
 * Exports: Scroll controller, source ownership, editor mapper and preview mapper classes/factories.
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
