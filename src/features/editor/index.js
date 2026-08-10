/**
 * Responsibility: Expose the Stage 5 Editor feature's neutral infrastructure, application controller/history contracts and scoped compatibility contracts through one public feature boundary.
 * Imports: May import only Editor feature application, infrastructure and compatibility modules; must not import raw CodeMirror packages or other feature internals.
 * Exports: createCodeMirrorAdapter, CODEMIRROR_EXTENSION_SLOT_NAMES, createCodeMirrorExtensionRegistry, createEditorController, createEditorHistoryAdapter, mountClassicEditorControllerPort and mountClassicEditorHistoryPort.
 * State/side effects: None; import-only public facade.
 * Lifecycle: Pure module; exported factories/ports own their explicit instance lifecycles.
 */
export { createEditorController } from './application/editor-controller.js';
export { createEditorHistoryAdapter } from './application/editor-history-adapter.js';
export { mountClassicEditorControllerPort } from './compatibility/classic-editor-controller-port.js';
export { mountClassicEditorHistoryPort } from './compatibility/classic-editor-history-port.js';
export { createCodeMirrorAdapter } from './infrastructure/codemirror-editor-adapter.js';
export {
  CODEMIRROR_EXTENSION_SLOT_NAMES,
  createCodeMirrorExtensionRegistry
} from './infrastructure/codemirror-extension-registry.js';
