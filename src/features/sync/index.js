/**
 * Responsibility: Public Stage 9 synchronization contract. R9-02 exposes the frozen scroll controller plus the sole source-ownership state owner; geometry and selection responsibilities remain later Atomic Tasks.
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
