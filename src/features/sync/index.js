/**
 * Responsibility: Public Stage 9 synchronization contract. R9-04 exposes the editor geometry mapper alongside the sole scroll source owner and cancellable Scroll Controller; preview mapper, geometry-session and selection responsibilities remain later Atomic Tasks.
 * Imports: Public synchronization modules only.
 * Exports: Scroll controller, source ownership and editor scroll mapper classes/factories.
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
