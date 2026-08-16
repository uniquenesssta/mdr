/**
 * Responsibility: Public Stage 9 synchronization contract. R9-04 EditorScrollMapper, R9-05 PreviewScrollMapper and R9-06 ScrollGeometrySession remain frozen while R9-07 adds EditorSelectionReader and PreviewSelectionReader; later selection policy remains unmigrated.
 * Imports: Public synchronization modules only.
 * Exports: Scroll controller, source ownership, editor/preview mappers, geometry session and R9-07 selection reader classes/factories.
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
