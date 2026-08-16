/**
 * Responsibility: Public Stage 9 synchronization contract. R9-03 exposes the sole scroll source owner and the cancellable Scroll Controller orchestration surface; mapper, geometry-session and selection responsibilities remain later Atomic Tasks.
 * Imports: Public synchronization modules only.
 * Exports: Scroll controller and source ownership classes/factories.
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
