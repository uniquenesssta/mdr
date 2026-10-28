import { createMenuContentView } from '../features/menu/index.js';
import { createEditorContentView, createEditorToolbarContentView } from '../features/editor/index.js';
import { createSidebarContentView } from '../features/sidebar/index.js';
import { createPreviewContentView } from '../features/preview/index.js';
import { createStatusContentView } from '../features/persistence/index.js';
import { createDocumentContentView } from '../features/documents/index.js';
import { createImportContentView } from '../features/import/index.js';
import { createApplicationLifetime } from './application-lifetime.js';

/** Compose feature-owned static Views; each existing controller owns its behavior. */
export function createWorkspaceContent(slots) {
  const lifetime = createApplicationLifetime();
  try {
    for (const factory of [createMenuContentView, createEditorToolbarContentView, createEditorContentView, createSidebarContentView,
      createPreviewContentView, createStatusContentView, createDocumentContentView, createImportContentView]) {
      const view = factory(slots);
      lifetime.own(() => view.destroy());
    }
    const count = slots.preview.querySelector('#word-count');
    const format = slots.status.querySelector('.statusbar-format');
    if (count && format) {
      slots.status.insertBefore(count, format);
      // The count now lives outside its original preview header. Release that
      // transferred DOM ownership before destroying the static feature roots.
      lifetime.own(() => count.remove());
    }
    return Object.freeze({ destroy: () => lifetime.destroy() });
  } catch (error) {
    try { lifetime.destroy(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Workspace content construction failed.'); }
    throw error;
  }
}
