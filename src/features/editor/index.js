/**
 * Responsibility: Expose the Stage 5 Editor feature through one public boundary covering neutral infrastructure, application services, commands, Views and only cross-stage scoped compatibility bridges.
 * Imports: Public facade only; consumers do not import Editor internals directly.
 * Exports: Atomic 5.1–5.13 Editor factories plus the scoped controller/UI bridges still required by later-stage classic callers.
 * State/side effects: None; import-only public facade.
 * Lifecycle: Pure module; exported factories own explicit instance lifecycles where applicable.
 */
export { createEditorController } from './application/editor-controller.js';
export { createEditorHistoryAdapter } from './application/editor-history-adapter.js';
export { createEditorCommandService } from './application/editor-command-service.js';
export { createEditorSelectionService } from './application/editor-selection-service.js';
export { createEditorFocusService } from './application/editor-focus-service.js';
export { mountClassicEditorControllerPort } from './compatibility/classic-editor-controller-port.js';
export { mountClassicEditorUiCommandPort } from './compatibility/classic-editor-ui-command-port.js';
export { createEditorPaneView } from './ui/editor-pane-view.js';
export { createEditorToolbarView } from './ui/editor-toolbar-view.js';
export { createInlineColorMenuView } from './ui/inline-color-menu-view.js';
export { createFindReplaceDialogView } from './ui/find-replace-dialog-view.js';
export { createLinkDialogView } from './ui/link-dialog-view.js';
export { createImageDialogView } from './ui/image-dialog-view.js';
export { createTableDialogView } from './ui/table-dialog-view.js';
export { createMathDialogView } from './ui/math-dialog-view.js';
export { createMermaidDialogView } from './ui/mermaid-dialog-view.js';
export { createCodeMirrorAdapter } from './infrastructure/codemirror-editor-adapter.js';
export {
  CODEMIRROR_EXTENSION_SLOT_NAMES,
  createCodeMirrorExtensionRegistry
} from './infrastructure/codemirror-extension-registry.js';
