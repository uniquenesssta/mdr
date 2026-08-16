import './styles/index.css';
import { createPlatform, mountClassicPlatformPort } from './platform/index.js';
import { configureLinkPreviewPlatform } from './runtime/link-preview.js';
import { configurePerformancePlatform, configurePerformanceRuntimeStats } from './runtime/performance.js';
import { createVirtualEditor } from './editor/virtual-editor.js';
import {
  createEditorCommandService,
  createEditorController,
  createEditorFocusService,
  createEditorHistoryAdapter,
  createEditorSelectionService,
  createEditorPaneView,
  createEditorToolbarView,
  createFindReplaceDialogView,
  createImageDialogView,
  createInlineColorMenuView,
  createLinkDialogView,
  createMathDialogView,
  createMermaidDialogView,
  createTableDialogView,
  mountClassicEditorControllerPort,
  mountClassicEditorUiCommandPort
} from './features/editor/index.js';
import {
  createCompactShellController,
  createCompactSplitController,
  createLayoutState,
  createPageFullscreenController,
  createSidebarLayoutController,
  createSidebarResizeController,
  createSplitPaneController,
  createSplitResizeController,
  createSystemFullscreenController,
  createToolbarBoundaryController,
  mountClassicLayoutStatePort,
  mountClassicSplitControllerPort
} from './features/layout/index.js';
import {
  createDocumentModel,
  selectionMappingApi
} from './model-kernel/index.js';
import { createNativeDocumentStore } from './storage/native-document-store.js';
import { createTaskScheduler } from './shared/scheduling/task-scheduler.js';
import { mountClassicTaskSchedulerPort } from './shared/scheduling/classic-task-scheduler-port.js';
import { loadDomToImage } from './shared/vendor/capability-loader.js';
import { createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController } from './features/sync/index.js';
import { createEditorSelectionReader, createPreviewSelectionReader, createSelectionFeedbackGuard, createSelectionHighlightSession, createSelectionRetryScheduler, createSelectionSyncController } from './features/sync/index.js';
import { installMarkdownEditorE2EBridge } from './runtime/e2e-bridge.js';
import {
  createFolderTreeController,
  createFolderTreeState,
  createFolderTreeView,
  createOutlineCollapseStore,
  createOutlineController,
  createOutlineView,
  createSidebarState,
  createSidebarTabController,
  mountClassicFolderTreeControllerPort,
  mountClassicOutlineControllerPort,
  mountClassicSidebarControllerPort
} from './features/sidebar/index.js';
import { configureHybridImageSourcePlatform, configureHybridSyncCapabilities } from './features/hybrid-editor/index.js';
import {
  createDocumentContextMenuView,
  createDocumentListView,
  createDocumentSessionController,
  createDocumentTitleView,
  createRecentFilesReadSource,
  createRecentFilesRepository,
  createSessionDocumentRepository,
  mountClassicDocumentControllerPort,
  mountClassicDocumentUiCommandPort,
  mountClassicRecentFilesPort
} from './features/documents/index.js';
import { createRecentFilesMenuController } from './features/menu/index.js';
import {
  createCloseSavePort,
  createWindowCloseController,
  createWindowController,
  createWindowControlsView,
  createWindowDragRegion,
  createWindowState,
  mountClassicCloseSavePort
} from './features/window/index.js';
import {
  createPreviewCancellation,
  createMarkdownPresentationApi,
  createPreviewController,
  createPreviewEnhancementCoordinator,
  createPreviewFocusController,
  createPreviewLayoutStability,
  createPreviewRenderCoordinator,
  createPreviewRenderEngine,
  createPreviewRendererPort,
  createPreviewMarkdownRenderer,
  createPreviewRecoveryView,
  createPreviewScheduler,
  createPreviewState,
  createPreviewWorkerClient,
  createVirtualPreviewController,
  PREVIEW_BEHAVIOR_THRESHOLDS,
  mountPreviewCommandHandler,
  mountClassicPreviewPresentationPort,
  mountClassicPreviewEnhancementCoordinatorPort,
  mountClassicPreviewFocusControllerPort,
  mountClassicPreviewLayoutStabilityPort,
  mountClassicPreviewModeResolverPort,
  mountClassicPreviewRenderCoordinatorPort,
  mountClassicPreviewRendererPort,
  mountClassicPreviewRecoveryViewPort,
  mountClassicPreviewSchedulerPort,
  mountClassicPreviewStatePort,
  mountClassicPreviewThresholdsPort
} from './features/preview/index.js';

const platform = createPlatform({
  runtime: window,
  now: () => performance.now(),
  record: (operation, entry) => window.markdownEditorPerf?.record?.(operation, entry)
});
const compatibilityPlatformHost = document.getElementById('compatibility-business-ports');
const backgroundTaskScheduler = createTaskScheduler({ runtime: window });
const backgroundTaskSchedulerPort = mountClassicTaskSchedulerPort(compatibilityPlatformHost, backgroundTaskScheduler);
const markdownPresentation = createMarkdownPresentationApi();
const previewPresentationPort = mountClassicPreviewPresentationPort(compatibilityPlatformHost, markdownPresentation, { loadDomToImage });
const previewState = createPreviewState();
const previewStatePort = mountClassicPreviewStatePort(compatibilityPlatformHost, previewState);
const previewModeResolverPort = mountClassicPreviewModeResolverPort(compatibilityPlatformHost);
const previewThresholdsPort = mountClassicPreviewThresholdsPort(compatibilityPlatformHost);
const previewCancellation = createPreviewCancellation();
const previewScheduler = createPreviewScheduler({
  cancellation: previewCancellation,
  getBackgroundScheduler: () => backgroundTaskScheduler
});
const previewSchedulerPort = mountClassicPreviewSchedulerPort(compatibilityPlatformHost, previewScheduler);
const previewEnhancementCoordinator = createPreviewEnhancementCoordinator({
  scheduler: previewScheduler,
  thresholds: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.enhancement
});
const previewEnhancementCoordinatorPort = mountClassicPreviewEnhancementCoordinatorPort(
  compatibilityPlatformHost,
  previewEnhancementCoordinator
);
const previewFocusController = createPreviewFocusController({
  scheduler: previewScheduler,
  focusDelay: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.focusMs
});
const previewFocusControllerPort = mountClassicPreviewFocusControllerPort(compatibilityPlatformHost, previewFocusController);
const previewRenderCoordinator = createPreviewRenderCoordinator();
const previewRenderCoordinatorPort = mountClassicPreviewRenderCoordinatorPort(compatibilityPlatformHost, previewRenderCoordinator);
const previewLayoutRoot = document.getElementById('preview');
const previewLayoutPane = document.querySelector('.preview-pane');
const previewLayoutFrameHost = document.defaultView;
if (!previewLayoutRoot) throw new Error('Preview host is missing.');
if (!previewLayoutPane) throw new Error('Preview pane is missing.');
const previewRecoveryView = createPreviewRecoveryView({
  root: previewLayoutRoot,
  documentRef: document
});
const previewRecoveryViewPort = mountClassicPreviewRecoveryViewPort(
  compatibilityPlatformHost,
  previewRecoveryView
);
const previewLayoutStability = createPreviewLayoutStability({
  root: previewLayoutRoot,
  pane: previewLayoutPane,
  scheduler: previewScheduler,
  thresholds: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.layout,
  createResizeObserver: typeof previewLayoutFrameHost?.ResizeObserver === 'function'
    ? callback => new previewLayoutFrameHost.ResizeObserver(callback)
    : null,
  now: () => previewLayoutFrameHost?.performance?.now?.() ?? performance.now(),
  record(operation, entry) { window.markdownEditorPerf?.record?.(operation, entry); },
  reportError(message, error) { console.warn(message, error); }
});
const previewLayoutStabilityPort = mountClassicPreviewLayoutStabilityPort(compatibilityPlatformHost, previewLayoutStability);
const layoutState = createLayoutState();
const layoutStatePort = mountClassicLayoutStatePort(compatibilityPlatformHost, layoutState);
let compactShellController = null;
let sidebarLayoutController = null;
let sidebarResizeController = null;
let splitResizeController = null;
let splitPaneController = null;
let compactSplitController = null;
let toolbarBoundaryController = null;
let pageFullscreenController = null;
let systemFullscreenController = null;
let splitControllerPort = null;
const destroyLayoutInteractionControllers = () => {
  systemFullscreenController?.destroy();
  systemFullscreenController = null;
  pageFullscreenController?.destroy();
  pageFullscreenController = null;
  toolbarBoundaryController?.destroy();
  toolbarBoundaryController = null;
  compactShellController?.destroy();
  compactShellController = null;
  sidebarLayoutController?.destroy();
  sidebarLayoutController = null;
  compactSplitController?.destroy();
  compactSplitController = null;
  splitPaneController?.destroy();
  splitPaneController = null;
  splitResizeController?.destroy();
  splitResizeController = null;
  sidebarResizeController?.destroy();
  sidebarResizeController = null;
};
const destroyLayoutStateFeature = () => {
  splitControllerPort?.destroy();
  splitControllerPort = null;
  destroyLayoutInteractionControllers();
  layoutStatePort.destroy();
  layoutState.destroy();
};
const compatibilityPlatformPort = mountClassicPlatformPort(compatibilityPlatformHost, platform);
configureLinkPreviewPlatform({ links: platform.links });
configurePerformancePlatform({
  logs: platform.logs,
  enabled: platform.capabilities.desktop.performanceLogs
});
configureHybridImageSourcePlatform({
  files: platform.files,
  enabled: platform.capabilities.desktop.fileSystem,
  getDocumentContext: () => window.markdownEditorRuntimeContext?.getCurrentDocumentContext?.() || {}
});
window.addEventListener('pagehide', () => {
  destroyLayoutStateFeature();
  previewLayoutStabilityPort.destroy();
  previewLayoutStability.destroy();
  previewRecoveryViewPort.destroy();
  previewRecoveryView.destroy();
  previewFocusControllerPort.destroy();
  previewFocusController.destroy();
  previewEnhancementCoordinatorPort.destroy();
  previewEnhancementCoordinator.destroy();
  previewRenderCoordinatorPort.destroy();
  previewRenderCoordinator.destroy();
  previewSchedulerPort.destroy();
  previewScheduler.destroy();
  previewCancellation.destroy();
  previewStatePort.destroy();
  previewState.destroy();
  previewModeResolverPort.destroy();
  previewThresholdsPort.destroy();
  previewPresentationPort.destroy();
  backgroundTaskSchedulerPort.destroy();
  backgroundTaskScheduler.destroy();
  compatibilityPlatformPort.destroy();
  void platform.destroy().catch(error => console.warn('Platform cleanup failed:', error));
}, { once: true });

if (typeof document.startViewTransition === 'function') {
  document.documentElement.classList.add('view-transitions-supported');
}

const APP_MODULES = [
  '/app/core.js',
  '/app/bootstrap.js',
  '/app/export.js',
  '/app/editor-tools.js',
  '/app/web-clipper.js',
  '/app/events.js'
];

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

function requireElement(selector, label) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`${label} is missing.`);
  return element;
}

async function loadAppModules() {
  const editorHost = document.getElementById('editor');
  if (!editorHost) throw new Error('Editor host is missing');
  const previewHost = document.getElementById('preview');
  if (!previewHost) throw new Error('Preview host is missing');
  const scrollController = createScrollSyncController(editorHost, previewHost, {
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: frameId => window.cancelAnimationFrame(frameId)
  });
  const virtualEditor = createVirtualEditor(editorHost, { scrollSync: scrollController.getPublicApi() });
  const editorSelectionReader = createEditorSelectionReader({ editorApi: virtualEditor });
  const previewSelectionDocument = previewHost.ownerDocument;
  const previewSelectionView = previewSelectionDocument?.defaultView;
  const previewSelectionReader = createPreviewSelectionReader({
    previewElement: previewHost,
    documentRef: previewSelectionDocument,
    getSelection: () => previewSelectionView?.getSelection?.() || null,
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: frameId => window.cancelAnimationFrame(frameId)
  });
  const selectionHighlightSession = createSelectionHighlightSession({
    previewElement: previewHost,
    documentRef: previewSelectionDocument,
    highlightRegistry: previewSelectionView?.CSS?.highlights ?? null,
    HighlightCtor: typeof previewSelectionView?.Highlight === 'function' ? previewSelectionView.Highlight : null,
    reportError: (message, error) => console.warn(message, error)
  });
  const selectionFeedbackGuard = createSelectionFeedbackGuard({
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: timerId => window.clearTimeout(timerId)
  });
  const selectionRetryScheduler = createSelectionRetryScheduler({
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: frameId => window.cancelAnimationFrame(frameId)
  });
  let selectionController = null;
  let selectionSyncDestroyed = false;
  const destroySelectionSync = () => {
    if (selectionSyncDestroyed) return;
    selectionSyncDestroyed = true;
    configureHybridSyncCapabilities(null);
    selectionController?.destroy();
    selectionController = null;
    selectionRetryScheduler.destroy();
    selectionHighlightSession.destroy();
    selectionFeedbackGuard.destroy();
    previewSelectionReader.destroy();
    editorSelectionReader.destroy();
  };
  window.addEventListener('pagehide', destroySelectionSync, { once: true });
  const documentModel = createDocumentModel(editorHost);
  let editorScrollMapper = null;
  try {
    editorScrollMapper = createEditorScrollMapper({ editorApi: virtualEditor, model: documentModel });
    if (compatibilityPlatformHost) compatibilityPlatformHost.markdownEditorEditorScrollMapper = editorScrollMapper;
  } catch (error) {
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }
  const destroyEditorScrollMapper = () => {
    if (compatibilityPlatformHost?.markdownEditorEditorScrollMapper === editorScrollMapper) {
      delete compatibilityPlatformHost.markdownEditorEditorScrollMapper;
    }
    editorScrollMapper?.destroy();
    editorScrollMapper = null;
  };
  let editorController;
  let editorHistoryAdapter;
  let editorCommandService;
  let editorSelectionService;
  let editorFocusService;
  let editorControllerPort;
  let editorUiCommandPort;
  try {
    editorController = createEditorController({
      model: documentModel,
      adapter: virtualEditor,
      reportError(message, error) { console.error(message, error); }
    });
    editorHistoryAdapter = createEditorHistoryAdapter({ adapter: virtualEditor });
    editorCommandService = createEditorCommandService({ adapter: virtualEditor });
    editorSelectionService = createEditorSelectionService({ adapter: virtualEditor });
    editorFocusService = createEditorFocusService({ adapter: virtualEditor });
    editorControllerPort = mountClassicEditorControllerPort(compatibilityPlatformHost, editorController);
    editorUiCommandPort = mountClassicEditorUiCommandPort(compatibilityPlatformHost);
  } catch (error) {
    editorUiCommandPort?.destroy?.();
    editorControllerPort?.destroy?.();
    editorFocusService?.destroy?.();
    editorSelectionService?.destroy?.();
    editorCommandService?.destroy?.();
    editorHistoryAdapter?.destroy?.();
    editorController?.destroy?.();
    destroyEditorScrollMapper();
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }
  window.markdownEditorDocumentModel = documentModel;
  window.markdownEditorDocumentStore = createNativeDocumentStore({
    documentStore: platform.documentStore,
    available: platform.capabilities.desktop.documentStore
  });

  const documentSessionPort = compatibilityPlatformHost?.markdownEditorDocumentSessionPort;
  if (!documentSessionPort) throw new Error('Document session compatibility port is unavailable.');
  const menuCommandPort = compatibilityPlatformHost?.markdownEditorMenuCommandPort;
  if (!menuCommandPort) throw new Error('Menu command compatibility port is unavailable.');
  const documentRepository = createSessionDocumentRepository({
    storage: window.localStorage,
    nativeStore: window.markdownEditorDocumentStore,
    scheduleCleanup(task) {
      if (backgroundTaskScheduler?.schedule) return backgroundTaskScheduler.schedule('document-session-cleanup-' + Date.now(), task, {
        priority: 'background',
        timeout: 1200
      });
      return setTimeout(task, 0);
    },
    reportError(message, error) {
      console.warn(message, error);
    }
  });
  const documentController = createDocumentSessionController({
    session: documentSessionPort,
    model: window.markdownEditorDocumentModel,
    repository: documentRepository
  });
  const documentControllerPort = mountClassicDocumentControllerPort(compatibilityPlatformHost, documentController);
  const recentFilesRepository = createRecentFilesRepository({
    storage: window.localStorage,
    reportError(message, error) {
      console.warn(message, error);
    }
  });
  recentFilesRepository.load();
  const recentFilesSource = createRecentFilesReadSource(recentFilesRepository);
  let recentFilesPort;
  let recentFilesMenuController;
  let documentUiCommandPort;
  try {
    recentFilesPort = mountClassicRecentFilesPort(compatibilityPlatformHost, recentFilesRepository);
    documentUiCommandPort = mountClassicDocumentUiCommandPort(compatibilityPlatformHost);
    recentFilesMenuController = createRecentFilesMenuController({
      owner: requireElement('#recent-files-menu-item', 'Recent Files submenu owner'),
      list: requireElement('#recent-files-menu', 'Recent Files submenu list'),
      source: recentFilesSource,
      commands: menuCommandPort,
      available: platform.capabilities.desktop.fileSystem,
      reportError(message, error) { console.error(message, error); }
    });
  } catch (error) {
    recentFilesMenuController?.destroy?.();
    documentUiCommandPort?.destroy?.();
    recentFilesPort?.destroy?.();
    recentFilesRepository.destroy();
    documentControllerPort.destroy();
    documentController.destroy();
    documentRepository.destroy();
    editorUiCommandPort.destroy();
    editorControllerPort.destroy();
    editorFocusService.destroy();
    editorSelectionService.destroy();
    editorCommandService.destroy();
    editorHistoryAdapter.destroy();
    editorController.destroy();
    destroyEditorScrollMapper();
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }

  const featureViews = [];
  let unregisterEditorViewCommands = null;
  let unregisterLayoutUiCommands = null;
  let sidebarState = null;
  let sidebarTabController = null;
  let sidebarControllerPort = null;
  let outlineController = null;
  let outlineControllerPort = null;
  let folderTreeController = null;
  let folderTreeControllerPort = null;
  let closeSavePort = null;
  let classicCloseSavePort = null;
  let windowController = null;
  let previewRenderer = null;
  let previewRendererPort = null;
  let previewMarkdownRenderer = null;
  let previewRenderEngine = null;
  let previewController = null;
  let previewCommandHandler = null;
  let previewScrollMapper = null;
  const destroyPreviewScrollMapper = () => {
    if (compatibilityPlatformHost?.markdownEditorPreviewScrollMapper === previewScrollMapper) {
      delete compatibilityPlatformHost.markdownEditorPreviewScrollMapper;
    }
    previewScrollMapper?.destroy();
    previewScrollMapper = null;
  };
  let unregisterPreviewEditorCommands = null;
  let documentEditorViewsDestroyed = false;
  const destroyDocumentEditorViews = () => {
    if (documentEditorViewsDestroyed) return;
    documentEditorViewsDestroyed = true;
    unregisterEditorViewCommands?.();
    unregisterEditorViewCommands = null;
    const errors = [];
    for (const view of featureViews.reverse()) {
      try { view?.destroy?.(); } catch (error) { errors.push(error); }
    }
    featureViews.length = 0;
    if (errors.length) console.error('Document/Editor View cleanup failed:', new AggregateError(errors));
  };

  let documentFeaturesDestroyed = false;
  const destroyDocumentFeatures = () => {
    if (documentFeaturesDestroyed) return;
    documentFeaturesDestroyed = true;
    destroySelectionSync();
    if (windowController) {
      const pendingWindowDestroy = windowController.destroy();
      if (pendingWindowDestroy && typeof pendingWindowDestroy.catch === 'function') {
        void pendingWindowDestroy.catch(error => console.error('Window feature cleanup failed:', error));
      }
      windowController = null;
    }
    classicCloseSavePort?.destroy();
    classicCloseSavePort = null;
    closeSavePort?.destroy();
    closeSavePort = null;
    unregisterLayoutUiCommands?.();
    unregisterLayoutUiCommands = null;
    sidebarControllerPort?.destroy();
    sidebarControllerPort = null;
    folderTreeControllerPort?.destroy();
    folderTreeControllerPort = null;
    outlineControllerPort?.destroy();
    outlineControllerPort = null;
    sidebarTabController?.destroy();
    sidebarTabController = null;
    outlineController?.destroy();
    outlineController = null;
    folderTreeController?.destroy();
    folderTreeController = null;
    sidebarState?.destroy();
    sidebarState = null;
    splitControllerPort?.destroy();
    splitControllerPort = null;
    destroyLayoutInteractionControllers();
    destroyDocumentEditorViews();
    recentFilesMenuController?.destroy();
    recentFilesMenuController = null;
    documentUiCommandPort.destroy();
    recentFilesPort.destroy();
    recentFilesRepository.destroy();
    documentControllerPort.destroy();
    documentController.destroy();
    documentRepository.destroy();
    editorUiCommandPort.destroy();
    editorControllerPort.destroy();
    editorFocusService.destroy();
    editorSelectionService.destroy();
    editorCommandService.destroy();
    editorHistoryAdapter.destroy();
    editorController.destroy();
    destroyPreviewScrollMapper();
    unregisterPreviewEditorCommands?.();
    unregisterPreviewEditorCommands = null;
    previewCommandHandler?.destroy();
    previewCommandHandler = null;
    previewController?.destroy();
    previewController = null;
    previewRenderEngine = null;
    previewMarkdownRenderer = null;
    previewRendererPort?.destroy();
    previewRendererPort = null;
    previewRenderer?.destroy();
    previewRenderer = null;
    destroyEditorScrollMapper();
    documentModel.destroy();
    virtualEditor.destroy();
  };
  window.addEventListener('pagehide', destroyDocumentFeatures, { once: true });

  const folderTreeState = createFolderTreeState();
  const folderTreeView = createFolderTreeView({
    documentRef: document,
    panel: requireElement('#sidebar-files-panel', 'Files sidebar panel'),
    list: requireElement('#folder-file-tree', 'Folder Tree list'),
    rootLabel: requireElement('#folder-file-tree-root', 'Folder Tree root label'),
    summary: requireElement('#folder-file-tree-summary', 'Folder Tree summary'),
    refreshButton: requireElement('#folder-file-tree-refresh', 'Folder Tree refresh button'),
    available: platform.capabilities.desktop.fileSystem
  });
  folderTreeController = createFolderTreeController({
    state: folderTreeState,
    view: folderTreeView,
    files: platform.files,
    available: platform.capabilities.desktop.fileSystem,
    getCurrentContext: () => ({ filePath: documentSessionPort.getActiveRecord()?.filePath || '' }),
    openFile: path => documentUiCommandPort.has('openFolderTreeFile')
      ? documentUiCommandPort.invoke('openFolderTreeFile', path)
      : false,
    now: () => performance.now(),
    record(operation, entry) { window.markdownEditorPerf?.record?.(operation, entry); },
    reportError(message, error) { console.warn(message, error); }
  });
  folderTreeController.start();
  folderTreeControllerPort = mountClassicFolderTreeControllerPort(compatibilityPlatformHost, folderTreeController);
  sidebarState = createSidebarState();
  sidebarTabController = createSidebarTabController({
    state: sidebarState,
    storage: platform.storage,
    tabs: {
      docs: requireElement('#sidebar-docs-tab', 'Documents sidebar tab'),
      files: requireElement('#sidebar-files-tab', 'Files sidebar tab'),
      outline: requireElement('#sidebar-outline-tab', 'Outline sidebar tab')
    },
    panels: {
      docs: requireElement('#sidebar-docs-panel', 'Documents sidebar panel'),
      files: requireElement('#sidebar-files-panel', 'Files sidebar panel'),
      outline: requireElement('#sidebar-outline-panel', 'Outline sidebar panel')
    },
    reportError(message, error) { console.warn(message, error); }
  });
  sidebarTabController.registerLifecycle('files', folderTreeController);
  const outlineCollapseStore = createOutlineCollapseStore({
    storage: platform.storage,
    reportError(message, error) { console.warn(message, error); }
  });
  const outlinePanel = requireElement('#sidebar-outline-panel', 'Outline sidebar panel');
  const outlineList = requireElement('#outline-list', 'Outline list');
  const outlineContextMenu = requireElement('#outline-context-menu', 'Outline context menu');
  const outlineView = createOutlineView({
    documentRef: document,
    panel: outlinePanel,
    list: outlineList,
    contextMenu: outlineContextMenu,
    contextSeparator: requireElement('#outline-context-node-separator', 'Outline context separator'),
    contextCollapseNodeButton: requireElement('#outline-context-collapse-node', 'Outline context collapse-node button'),
    isCollapsed: id => outlineCollapseStore.isCollapsed(id),
    onToggle: id => { void outlineController?.toggleNode(id); },
    onNavigate: line => { outlineController?.navigate(line); },
    onExpandAll: () => { void outlineController?.expandAll(); },
    onCollapseAll: () => { void outlineController?.collapseAll(); },
    onCollapseNode: id => { void outlineController?.collapseNode(id); },
    openContextMenu(event) {
      if (editorUiCommandPort.has('showContextMenu')) editorUiCommandPort.invoke('showContextMenu', outlineContextMenu, event);
      else event?.preventDefault?.();
    },
    closeContextMenus() {
      if (editorUiCommandPort.has('closeContextMenus')) editorUiCommandPort.invoke('closeContextMenus');
    }
  });
  outlineController = createOutlineController({
    view: outlineView,
    collapseStore: outlineCollapseStore,
    getActiveLine() {
      const selection = virtualEditor.getSelection();
      return virtualEditor.getLineNumberAtPosition(selection.start);
    },
    navigateToLine(line) {
      const targetLine = Math.max(1, Math.floor(Number(line) || 1));
      const position = virtualEditor.getLineStart(targetLine);
      virtualEditor.focus({ preventScroll: true });
      virtualEditor.setSelection(position, position);
      virtualEditor.scrollPositionIntoView(position, 'auto', 0.5);
      if (editorUiCommandPort.has('focusPreviewLineForOutline')) {
        void editorUiCommandPort.invoke('focusPreviewLineForOutline', targetLine, { behavior: 'auto', scroll: true });
      } else {
        scrollController.beginUserGesture('editor', 'outline-navigation');
        scrollController.syncNow('editor');
      }
      return true;
    },
    now: () => performance.now(),
    record(operation, entry) { window.markdownEditorPerf?.record?.(operation, entry); },
    reportError(message, error) { console.warn(message, error); }
  });
  outlineController.start();
  sidebarTabController.registerLifecycle('outline', outlineController);
  outlineControllerPort = mountClassicOutlineControllerPort(compatibilityPlatformHost, outlineController);
  sidebarControllerPort = mountClassicSidebarControllerPort(compatibilityPlatformHost, sidebarTabController);

  const t = (...args) => {
    const i18n = compatibilityPlatformHost?.markdownEditorI18nPort;
    if (i18n?.t) return i18n.t(...args);
    return String(args[0] || '');
  };

  let inlineColorView = null;
  const notify = message => {
    if (editorUiCommandPort.has('notify')) return editorUiCommandPort.invoke('notify', message);
    console.warn(message);
  };
  const currentLayoutMode = () => editorUiCommandPort.has('getLayoutMode')
    ? editorUiCommandPort.invoke('getLayoutMode')
    : 'both';
  const runMutation = (method, ...args) => {
    editorHistoryAdapter.isolate();
    const result = editorCommandService[method](...args);
    if (currentLayoutMode() !== 'hybrid') editorFocusService.focus({ preventScroll: true });
    queueMicrotask(() => inlineColorView?.updateAvailability?.());
    return result;
  };
  const executeEditorAction = (action, payload) => {
    if (action === 'close-app-menus') {
      if (editorUiCommandPort.has('closeAppMenus')) return editorUiCommandPort.invoke('closeAppMenus');
      return;
    }
    if (action === 'clear') {
      if (!window.confirm(t('confirmClear'))) return false;
      editorController.setText('');
      return true;
    }
    if (action === 'layout') return editorUiCommandPort.invoke('setLayoutMode', payload);
    if (action === 'page-fullscreen') return editorUiCommandPort.invoke('togglePageFullscreen');
    if (action === 'system-fullscreen') return editorUiCommandPort.invoke('toggleSystemFullscreen');
    if (action === 'undo') {
      const changed = editorHistoryAdapter.undo();
      if (changed) {
        editorFocusService.focus({ preventScroll: true });
        notify(t('toastUndone'));
      }
      return changed;
    }
    if (action === 'redo') {
      const changed = editorHistoryAdapter.redo();
      if (changed) {
        editorFocusService.focus({ preventScroll: true });
        notify(t('toastRedone'));
      }
      return changed;
    }
    const handlers = {
      bold: () => runMutation('bold'),
      italic: () => runMutation('italic'),
      underline: () => runMutation('underline'),
      strikethrough: () => runMutation('strikethrough'),
      subscript: () => runMutation('subscript'),
      superscript: () => runMutation('superscript'),
      heading: () => runMutation('heading', Number(payload) || 1),
      quote: () => runMutation('quote', t('quote')),
      unordered: () => runMutation('unorderedList', t('unordered')),
      ordered: () => runMutation('orderedList', t('unordered')),
      task: () => runMutation('taskList', t('unordered')),
      'inline-code': () => runMutation('inlineCode'),
      code: () => runMutation('code'),
      'set-color': () => runMutation('setColor', payload?.kind, payload?.color, {
        selection: payload?.selection,
        collapse: Boolean(payload?.collapse)
      }),
      'clear-color': () => runMutation('clearColor', payload?.kind, {
        selection: payload?.selection,
        collapse: Boolean(payload?.collapse)
      })
    };
    const handler = handlers[action];
    if (!handler) throw new Error(`Editor UI action is unavailable: ${action}.`);
    return handler();
  };

  const mountDocumentEditorViews = () => {
    const titleView = createDocumentTitleView({
      input: requireElement('#filename', 'Document title input'),
      session: documentSessionPort,
      fallbackTitle: t('filenameDefault') || '未命名文档.md',
      updateTitleDraft(value) { return documentUiCommandPort.invoke('updateTitleDraft', value); }
    });
    featureViews.push(titleView);

    const contextMenuView = createDocumentContextMenuView({
      documentMenu: requireElement('#document-context-menu', 'Document context menu'),
      sidebarMenu: requireElement('#sidebar-context-menu', 'Sidebar context menu'),
      docsPanel: requireElement('#sidebar-docs-panel', 'Documents panel'),
      commands: { invoke: (action, ...args) => documentUiCommandPort.invoke(action, ...args) }
    });
    featureViews.push(contextMenuView);

    const documentListView = createDocumentListView({
      root: requireElement('#document-list', 'Document list'),
      session: documentSessionPort,
      defaultTitle: t('filenameDefault') || '未命名文档',
      emptyText: '暂无文档',
      contextMenu: contextMenuView,
      commands: {
        open: id => documentUiCommandPort.invoke('openDocument', id),
        close: id => documentUiCommandPort.invoke('closeDocument', id)
      }
    });
    featureViews.push(documentListView);

    const tableView = createTableDialogView({
      menu: requireElement('#table-menu', 'Table menu'),
      grid: requireElement('#table-grid', 'Table grid'),
      label: requireElement('#table-size-label', 'Table size label'),
      formatLabel: (rows, columns) => t('tableSizeLabel', rows, columns) || `${rows} 行 × ${columns} 列`,
      insertTable: (rows, columns) => runMutation('insertTable', rows, columns)
    });
    featureViews.push(tableView);

    const mathView = createMathDialogView({
      insertInline: () => runMutation('insertInlineMath'),
      insertBlock: () => runMutation('insertBlockMath'),
      focus: editorFocusService
    });
    featureViews.push(mathView);

    const linkView = createLinkDialogView({
      root: requireElement('#link-modal', 'Link dialog'),
      selection: editorSelectionService,
      focus: editorFocusService,
      defaultUrl: t('promptLinkDefault') || 'https://',
      fallbackLabel: t('link') || '链接',
      emptyUrlMessage: t('promptLinkUrl'),
      notify,
      insertLink: (url, options) => runMutation('insertLink', url, options)
    });
    featureViews.push(linkView);

    const imageView = createImageDialogView({
      root: requireElement('#image-modal', 'Image dialog'),
      selection: editorSelectionService,
      fallbackAlt: t('image') || '图片',
      notify,
      messages: {
        selectFile: t('toastSelectImageFile'),
        tooLarge: t('toastImageTooLarge'),
        readFailed: t('toastImageReadFailed'),
        selectFirst: t('toastSelectImageFirst'),
        enterUrl: t('toastEnterImageUrl'),
        previewAlt: t('image')
      },
      confirmLargeFile(file) {
        const sizeMb = (Number(file?.size) / 1024 / 1024).toFixed(1);
        return window.confirm(t('imageLargeWarning', sizeMb) || `图片大小为 ${sizeMb}MB，继续插入吗？`);
      },
      insertImage: (url, options) => runMutation('insertImage', url, options)
    });
    featureViews.push(imageView);

    const mermaidView = createMermaidDialogView({
      root: requireElement('#mermaid-modal', 'Mermaid dialog'),
      notify,
      messages: {
        empty: t('toastMermaidEmpty'),
        inserted: t('toastMermaidInserted')
      },
      insertMermaid: source => runMutation('insertMermaid', source)
    });
    featureViews.push(mermaidView);

    const findView = createFindReplaceDialogView({
      root: requireElement('#find-modal', 'Find/Replace dialog'),
      selection: editorSelectionService,
      focus: editorFocusService,
      labels: {
        noMatch: t('statusNoMatch'),
        found: t('statusFoundMatch'),
        replacedAll: count => t('statusReplacedCount', count)
      },
      getSearchOptions({ setStatus }) {
        if (!editorUiCommandPort.has('getFindSearchOptions')) return {};
        return editorUiCommandPort.invoke('getFindSearchOptions', setStatus);
      },
      onMatch(match) {
        if (editorUiCommandPort.has('afterFindMatch')) editorUiCommandPort.invoke('afterFindMatch', match);
      },
      commands: {
        findNext: (...args) => editorCommandService.findNext(...args),
        replaceOne: (...args) => editorCommandService.replaceOne(...args),
        replaceAll: (...args) => editorCommandService.replaceAll(...args)
      }
    });
    featureViews.push(findView);

    const toolbarRoot = requireElement('[data-ui-slot="toolbar"]', 'Editor toolbar');
    inlineColorView = createInlineColorMenuView({
      root: toolbarRoot,
      selection: editorSelectionService,
      commands: { execute: executeEditorAction },
      notify,
      collapseSelection: () => currentLayoutMode() === 'hybrid'
    });
    featureViews.push(inlineColorView);

    const toolbarView = createEditorToolbarView({
      root: toolbarRoot,
      commandRoots: [document.querySelector('.menu-bar')],
      commands: { execute: executeEditorAction },
      dialogs: { link: linkView, image: imageView, find: findView, mermaid: mermaidView, math: mathView },
      tableView,
      getLayoutMode: currentLayoutMode,
      formatLayoutLabel(mode) {
        const keys = { both: 'view', hybrid: 'viewHybrid', edit: 'viewEdit', preview: 'viewPreview' };
        return t(keys[mode] || 'view');
      }
    });
    featureViews.push(toolbarView);

    const editorPaneView = createEditorPaneView({
      root: requireElement('.editor-pane', 'Editor pane'),
      editorElement: editorHost,
      collapse: pane => splitPaneController.togglePane(pane),
      onSelectionChange() {
        inlineColorView.updateAvailability();
        if (editorUiCommandPort.has('selectionChanged')) editorUiCommandPort.invoke('selectionChanged');
      }
    });
    featureViews.push(editorPaneView);

    unregisterEditorViewCommands = editorUiCommandPort.register({
      executeEditorAction,
      openLink: () => linkView.open(),
      openImage: () => imageView.open(),
      openFind: replace => findView.open(Boolean(replace)),
      openMermaid: () => mermaidView.open(),
      insertTable: (rows, columns) => tableView.insert(rows, columns),
      insertInlineMath: () => mathView.insertInline(),
      insertBlockMath: () => mathView.insertBlock(),
      refreshToolbarLayoutLabel: mode => toolbarView.refreshLayoutLabel(mode)
    });
  };

  const previewVirtualGeometry = Object.freeze({
    get active() { return Boolean(previewCommandHandler?.port?.virtual?.active); },
    getMountedAnchors: () => previewCommandHandler?.port?.virtual?.getMountedAnchors?.() || [],
    getMetrics: () => previewCommandHandler?.port?.virtual?.getMetrics?.() || [],
    getContentYForLine: line => previewCommandHandler?.port?.virtual?.getContentYForLine?.(line) ?? null,
    getLineForContentY: y => previewCommandHandler?.port?.virtual?.getLineForContentY?.(y) ?? null,
    containsLineRange: (from, to) => previewCommandHandler?.port?.virtual?.containsLineRange?.(from, to) ?? true,
    hasLineRangeMounted: (from, to) => previewCommandHandler?.port?.virtual?.hasLineRangeMounted?.(from, to) ?? true,
    ensureLineRangeVisible: (from, to) => previewCommandHandler?.port?.virtual?.ensureLineRangeVisible?.(from, to) ?? null,
    ensureLineVisible: line => previewCommandHandler?.port?.virtual?.ensureLineVisible?.(line) ?? null
  });
  const previewView = previewHost.ownerDocument?.defaultView;
  const PreviewResizeObserver = previewView?.ResizeObserver;
  previewScrollMapper = createPreviewScrollMapper({
    previewElement: previewHost,
    virtualApi: previewVirtualGeometry,
    createResizeObserver: typeof PreviewResizeObserver === 'function'
      ? callback => new PreviewResizeObserver(callback)
      : null,
    setTimer: previewView.setTimeout.bind(previewView),
    clearTimer: previewView.clearTimeout.bind(previewView),
    onGeometryChanged: () => scrollController.notifyGeometryChanged('preview')
  });
  selectionController = createSelectionSyncController(editorHost, previewHost, {
    editorApi: virtualEditor,
    documentModel,
    editorMapper: editorScrollMapper,
    getPreviewMapper: () => previewScrollMapper,
    getPreviewVirtual: () => previewVirtualGeometry,
    focusPreviewLine: (line, options) => previewController?.focusLine?.(line, options) || false,
    editorSelectionReader,
    previewSelectionReader,
    feedbackGuard: selectionFeedbackGuard,
    highlightSession: selectionHighlightSession,
    retryScheduler: selectionRetryScheduler,
    selectionMapping: selectionMappingApi,
    scrollController,
    documentRef: document,
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
    now: () => performance.now(),
    isHybridLayout: () => layoutState.snapshot.mode === 'hybrid',
    updateActiveLine: line => outlineController?.updateActiveLine?.(line),
    record: (operation, entry) => window.markdownEditorPerf?.record?.(operation, entry),
    diagnostic: (operation, entry) => window.markdownEditorPerf?.diagnostic?.(operation, entry)
  });

  try {
    previewRenderer = createPreviewRendererPort({
      root: previewHost,
      documentRef: document,
      documentModel,
      presentation: markdownPresentation,
      notify,
      record(operation, entry) { window.markdownEditorPerf?.record?.(operation, entry); },
      reportError(message, error) { console.error(message, error); }
    });
    previewRenderer.start();
    previewRendererPort = mountClassicPreviewRendererPort(compatibilityPlatformHost, previewRenderer);
    const previewShell = Object.freeze({
      getPreviewPerformanceMode() {
        if (!editorUiCommandPort.has('getPreviewRuntimeSettings')) return 'auto';
        return editorUiCommandPort.invoke('getPreviewRuntimeSettings')?.previewPerformanceMode || 'auto';
      },
      getEditorFontSize() {
        if (!editorUiCommandPort.has('getPreviewRuntimeSettings')) return 16;
        return editorUiCommandPort.invoke('getPreviewRuntimeSettings')?.editorFontSize || 16;
      },
      updatePreviewStrategyBadge(mode, stats) {
        if (editorUiCommandPort.has('updatePreviewStrategyBadge')) editorUiCommandPort.invoke('updatePreviewStrategyBadge', mode, stats);
      },
      updateDocumentStatistics(statistics) {
        if (editorUiCommandPort.has('updateDocumentStatistics')) editorUiCommandPort.invoke('updateDocumentStatistics', statistics);
      },
      persistCurrentDocumentIndex(headings, statistics) {
        if (editorUiCommandPort.has('persistCurrentDocumentIndex')) editorUiCommandPort.invoke('persistCurrentDocumentIndex', headings, statistics);
      },
      preparePreviewEditorMetrics() {
        if (editorUiCommandPort.has('preparePreviewEditorMetrics')) editorUiCommandPort.invoke('preparePreviewEditorMetrics');
      },
      invalidatePreviewAnchorMetrics() {
        if (editorUiCommandPort.has('invalidatePreviewAnchorMetrics')) editorUiCommandPort.invoke('invalidatePreviewAnchorMetrics');
      },
      invalidatePreviewAnchorStructure() {
        if (editorUiCommandPort.has('invalidatePreviewAnchorStructure')) editorUiCommandPort.invoke('invalidatePreviewAnchorStructure');
      },
      annotatePreviewSourceLines(source, tokens, blocks) {
        if (editorUiCommandPort.has('annotatePreviewSourceLines')) return editorUiCommandPort.invoke('annotatePreviewSourceLines', source, tokens, blocks);
        return null;
      },
      refreshPreviewAnchorStructure() {
        if (editorUiCommandPort.has('refreshPreviewAnchorStructure')) return editorUiCommandPort.invoke('refreshPreviewAnchorStructure');
        return null;
      },
      getPreviewAnchorMetrics() {
        return editorUiCommandPort.has('getPreviewAnchorMetrics') ? editorUiCommandPort.invoke('getPreviewAnchorMetrics') : [];
      },
      getPreviewAnchorCount() {
        return editorUiCommandPort.has('getPreviewAnchorCount') ? editorUiCommandPort.invoke('getPreviewAnchorCount') : 0;
      },
      scrollPreviewToLine(line, behavior, ratio) {
        if (editorUiCommandPort.has('scrollPreviewToLine')) return editorUiCommandPort.invoke('scrollPreviewToLine', line, behavior, ratio);
        return false;
      },
      requestAutoSave() {
        if (editorUiCommandPort.has('requestAutoSave')) return editorUiCommandPort.invoke('requestAutoSave');
        return false;
      },
      translate(key, ...args) { return t(key, ...args); }
    });
    previewMarkdownRenderer = createPreviewMarkdownRenderer({
      documentRef: document,
      presentation: markdownPresentation,
      reportError(message, error) { console.warn(message, error); }
    });
    previewRenderEngine = createPreviewRenderEngine({
      root: previewHost,
      editor: editorHost,
      documentModel,
      documentSession: documentSessionPort,
      outline: outlineControllerPort,
      state: previewState,
      scheduler: previewScheduler,
      renderCoordinator: previewRenderCoordinator,
      renderer: previewRenderer,
      enhancementCoordinator: previewEnhancementCoordinator,
      recoveryView: previewRecoveryView,
      markdownRenderer: previewMarkdownRenderer,
      createWorkerClient: createPreviewWorkerClient,
      createVirtualController: createVirtualPreviewController,
      backgroundScheduler: backgroundTaskScheduler,
      shell: previewShell,
      layoutState,
      selectionController,
      scrollController,
      notify,
      record(operation, entry) { window.markdownEditorPerf?.record?.(operation, entry); },
      diagnostic(operation, entry) { window.markdownEditorPerf?.diagnostic?.(operation, entry); }
    });
    previewController = createPreviewController({
      root: previewHost,
      editor: editorHost,
      documentModel,
      layoutState,
      state: previewState,
      scheduler: previewScheduler,
      layoutStability: previewLayoutStability,
      focusController: previewFocusController,
      enhancementCoordinator: previewEnhancementCoordinator,
      renderer: previewRenderer,
      recoveryView: previewRecoveryView,
      renderEngine: previewRenderEngine,
      presentation: markdownPresentation,
      shell: previewShell,
      scrollController,
      storage: window.localStorage
    });
    previewController.start();
    previewCommandHandler = mountPreviewCommandHandler(compatibilityPlatformHost, previewController);
    const scrollPreviewToLine = (line, behavior = 'auto', viewportRatio = 0.38) => {
      const ratio = Math.max(0.05, Math.min(0.95, Number(viewportRatio) || 0.38));
      const contentY = previewScrollMapper.getContentYForLine(line);
      return scrollController.scrollTo('preview', contentY - previewHost.clientHeight * ratio, {
        behavior,
        reason: 'preview-line-navigation',
        suspendMs: behavior === 'smooth' ? 420 : 180,
        settleMs: behavior === 'smooth' ? 900 : 700
      });
    };
    unregisterPreviewEditorCommands = editorUiCommandPort.register({
      focusPreviewLineForOutline: (line, options) => previewController.focusLine(line, options),
      preparePreviewEditorMetrics: () => scrollController.notifyGeometryChanged('editor'),
      invalidatePreviewAnchorMetrics: () => previewScrollMapper.invalidateMetrics(),
      invalidatePreviewAnchorStructure: () => previewScrollMapper.invalidateStructure(),
      annotatePreviewSourceLines: (source, tokens, blocks) => previewScrollMapper.annotateSourceLines(source, tokens, blocks),
      refreshPreviewAnchorStructure: () => previewScrollMapper.refreshStructure(),
      getPreviewAnchorMetrics: () => previewScrollMapper.getMetrics(),
      getPreviewAnchorCount: () => previewScrollMapper.getAnchorCount(),
      scrollPreviewToLine,
      syncEditorSelectionToPreview: (shouldScroll = false, reason = 'compatibility') => selectionController.syncEditorToPreview(shouldScroll, reason)
    });
    scrollController.configure({
      syncFromEditor: () => {
        const contentY = editorHost.scrollTop + editorHost.clientHeight * 0.38;
        const sourceLine = editorScrollMapper.getLineAtContentY(contentY);
        const targetY = previewScrollMapper.getContentYForLine(sourceLine);
        scrollController.scheduleTarget('preview', targetY - previewHost.clientHeight * 0.38, { reason: 'linked-scroll' });
        outlineController?.updateActiveLine?.(Math.max(1, Math.floor(sourceLine)));
      },
      syncFromPreview: () => {
        const sourceLine = previewScrollMapper.getLineForContentY(previewHost.scrollTop + previewHost.clientHeight * 0.38);
        const targetY = editorScrollMapper.getContentYForLine(sourceLine);
        scrollController.scheduleTarget('editor', targetY - editorHost.clientHeight * 0.38, { reason: 'linked-scroll' });
        outlineController?.updateActiveLine?.(Math.max(1, Math.floor(sourceLine)));
      }
    });
    configureHybridSyncCapabilities({
      markProgrammaticScroll: (surface, durationMs) => scrollController.markProgrammaticScroll(surface, durationMs),
      notifyScrollGeometry: surface => scrollController.notifyGeometryChanged(surface),
      notifySelectionGeometry: reason => selectionController.notifyEditorGeometry(reason)
    });
    selectionController.start();
    configurePerformanceRuntimeStats(() => ({
      classifyScrollTarget: target => scrollController.classifyScrollTarget(target),
      scrollSync: scrollController.getState(),
      selectionSync: selectionController?.getState?.() || null,
      virtualPreview: previewController?.getVirtualStats?.() || null,
      backgroundTasks: backgroundTaskScheduler.getStats().pending
    }));
    closeSavePort = createCloseSavePort();
    classicCloseSavePort = mountClassicCloseSavePort(compatibilityPlatformHost, closeSavePort);
    const layoutFrameHost = document.defaultView;
    const requestLayoutFrame = callback => layoutFrameHost.requestAnimationFrame(callback);
    const cancelLayoutFrame = id => layoutFrameHost.cancelAnimationFrame(id);
    sidebarLayoutController = createSidebarLayoutController({
      state: layoutState,
      sidebar: requireElement('#sidebar', 'Sidebar'),
      resizer: requireElement('#sidebar-resizer', 'Sidebar resize handle'),
      onGeometryChanged() { scrollController.notifyGeometryChanged(); }
    });
    compactShellController = createCompactShellController({
      state: layoutState,
      root: document.documentElement,
      viewport: layoutFrameHost,
      requestFrame: requestLayoutFrame,
      cancelFrame: cancelLayoutFrame,
      setTimer: layoutFrameHost.setTimeout.bind(layoutFrameHost),
      clearTimer: layoutFrameHost.clearTimeout.bind(layoutFrameHost),
      now: () => layoutFrameHost.performance.now(),
      closeMenus() {
        if (editorUiCommandPort.has('closeAppMenus')) editorUiCommandPort.invoke('closeAppMenus');
      },
      onGeometryChanged() { scrollController.notifyGeometryChanged(); },
      record(operation, entry) { window.markdownEditorPerf?.record?.(operation, entry); }
    });
    sidebarLayoutController.start();
    compactShellController.start();
    pageFullscreenController = createPageFullscreenController({
      state: layoutState,
      app: requireElement('.app', 'Application shell'),
      body: document.body,
      storage: platform.storage,
      onGeometryChanged() {
        scrollController.notifyGeometryChanged();
        toolbarBoundaryController?.refresh();
      }
    });
    systemFullscreenController = createSystemFullscreenController({
      state: layoutState,
      fullscreen: platform.fullscreen,
      supported: platform.capabilities.browser.fullscreen
    });
    pageFullscreenController.start();
    systemFullscreenController.start();
    const toolbarElement = requireElement('[data-ui-slot="toolbar"]', 'Editor toolbar');
    toolbarBoundaryController = createToolbarBoundaryController({
      toolbar: toolbarElement,
      formatGroup: requireElement('[data-ui-slot="toolbar"] .format-group', 'Toolbar format group'),
      actions: requireElement('[data-ui-slot="toolbar"] .editor-actions', 'Toolbar actions'),
      matchMedia: typeof layoutFrameHost.matchMedia === 'function'
        ? layoutFrameHost.matchMedia.bind(layoutFrameHost)
        : null,
      getStyle: element => layoutFrameHost.getComputedStyle(element),
      createResizeObserver: typeof layoutFrameHost.ResizeObserver === 'function'
        ? callback => new layoutFrameHost.ResizeObserver(callback)
        : null,
      resizeTarget: layoutFrameHost,
      requestFrame: requestLayoutFrame,
      cancelFrame: cancelLayoutFrame,
      fontsReady: document.fonts?.ready ?? null,
      record(operation, entry) { layoutFrameHost.markdownEditorPerf?.record?.(operation, entry); }
    });
    toolbarBoundaryController.start();
    unregisterLayoutUiCommands = editorUiCommandPort.register({
      refreshToolbarBoundary: () => toolbarBoundaryController?.refresh(),
      async togglePageFullscreen() {
        const result = await pageFullscreenController.toggle();
        if (result.ok) {
          notify(result.active
            ? '专注模式已开启：已隐藏工具栏、侧边栏和状态栏'
            : '专注模式已关闭');
        } else {
          console.warn('Page fullscreen persistence failed:', result.error);
        }
        return result;
      },
      async toggleSystemFullscreen() {
        const result = await systemFullscreenController.toggle();
        if (!result.supported) notify(t('toastNoFullscreenApi'));
        else if (!result.ok) {
          console.warn('System fullscreen transition failed:', result.error);
          layoutFrameHost.markdownEditorPerf?.record?.('layout.system-fullscreen-error', {
            category: 'ui.layout',
            durationMs: 0,
            details: { message: String(result.error?.message || result.error || 'unknown') }
          });
        }
        return result;
      }
    });
    const editorPaneElement = requireElement('.editor-pane', 'Editor pane');
    const previewPaneElement = requireElement('.preview-pane', 'Preview pane');
    const splitResizerElement = requireElement('#resizer', 'Split resize handle');
    splitResizeController = createSplitResizeController({
      state: layoutState,
      main: requireElement('.main', 'Main split layout'),
      editorPane: editorPaneElement,
      previewPane: previewPaneElement,
      resizer: splitResizerElement,
      body: document.body,
      storage: layoutFrameHost.localStorage,
      requestFrame: requestLayoutFrame,
      cancelFrame: cancelLayoutFrame,
      onGeometryChanged() { scrollController.notifyGeometryChanged(); }
    });
    splitPaneController = createSplitPaneController({
      state: layoutState,
      editorPane: editorPaneElement,
      previewPane: previewPaneElement,
      resizer: splitResizerElement,
      editorCollapseButton: requireElement('#editor-collapse-btn', 'Editor collapse button'),
      previewCollapseButton: requireElement('#preview-collapse-btn', 'Preview collapse button'),
      storage: layoutFrameHost.localStorage,
      requestLayoutMode(mode) {
        if (!editorUiCommandPort.has('setLayoutMode')) throw new Error('Layout mode command is unavailable.');
        editorUiCommandPort.invoke('setLayoutMode', mode);
      },
      activateCompactPane: (pane, reason) => compactSplitController?.activatePane(pane, reason) || false,
      getCollapseLabel(pane, collapsed) {
        if (pane === 'editor') return t(collapsed ? 'expandEditor' : 'collapseEditor');
        return t(collapsed ? 'expandPreview' : 'collapsePreview');
      }
    });
    compactSplitController = createCompactSplitController({
      state: layoutState,
      main: requireElement('.main', 'Main split layout'),
      editorPane: editorPaneElement,
      previewPane: previewPaneElement,
      paneController: splitPaneController,
      viewport: layoutFrameHost,
      createResizeObserver: typeof layoutFrameHost.ResizeObserver === 'function'
        ? callback => new layoutFrameHost.ResizeObserver(callback)
        : null,
      requestFrame: requestLayoutFrame,
      cancelFrame: cancelLayoutFrame
    });
    splitControllerPort = mountClassicSplitControllerPort(compatibilityPlatformHost, {
      paneController: splitPaneController,
      compactController: compactSplitController
    });
    splitResizeController.start();
    splitPaneController.start();
    compactSplitController.start();
    sidebarResizeController = createSidebarResizeController({
      state: layoutState,
      workspace: requireElement('.workspace', 'Workspace'),
      resizer: requireElement('#sidebar-resizer', 'Sidebar resize handle'),
      root: document.documentElement,
      body: document.body,
      storage: window.localStorage,
      viewport: window,
      matchMedia: typeof document.defaultView?.matchMedia === 'function'
        ? document.defaultView.matchMedia.bind(document.defaultView)
        : null,
      onGeometryChanged() { scrollController.notifyGeometryChanged(); }
    });
    sidebarResizeController.start();
    for (const src of APP_MODULES) {
      await loadClassicScript(src);
    }
    if (!closeSavePort.registered) throw new Error('CloseSavePort application policy is unavailable.');
    const windowSupported = platform.capabilities.desktop.window;
    const windowState = createWindowState();
    let nextWindowController = null;
    const windowControlsView = createWindowControlsView({
      state: windowState,
      root: document.documentElement,
      controls: requireElement('#window-controls', 'Window controls'),
      minimizeButton: requireElement('#window-minimize-btn', 'Window minimize button'),
      maximizeButton: requireElement('#window-maximize-btn', 'Window maximize button'),
      closeButton: requireElement('#window-close-btn', 'Window close button'),
      onMinimize: () => nextWindowController.minimize(),
      onToggleMaximize: () => nextWindowController.toggleMaximize(),
      onClose: () => nextWindowController.requestClose('control'),
      reportError(message, error) { console.error(message, error); }
    });
    const windowDragRegion = createWindowDragRegion({
      target: requireElement('.menu-bar', 'Window drag region'),
      enabled: windowSupported,
      startDrag: () => nextWindowController.startDrag(),
      toggleMaximize: () => nextWindowController.toggleMaximize(),
      reportError(message, error) { console.warn(message, error); }
    });
    const windowCloseController = createWindowCloseController({
      state: windowState,
      windowPort: platform.window,
      closeSave: closeSavePort,
      supported: windowSupported,
      notify,
      record(operation, entry) { window.markdownEditorPerf?.record?.(operation, entry); },
      reportError(message, error) { console.error(message, error); }
    });
    nextWindowController = createWindowController({
      state: windowState,
      windowPort: platform.window,
      controlsView: windowControlsView,
      dragRegion: windowDragRegion,
      closeController: windowCloseController,
      supported: windowSupported,
      notify,
      reportError(message, error) { console.warn(message, error); }
    });
    windowController = nextWindowController;
    await windowController.start();
    recentFilesMenuController.start();
    sidebarTabController.start();
    mountDocumentEditorViews();
    if (window.__markdownEditorInitPromise) await window.__markdownEditorInitPromise;
  } catch (error) {
    destroyDocumentFeatures();
    throw error;
  }
}

loadAppModules().then(() => {
  document.documentElement.classList.add('app-ready');
  installMarkdownEditorE2EBridge();
  window.markdownEditorPerf?.installLegacyInstrumentation();
  window.markdownEditorPerf?.record('app.ready', {
    category: 'app.lifecycle',
    durationMs: performance.now(),
    details: { documentReadyState: document.readyState }
  });
}).catch((error) => {
  destroyLayoutStateFeature();
  console.error(error);
  const status = document.getElementById('status');
  if (status) status.textContent = error.message;
});
