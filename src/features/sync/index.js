/**
 * Responsibility: Public Stage 9 synchronization contract. R9-01 exposes only the frozen scroll controller; source-ownership extraction, geometry mapping and selection synchronization remain later Atomic Tasks.
 * Imports: Public synchronization modules only.
 * Exports: R9-01 scroll controller class and factory.
 * State/side effects: None; import-only facade.
 * Lifecycle: None.
 */

export {
  ScrollSyncController,
  createScrollSyncController
} from './scroll/scroll-sync-controller.js';
