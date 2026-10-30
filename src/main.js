import { observeDocumentSnapshots } from './features/documents/application/document-snapshot-telemetry.js';
import { telemetry } from './features/telemetry/index.js';
import { createApplicationLifetime } from './bootstrap/application-lifetime.js';
import { createShellMenus } from './features/menu/shell-menus.js';
import { createWorkspaceStatus } from './features/persistence/ui/workspace-status.js';
import { createWorkspacePreferences } from './features/layout/workspace-preferences.js';
import { createDocumentWorkspace } from './features/documents/ui/document-workspace.js';
import { createApplicationEvents } from './bootstrap/application-events.js';
import { createWorkspaceStartup } from './bootstrap/workspace-startup.js';
import { createFindPreviewCommands } from './features/editor/application/find-preview-commands.js';
import { canRunEditorAction, createEditorContextActions } from './features/editor/index.js';
import 'katex/dist/katex.css';
import './styles/index.css';
import katexStyleSheetText from 'katex/dist/katex.css?raw';
import { createExportController, createExportRequestPolicy, createExportImageDialogView, createExportFileWriter, createImageExporter, createImageExportSurface, imageDataUrlToBytes, createImageAssetPreloader, createImageExportLayout, createPdfExporter, createPdfPrintSurface, createWordExporter, createWordDocumentSerializer, createHtmlFontAssets, createHtmlDocumentSerializer, createHtmlExporter, createMarkdownExporter, createExportStyleSheet, createExportPreviewEnhancer, createExportDocumentBuilder, createExportProgressStore, createExportProgressDialogView, createExportTaskController } from './features/export/index.js';
import { createImageImportController, createDropImportController, createDropOverlayView, createImportDocumentController, createFileImportView } from './features/import/index.js';
import { createWebClipperController, createWebClipperView, convertExtractedHtml, extractHtml, createWebFetchCoordinator, createFileImportController } from './features/import/index.js';
import { createBrowserPrint, createBrowserFileReader } from './platform/index.js';
import { createLinkPreview } from './features/link-preview/index.js';
import { mountPerformanceTelemetry, configurePerformancePlatform, configurePerformanceRuntimeStats, destroyPerformanceTelemetry } from './features/telemetry/index.js';
import { createVirtualEditor, createDocumentModelBinding } from './features/editor/index.js';
import { createEditorCommandService, createEditorController, createEditorFocusService, createEditorHistoryAdapter, createEditorSelectionService, createEditorPaneView, createEditorToolbarView, createFindReplaceDialogView, createImageDialogView, createInlineColorMenuView, createLinkDialogView, createMathDialogView, createMermaidDialogView, createTableDialogView } from './features/editor/index.js';
import { createCompactShellController, createCompactSplitController, createLayoutState, createPageFullscreenController, createSidebarLayoutController, createSidebarResizeController, createSplitPaneController, createSplitResizeController, createSystemFullscreenController, createToolbarBoundaryController } from './features/layout/index.js';
import {
  createDocumentModel,
  selectionMappingApi
} from './model-kernel/index.js';
import { createNativeDocumentStore } from './features/persistence/index.js';
import { SETTINGS_CHANGED_EVENT } from './features/settings/index.js';
import { createAutosaveController, createBrowserDocumentRepository, createCloseSaveController, createLoadController, createSaveController, createSaveStatusStore } from './features/persistence/index.js';
import { createTaskScheduler } from './shared/scheduling/task-scheduler.js';

import { loadDomToImage } from './shared/vendor/capability-loader.js';
import { createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController } from './features/sync/index.js';
import { createEditorSelectionReader, createPreviewSelectionReader, createSelectionFeedbackGuard, createSelectionHighlightSession, createSelectionRetryScheduler, createSelectionSyncController, createPreviewComponentMapping } from './features/sync/index.js';
import { configureMarkdownEditorE2EPorts, installMarkdownEditorE2EBridge, destroyMarkdownEditorE2EBridge } from './features/e2e/index.js';
import { createFolderTreeController, createFolderTreeState, createFolderTreeView, createOutlineCollapseStore, createOutlineController, createOutlineView, createSidebarState, createSidebarTabController } from './features/sidebar/index.js';
import { configureHybridImageSourcePlatform, configureHybridSyncCapabilities, configureHybridLinkPreview } from './features/hybrid-editor/index.js';
import { DocumentOperationStaleError, createDocumentContextMenuView, createDocumentListView, createDocumentSessionController, createDocumentTitleView, createRecentFilesReadSource, createRecentFilesRepository, createSessionDocumentRepository, normalizeDocumentTitle, updateDocumentRecord } from './features/documents/index.js';
import { createRecentFilesMenuController } from './features/menu/index.js';
import { createCloseSavePort, createWindowCloseController, createWindowController, createWindowControlsView, createWindowDragRegion, createWindowState } from './features/window/index.js';
import { createPreviewCancellation, createMarkdownPresentationApi, createPreviewController, createPreviewEnhancementCoordinator, createPreviewFocusController, createPreviewLayoutStability, createPreviewRenderCoordinator, createPreviewRenderEngine, createPreviewRendererPort, createPreviewMarkdownRenderer, createPreviewRecoveryView, createPreviewScheduler, createPreviewState, createPreviewWorkerClient, createVirtualPreviewController, PREVIEW_BEHAVIOR_THRESHOLDS, createPreviewCommands } from './features/preview/index.js';

/** Construct the application from explicit feature owners. Importing has no startup side effects. */
export async function startApplication({ platform, documentStorage = window.localStorage, documentSessionStore, settingsStore, i18nService, helpController, menuController, submenuPositioner, editorCommands, documentCommands }) {
const startupLifetime = createApplicationLifetime();
function ownApplicationExit(release) {
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    const result = release();
    if (result && typeof result.catch === 'function') void result.catch(error => console.error('Asynchronous application cleanup failed:', error));
  };
  startupLifetime.own(dispose);
}
startupLifetime.listen(window, 'pagehide', () => startupLifetime.destroy(), { once: true });
startupLifetime.own(() => { document.documentElement.classList.remove('app-ready'); destroyMarkdownEditorE2EBridge(); if (import.meta.env.DEV) destroyPerformanceTelemetry(); });
try {
if (import.meta.env.DEV) mountPerformanceTelemetry();

const exportFileWriter = createExportFileWriter({ platform });
ownApplicationExit(() => exportFileWriter.destroy());

const exportRequestPort = createExportRequestPolicy( {
  getActiveDocumentId: () => documentSessionStore?.activeId,
  hasDocument: id => Boolean(documentSessionStore?.getRecord(id))
});
let exportController = null;

const exportImageView = createExportImageDialogView({ overlayRoot: document.getElementById('overlay-root'),
  onCommand: (action, payload) => exportController?.invoke(action, payload),
  translate: (...args) => i18nService.t(...args),
  subscribeLocale: listener => i18nService.subscribe(listener) });
ownApplicationExit(() => exportImageView.destroy());
let imageExporter = null;
let imageExportSurface = null;

let pdfExporter = null;

let pdfPrintSurface = null;
let wordExporter = null;

let htmlExporter = null;

let markdownExporter = null;

let exportDocumentBuilder = null;

let exportPreviewEnhancer = null;

const exportStyles = createExportStyleSheet({ documentRef: document, mathCss: katexStyleSheetText });
ownApplicationExit(() => exportStyles.destroy());

const imageAssetPreloader = createImageAssetPreloader({
  createImage: () => new window.Image(), createCanvas: () => document.createElement('canvas'),
  setTimer: (...args) => window.setTimeout(...args), clearTimer: handle => window.clearTimeout(handle),
  requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: handle => window.cancelAnimationFrame(handle)
});
ownApplicationExit(() => imageAssetPreloader.destroy());

const imageExportLayout = createImageExportLayout();
ownApplicationExit(() => imageExportLayout.destroy());

const htmlFontAssets = createHtmlFontAssets({ mathCss: katexStyleSheetText,
  loaders: import.meta.glob('../../node_modules/katex/dist/fonts/*.woff2', { query: '?inline', import: 'default' }) });
const htmlDocumentSerializer = createHtmlDocumentSerializer({ styles: exportStyles });
const wordDocumentSerializer = createWordDocumentSerializer({ styles: exportStyles });
const exportTaskController = createExportTaskController();
ownApplicationExit(() => exportTaskController.destroy());
const exportProgressStore = createExportProgressStore(exportTaskController);
ownApplicationExit(() => exportProgressStore.destroy());
const exportProgressView = createExportProgressDialogView({
  overlayRoot: document.getElementById('overlay-root'), store: exportProgressStore, onCancel: () => exportTaskController.cancel()
});
ownApplicationExit(() => exportProgressView.destroy());

const dropImportController = createDropImportController({
  target: document,
  nativeDrop: platform.capabilities.desktop.dragDrop,
  nativeFiles: platform.capabilities.desktop.fileSystem,
  subscribeNative: handler => platform.dragDrop.subscribe(handler),
  onSubscriptionError: error => console.warn('Native drag-drop subscription failed', error)
});
ownApplicationExit(() => dropImportController.destroy());
const dropImageController = createImageImportController({
  readBrowserImage: (file, options) => browserImageReader.readDataUrl(file, options),
  readNativeImage: path => platform.files.readImage(path, '')
});
ownApplicationExit(() => dropImageController.destroy());
const dropOverlayView = createDropOverlayView({ element: document.getElementById('drop-overlay') });
ownApplicationExit(() => dropOverlayView.destroy());
const browserImportReader = createBrowserFileReader({
  FileReaderClass: window.FileReader,
  readErrorMessage: '无法读取所选文档',
  cancelErrorMessage: '文档读取已取消'
});
const browserImageReader = createBrowserFileReader({
  FileReaderClass: window.FileReader,
  readErrorMessage: '无法读取所选图片',
  cancelErrorMessage: '图片读取已取消'
});
const fileImportController = createFileImportController({
  readBrowserText: (file, options) => browserImportReader.readText(file, options),
  readNativeText: path => platform.files.readText(path)
});
ownApplicationExit(() => fileImportController.destroy());
const webFetchCoordinator = createWebFetchCoordinator({
  nativeFetch: platform.capabilities.desktop.webFetch ? (url, options) => platform.web.fetchText(url, options) : undefined,
  browserFetch: (url, options) => window.fetch(url, options)
});
ownApplicationExit(() => webFetchCoordinator.destroy());
let destroyImportFeature = () => {};
const backgroundTaskScheduler = createTaskScheduler({ runtime: window });
ownApplicationExit(() => backgroundTaskScheduler.destroy());

const markdownPresentation = createMarkdownPresentationApi();

const previewState = createPreviewState();
ownApplicationExit(() => previewState.destroy());

const previewCancellation = createPreviewCancellation();
ownApplicationExit(() => previewCancellation.destroy());
const previewScheduler = createPreviewScheduler({
  cancellation: previewCancellation,
  getBackgroundScheduler: () => backgroundTaskScheduler
});
ownApplicationExit(() => previewScheduler.destroy());

const previewEnhancementCoordinator = createPreviewEnhancementCoordinator({
  scheduler: previewScheduler,
  thresholds: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.enhancement
});
ownApplicationExit(() => previewEnhancementCoordinator.destroy());

const previewFocusController = createPreviewFocusController({
  scheduler: previewScheduler,
  focusDelay: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.focusMs
});
ownApplicationExit(() => previewFocusController.destroy());

const previewRenderCoordinator = createPreviewRenderCoordinator();
ownApplicationExit(() => previewRenderCoordinator.destroy());

const previewLayoutRoot = document.getElementById('preview');
const previewLayoutPane = document.querySelector('.f-preview-pane');
const previewLayoutFrameHost = document.defaultView;
if (!previewLayoutRoot) throw new Error('Preview host is missing.');
if (!previewLayoutPane) throw new Error('Preview pane is missing.');
const previewRecoveryView = createPreviewRecoveryView({
  root: previewLayoutRoot,
  documentRef: document
});
ownApplicationExit(() => previewRecoveryView.destroy());

const previewLayoutStability = createPreviewLayoutStability({
  root: previewLayoutRoot,
  pane: previewLayoutPane,
  scheduler: previewScheduler,
  thresholds: PREVIEW_BEHAVIOR_THRESHOLDS.scheduling.layout,
  createResizeObserver: typeof previewLayoutFrameHost?.ResizeObserver === 'function'
    ? callback => new previewLayoutFrameHost.ResizeObserver(callback)
    : null,
  now: () => previewLayoutFrameHost?.performance?.now?.() ?? performance.now(),
  record(operation, entry) { telemetry.record?.(operation, entry); },
  reportError(message, error) { console.warn(message, error); }
});
ownApplicationExit(() => previewLayoutStability.destroy());

const layoutState = createLayoutState();
ownApplicationExit(() => layoutState.destroy());

let compactShellController = null;
let sidebarLayoutController = null;
let sidebarResizeController = null;
let splitResizeController = null;
let splitPaneController = null;
let compactSplitController = null;
let toolbarBoundaryController = null;
let pageFullscreenController = null;
let systemFullscreenController = null;

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

  destroyLayoutInteractionControllers();

  layoutState.destroy();
};

let readLinkDocumentContext = () => ({}), notifyLinkPreview = message => console.warn(message);
const linkPreview = createLinkPreview({ document, window, links: platform.links, record: telemetry.record,
  notify: message => notifyLinkPreview(message) });
ownApplicationExit(() => linkPreview.destroy());
configureHybridLinkPreview(linkPreview);
configurePerformancePlatform({
  logs: platform.logs,
  enabled: platform.capabilities.desktop.performanceLogs
});
configureHybridImageSourcePlatform({
  files: platform.files,
  enabled: platform.capabilities.desktop.fileSystem,
  getDocumentContext: () => readLinkDocumentContext()
});
ownApplicationExit(() => {
  configureHybridLinkPreview(null);
  const cleanupErrors = [];
  for (const release of [() => linkPreview.destroy(), () => exportController?.destroy(),  () => imageExporter?.destroy(),  () => imageExportSurface?.destroy(), () => exportImageView.destroy(), () => pdfExporter?.destroy(),  () => pdfPrintSurface?.destroy(), () => wordExporter?.destroy(),  () => htmlExporter?.destroy(),  () => markdownExporter?.destroy(),  () => exportFileWriter.destroy(), () => exportTaskController.destroy(), () => exportPreviewEnhancer?.destroy(),
     () => exportDocumentBuilder?.destroy(),
     () => exportProgressView.destroy(),
    () => exportProgressStore.destroy(), () => imageAssetPreloader.destroy(),   () => imageExportLayout.destroy(),
    () => exportStyles.destroy(),
     ]) {
    try { release(); } catch (error) { cleanupErrors.push(error); }
  }
  destroyLayoutStateFeature();

  previewLayoutStability.destroy();

  previewRecoveryView.destroy();

  previewFocusController.destroy();

  previewEnhancementCoordinator.destroy();

  previewRenderCoordinator.destroy();

  previewScheduler.destroy();
  previewCancellation.destroy();

  previewState.destroy();

  backgroundTaskScheduler.destroy();
  destroyImportFeature();
  void dropImportController.destroy();
  dropOverlayView.destroy();
  dropImageController.destroy();
  fileImportController.destroy();
  webFetchCoordinator.destroy();

  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Export cleanup failed.');

});

if (typeof document.startViewTransition === 'function') {
  document.documentElement.classList.add('view-transitions-supported');
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
  ownApplicationExit(() => scrollController.destroy());
  const virtualEditor = createVirtualEditor(editorHost, { scrollSync: scrollController.getPublicApi() });
  scrollController.connectEditor(virtualEditor);
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
  ownApplicationExit(destroySelectionSync);
  const documentModel = createDocumentModel(createDocumentModelBinding(virtualEditor));
  const releaseSnapshotTelemetry = import.meta.env.DEV
    ? observeDocumentSnapshots(documentModel, { record: telemetry.record, now: () => performance.now() }) : () => {};
  let editorScrollMapper = null;
  try {
    editorScrollMapper = createEditorScrollMapper({ editorApi: virtualEditor, model: documentModel });
  } catch (error) {
    releaseSnapshotTelemetry();
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }
  const destroyEditorScrollMapper = () => {
    editorScrollMapper?.destroy();
    editorScrollMapper = null;
  };
  let editorController;
  let editorHistoryAdapter;
  let editorCommandService;
  let editorSelectionService;
  let editorFocusService;

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

  } catch (error) {

    editorFocusService?.destroy?.();
    editorSelectionService?.destroy?.();
    editorCommandService?.destroy?.();
    editorHistoryAdapter?.destroy?.();
    editorController?.destroy?.();
    destroyEditorScrollMapper();
    releaseSnapshotTelemetry();
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }
  const nativeDocumentStore = createNativeDocumentStore({
    documentStore: platform.documentStore,
    available: platform.capabilities.desktop.documentStore
  });
  const browserDocumentRepository = createBrowserDocumentRepository({
    storage: documentStorage,
    reportError(message, error) {
      console.warn(message, error);
    }
  });
  const documentRepository = createSessionDocumentRepository({
    browserRepository: browserDocumentRepository,
    nativeStore: nativeDocumentStore,
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
  let documentController = null;
  const loadController = createLoadController({
    documents: documentSessionStore,
    model: documentModel,
    editor: virtualEditor,
    repository: documentRepository,
    resolveRecord(record, patch, options) {
      return updateDocumentRecord(record, patch, options);
    },
    assertGeneration(operation) {
      if (documentController?.isCurrentGeneration(operation)) return true;
      throw new DocumentOperationStaleError(operation, null);
    }
  });
  documentController = createDocumentSessionController({
    session: documentSessionStore,
    model: documentModel,
    repository: documentRepository,
    loadController
  });

  markdownExporter = createMarkdownExporter({ documentModel, documents: documentController, taskController: exportTaskController, fileWriter: exportFileWriter });

  const recentFilesRepository = createRecentFilesRepository({
    storage: window.localStorage,
    reportError(message, error) {
      console.warn(message, error);
    }
  });
  recentFilesRepository.load();
  const recentFilesSource = createRecentFilesReadSource(recentFilesRepository);

  let recentFilesMenuController;

  try {

    recentFilesMenuController = createRecentFilesMenuController({
      owner: requireElement('#recent-files-menu-item', 'Recent Files submenu owner'),
      list: requireElement('#recent-files-menu', 'Recent Files submenu list'),
      source: recentFilesSource,
      commands: menuController,
      available: platform.capabilities.desktop.fileSystem,
      reportError(message, error) { console.error(message, error); }
    });
  } catch (error) {
    recentFilesMenuController?.destroy?.();

    recentFilesRepository.destroy();
    exportController?.destroy();

    exportController = null;

    imageExporter?.destroy();

    imageExportSurface?.destroy();
    exportImageView.destroy();
    imageExporter = null;

    imageExportSurface = null;
    pdfExporter?.destroy();

    pdfPrintSurface?.destroy();
    pdfExporter = null;

    pdfPrintSurface = null;
    wordExporter?.destroy();

    wordExporter = null;

    htmlExporter?.destroy();

    htmlExporter = null;

    markdownExporter?.destroy();

    markdownExporter = null;

    exportFileWriter.destroy();

    documentController.destroy();
    loadController.destroy();
    documentRepository.destroy();
    browserDocumentRepository.destroy();

    editorFocusService.destroy();
    editorSelectionService.destroy();
    editorCommandService.destroy();
    editorHistoryAdapter.destroy();
    editorController.destroy();
    destroyEditorScrollMapper();
    releaseSnapshotTelemetry();
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }
  const autosaveSettingsSource = Object.freeze({
    read() {
      return Object.freeze({
        enabled: Boolean(settingsStore.get('autoSaveEnabled')),
        delay: Number(settingsStore.get('autoSaveDelay'))
      });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Autosave Settings listener must be a function.');
      const handler = event => {
        if (!event?.detail?.snapshot || !Array.isArray(event.detail.changedIds)) return;
        listener(autosaveSettingsSource.read());
      };
      document.addEventListener(SETTINGS_CHANGED_EVENT, handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        document.removeEventListener(SETTINGS_CHANGED_EVENT, handler);
      };
    }
  });
  const saveStatusStore = createSaveStatusStore();

  const saveController = createSaveController({
    documentController,
    model: documentModel,
    statusStore: saveStatusStore,
    writeText(path, content, options) { return platform.files.writeText(path, content, options); },
    chooseSaveFile: platform.capabilities.desktop.dialogs
      ? (preferredName, options) => platform.dialogs.saveFile(preferredName, options)
      : null,
    persistentFileSystem: platform.capabilities.desktop.fileSystem,
    normalizeTitle: normalizeDocumentTitle
  });
  const autosaveController = createAutosaveController({
    saveController,
    documentController,
    model: documentModel,
    statusStore: saveStatusStore,
    settings: autosaveSettingsSource,
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: timerId => window.clearTimeout(timerId),
    reportError(message, error) { console.error(message, error); }
  });
  const unsubscribeNativeSaveStatus = nativeDocumentStore.subscribe(event => {
    saveStatusStore.consumePersistenceEvent(event);
  });
  let unregisterPersistenceEditorCommands = null;
  let unregisterPersistenceDocumentCommands = null;
  let persistenceSaveFeatureDestroyed = false;
  const destroyPersistenceSaveFeature = () => {
    if (persistenceSaveFeatureDestroyed) return;
    persistenceSaveFeatureDestroyed = true;
    unregisterPersistenceDocumentCommands?.();
    unregisterPersistenceDocumentCommands = null;
    unregisterPersistenceEditorCommands?.();
    unregisterPersistenceEditorCommands = null;
    autosaveController.destroy();
    unsubscribeNativeSaveStatus();
    saveController.destroy();

    saveStatusStore.destroy();
  };

  const featureViews = [];
  let unregisterEditorViewCommands = null;
  let unregisterLayoutUiCommands = null;
  let sidebarState = null;
  let sidebarTabController = null;

  let outlineController = null;

  let folderTreeController = null;

  let closeSavePort = null;
  let closeSaveController = null;

  let windowController = null;
  let previewRenderer = null;

  let previewMarkdownRenderer = null;
  let previewRenderEngine = null;
  let previewController = null;
  let previewCommandHandler = null;
  let previewScrollMapper = null;
  const destroyPreviewScrollMapper = () => {
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

  const applicationLifetime = createApplicationLifetime();
  let documentFeaturesDestroyed = false;
  const destroyDocumentFeatures = () => {
    destroyMarkdownEditorE2EBridge();
    if (documentFeaturesDestroyed) return;
    documentFeaturesDestroyed = true;
    try { applicationLifetime.destroy(); } catch (error) { console.error(error); }
    destroyImportFeature();
    destroySelectionSync();
    if (windowController) {
      const pendingWindowDestroy = windowController.destroy();
      if (pendingWindowDestroy && typeof pendingWindowDestroy.catch === 'function') {
        void pendingWindowDestroy.catch(error => console.error('Window feature cleanup failed:', error));
      }
      windowController = null;
    }
    closeSaveController?.destroy();
    closeSaveController = null;

    closeSavePort?.destroy();
    closeSavePort = null;
    destroyPersistenceSaveFeature();
    unregisterLayoutUiCommands?.();
    unregisterLayoutUiCommands = null;

    sidebarTabController?.destroy();
    sidebarTabController = null;
    outlineController?.destroy();
    outlineController = null;
    folderTreeController?.destroy();
    folderTreeController = null;
    sidebarState?.destroy();
    sidebarState = null;

    destroyLayoutInteractionControllers();
    destroyDocumentEditorViews();
    recentFilesMenuController?.destroy();
    recentFilesMenuController = null;

    recentFilesRepository.destroy();
    exportController?.destroy();

    exportController = null;

    imageExporter?.destroy();

    imageExportSurface?.destroy();
    exportImageView.destroy();
    imageExporter = null;

    imageExportSurface = null;
    pdfExporter?.destroy();

    pdfPrintSurface?.destroy();
    pdfExporter = null;

    pdfPrintSurface = null;
    wordExporter?.destroy();

    wordExporter = null;

    htmlExporter?.destroy();

    htmlExporter = null;

    markdownExporter?.destroy();

    markdownExporter = null;

    exportFileWriter.destroy();

    documentController.destroy();
    loadController.destroy();
    documentRepository.destroy();
    browserDocumentRepository.destroy();

    editorFocusService.destroy();
    editorSelectionService.destroy();
    editorCommandService.destroy();
    editorHistoryAdapter.destroy();
    editorController.destroy();
    destroyPreviewScrollMapper();
    unregisterPreviewEditorCommands?.();
    unregisterPreviewEditorCommands = null;
    exportPreviewEnhancer?.destroy();
    exportPreviewEnhancer = null;

    exportDocumentBuilder?.destroy();
    exportDocumentBuilder = null;

    previewCommandHandler?.destroy();
    previewCommandHandler = null;
    previewController?.destroy();
    previewController = null;
    previewRenderEngine = null;
    previewMarkdownRenderer = null;

    previewRenderer?.destroy();
    previewRenderer = null;
    destroyEditorScrollMapper();
    releaseSnapshotTelemetry();
    documentModel.destroy();
    virtualEditor.destroy();
  };
  ownApplicationExit(destroyDocumentFeatures);

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
    getCurrentContext: () => ({ filePath: documentSessionStore.getActiveRecord()?.filePath || '' }),
    openFile: path => documentCommands.has('openFolderTreeFile')
      ? documentCommands.invoke('openFolderTreeFile', path)
      : false,
    now: () => performance.now(),
    record(operation, entry) { telemetry.record?.(operation, entry); },
    reportError(message, error) { console.warn(message, error); }
  });
  folderTreeController.start();

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
      if (editorCommands.has('showContextMenu')) editorCommands.invoke('showContextMenu', outlineContextMenu, event);
      else event?.preventDefault?.();
    },
    closeContextMenus() {
      if (editorCommands.has('closeContextMenus')) editorCommands.invoke('closeContextMenus');
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
      if (editorCommands.has('focusPreviewLineForOutline')) {
        void editorCommands.invoke('focusPreviewLineForOutline', targetLine, { behavior: 'auto', scroll: true });
      } else {
        scrollController.beginUserGesture('editor', 'outline-navigation');
        scrollController.syncNow('editor');
      }
      return true;
    },
    now: () => performance.now(),
    record(operation, entry) { telemetry.record?.(operation, entry); },
    reportError(message, error) { console.warn(message, error); }
  });
  outlineController.start();
  sidebarTabController.registerLifecycle('outline', outlineController);

  const t = (...args) => {
    const i18n = i18nService;
    if (i18n?.t) return i18n.t(...args);
    return String(args[0] || '');
  };

  let inlineColorView = null;
  const notify = message => {
    if (editorCommands.has('notify')) return editorCommands.invoke('notify', message);
    console.warn(message);
  };
  const currentLayoutMode = () => editorCommands.has('getLayoutMode')
    ? editorCommands.invoke('getLayoutMode')
    : 'both';
  const readCurrentDocumentTitle = () => requireElement('#filename', 'Document title input').value;
  const importDocumentController = createImportDocumentController({
    files: fileImportController, images: dropImageController, documents: documentController,
    editor: {
      insertImage: (url, options) => runMutation('insertImage', url, options),
      appendMarkdown: markdown => editorController.appendImportedMarkdown(markdown)
    },
    prepareTransition: reason => autosaveController.cancelPending(reason),
    getDocumentOptions: () => ({ currentTitle: readCurrentDocumentTitle(),
      title: t('filenameDefault'), fallbackTitle: t('filenameDefault') }),
    async afterDocumentOpen(result) {
      if (!await documentCommands.invoke('applyDocumentLifecycleUi', result)) return false;
      if (!documentController.isCurrentGeneration(result.generation)) return false;
      void sidebarTabController.select('docs');
      return true;
    },
    addRecentFile: (path, name) => recentFilesRepository.add(path, { name }),
    notify, translate: t,
    record: (operation, entry) => telemetry.record?.(operation, entry)
  });
  let fileImportView = null, webClipperView = null, webClipperController = null, unregisterImportCommands = null;
  let importFeatureDestroyed = false;
  destroyImportFeature = () => {
    if (importFeatureDestroyed) return;
    importFeatureDestroyed = true;
    unregisterImportCommands?.();
    fileImportView?.destroy();
    webClipperView?.destroy();
    webClipperController?.destroy();
    importDocumentController.destroy();
    void dropImportController.destroy();
  };
  try {
    fileImportView = createFileImportView({ input: requireElement('#importFile', 'File Import input'),
      chooseFile: platform.capabilities.desktop.dialogs ? options => platform.dialogs.openFile(options) : null,
      openPath: path => dropImportController.openPath(path),
      openBrowserFile: file => importDocumentController.openBrowserFile(file), notify });
    webClipperController = createWebClipperController({ fetchCoordinator: webFetchCoordinator,
      extract: html => extractHtml(html, document), convert: convertExtractedHtml,
      insertMarkdown: markdown => importDocumentController.insertWebMarkdown(markdown),
      native: platform.capabilities.desktop.webFetch });
    webClipperView = createWebClipperView({ overlayRoot: requireElement('#overlay-root', 'Web Clipper overlay'),
      controller: webClipperController, translate: t, notify,
      subscribeLocale: listener => i18nService.subscribe(listener) });
    unregisterImportCommands = documentCommands.register({
      importFile: () => fileImportView.open(),
      openImportPath: path => dropImportController.openPath(path),
      importTextContent: (name, content, path = '') => importDocumentController.openTextContent(name, content, path),
      openWebClipper: () => webClipperView.open(),
      cancelImport: () => importDocumentController.cancel()
    });
    dropImportController.start({
      openBrowserText: (file, request) => importDocumentController.openBrowserFile(file, request),
      openNativeText: (path, request) => importDocumentController.openNativeText(path, request),
      openBrowserImage: (file, request) => importDocumentController.insertBrowserImage(file, request),
      openNativeImage: (path, request) => importDocumentController.insertNativeImage(path, request),
      setOverlayVisible: dropOverlayView.setVisible,
      unsupported: () => notify(t('toastDropUnsupported')),
      onError: error => notify(String(error?.message || error))
    });
  } catch (error) { destroyImportFeature(); destroyDocumentFeatures(); throw error; }
  const saveCurrentFileFromUi = async () => {
    try {
      const result = await saveController.saveCurrentFile({
        title: readCurrentDocumentTitle(),
        fallbackTitle: t('filenameDefault') || '未命名文档'
      });
      if (result?.cancelled || result?.stale || result?.completed === false) return false;
      notify('文件已保存');
      return true;
    } catch (error) {
      if (error?.code === 'DOCUMENT_OPERATION_STALE') return false;
      notify('保存失败：' + String(error?.message || error));
      telemetry.record?.('document.file-save-error', {
        category: 'document.error',
        status: 'error',
        details: { message: String(error?.message || error) }
      });
      return false;
    }
  };
  const saveAsMarkdownFromUi = async documentId => {
    const record = documentId ? documentController.getRecord(documentId) : documentController.getActiveRecord();
    if (!record) return false;
    try {
      const result = await saveController.saveAsMarkdown({
        documentId: record.id,
        title: record.id === documentController.activeId ? readCurrentDocumentTitle() : record.title,
        fallbackTitle: t('filenameDefault') || '未命名文档'
      });
      if (result?.cancelled || result?.stale || result?.completed === false) return false;
      notify('已另存为 Markdown');
      return true;
    } catch (error) {
      if (error?.code === 'DOCUMENT_OPERATION_STALE') return false;
      notify('另存为失败：' + String(error?.message || error));
      telemetry.record?.('document.save-as-error', {
        category: 'document.error',
        status: 'error',
        details: { message: String(error?.message || error) }
      });
      return false;
    }
  };
  unregisterPersistenceEditorCommands = editorCommands.register({
    requestDocumentPersistence: reason => autosaveController.schedule({ reason: String(reason || 'editor-ui-command') }),
    saveCurrentFile: () => saveCurrentFileFromUi(),
    saveAsMarkdown: () => saveAsMarkdownFromUi()
  });
  unregisterPersistenceDocumentCommands = documentCommands.register({
    prepareDocumentTransition: reason => autosaveController.cancelPending(String(reason || 'document-transition')),
    saveAsDocument: documentId => saveAsMarkdownFromUi(documentId)
  });
  const runMutation = (method, ...args) => {
    if (currentLayoutMode() === 'preview') { notify('纯阅读模式下不可编辑，请先切回写作、分栏或源码。'); return false; }
    editorHistoryAdapter.isolate();
    const result = editorCommandService[method](...args);
    if (currentLayoutMode() !== 'hybrid') editorFocusService.focus({ preventScroll: true });
    queueMicrotask(() => inlineColorView?.updateAvailability?.());
    return result;
  };
  const executeEditorAction = (action, payload) => {
    if (!canRunEditorAction(currentLayoutMode(), action)) { notify('纯阅读模式下不可编辑，请先切回写作、分栏或源码。'); return false; }
    if (action === 'close-app-menus') {
      if (editorCommands.has('closeAppMenus')) return editorCommands.invoke('closeAppMenus');
      return;
    }
    if (action === 'clear') {
      if (!window.confirm(t('confirmClear'))) return false;
      editorController.setText('');
      return true;
    }
    if (action === 'layout') return editorCommands.invoke('setLayoutMode', payload);
    if (action === 'save-current-file') return saveCurrentFileFromUi();
    if (action === 'save-as-markdown') return saveAsMarkdownFromUi();
    if (action === 'page-fullscreen') return editorCommands.invoke('togglePageFullscreen');
    if (action === 'system-fullscreen') return editorCommands.invoke('toggleSystemFullscreen');
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
      windowTitle: requireElement('.writing-window-title', 'Document window title'),
      session: documentSessionStore,
      fallbackTitle: t('filenameDefault') || '未命名文档.md',
      updateTitleDraft(value) { return documentCommands.invoke('updateTitleDraft', value); }
    });
    featureViews.push(titleView);

    const contextMenuView = createDocumentContextMenuView({
      documentMenu: requireElement('#document-context-menu', 'Document context menu'),
      sidebarMenu: requireElement('#sidebar-context-menu', 'Sidebar context menu'),
      docsPanel: requireElement('#sidebar-docs-panel', 'Documents panel'),
      commands: { invoke: (action, ...args) => documentCommands.invoke(action, ...args) }
    });
    featureViews.push(contextMenuView);

    const documentListView = createDocumentListView({
      root: requireElement('#document-list', 'Document list'),
      session: documentSessionStore,
      defaultTitle: t('filenameDefault') || '未命名文档',
      emptyText: '暂无文档',
      contextMenu: contextMenuView,
      commands: {
        open: id => documentCommands.invoke('openDocument', id),
        close: id => documentCommands.invoke('closeDocument', id)
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
      imageController: createImageImportController({
        readBrowserImage: (file, options) => browserImageReader.readDataUrl(file, options)
      }),
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
      isReadOnly: () => currentLayoutMode() === 'preview',
      labels: {
        noMatch: t('statusNoMatch'),
        found: t('statusFoundMatch'),
        replacedAll: count => t('statusReplacedCount', count)
      },
      getSearchOptions({ setStatus }) {
        if (!editorCommands.has('getFindSearchOptions')) return {};
        return editorCommands.invoke('getFindSearchOptions', setStatus);
      },
      onMatch(match) {
        if (editorCommands.has('afterFindMatch')) editorCommands.invoke('afterFindMatch', match);
      },
      commands: {
        findNext: (...args) => editorCommandService.findNext(...args),
        replaceOne: (...args) => currentLayoutMode() === 'preview' ? undefined : editorCommandService.replaceOne(...args),
        replaceAll: (...args) => currentLayoutMode() === 'preview' ? 0 : editorCommandService.replaceAll(...args)
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
      selection: editorSelectionService,
      commandRoots: [document.querySelector('.l-menu-bar')],
      commands: { execute: executeEditorAction },
      dialogs: { link: linkView, image: imageView, find: findView, mermaid: mermaidView, math: mathView },
      tableView,
      getLayoutMode: currentLayoutMode,
      onCustomizeToolbar: () => menuController.execute('settings.open', { page: 'toolbar' }),
      toolbarPreferences: {
        read: () => ({ density: settingsStore.get('toolbarDensity'), primaryItems: settingsStore.get('toolbarPrimaryItems'), hiddenItems: settingsStore.get('toolbarHiddenItems') }),
        subscribe: listener => {
          document.addEventListener(SETTINGS_CHANGED_EVENT, listener);
          return () => document.removeEventListener(SETTINGS_CHANGED_EVENT, listener);
        }
      },
      formatLayoutLabel(mode) {
        const keys = { both: 'view', hybrid: 'viewHybrid', edit: 'viewEdit', preview: 'viewPreview' };
        return t(keys[mode] || 'view');
      }
    });
    featureViews.push(toolbarView);

    const editorPaneView = createEditorPaneView({
      root: requireElement('.f-editor-pane', 'Editor pane'),
      editorElement: editorHost, editorApi: virtualEditor, i18n: i18nService,
      collapse: pane => splitPaneController.togglePane(pane),
      onSelectionChange() {
        inlineColorView.updateAvailability();
        toolbarView.refreshSelection();
        if (editorCommands.has('selectionChanged')) editorCommands.invoke('selectionChanged');
      }
    });
    featureViews.push(editorPaneView);

    const contextActions = createEditorContextActions({ editor: virtualEditor, clipboard: platform.clipboard,
      focus: () => editorFocusService.focus({ preventScroll: true }), runHistory: executeEditorAction,
      getDocumentId: () => documentSessionStore.activeId, isReadOnly: () => currentLayoutMode() === 'preview' });
    featureViews.push(contextActions);
    unregisterEditorViewCommands = editorCommands.register({
      captureTextContext: contextActions.capture,
      runTextContextAction: contextActions.execute,
      executeEditorAction,
      openLink: () => currentLayoutMode() !== 'preview' && linkView.open(),
      openImage: () => currentLayoutMode() !== 'preview' && imageView.open(),
      openFind: replace => findView.open(Boolean(replace)),
      openMermaid: () => currentLayoutMode() !== 'preview' && mermaidView.open(),
      insertTable: (rows, columns) => currentLayoutMode() !== 'preview' && tableView.insert(rows, columns),
      insertInlineMath: () => mathView.insertInline(),
      insertBlockMath: () => mathView.insertBlock(),
      refreshToolbarLayoutLabel: mode => toolbarView.refreshLayoutLabel(mode)
    });
  };

  const previewVirtualGeometry = Object.freeze({
    get active() { return Boolean(previewCommandHandler?.virtual?.active); },
    getMountedAnchors: () => previewCommandHandler?.virtual?.getMountedAnchors?.() || [],
    getMetrics: () => previewCommandHandler?.virtual?.getMetrics?.() || [],
    getContentYForLine: line => previewCommandHandler?.virtual?.getContentYForLine?.(line) ?? null,
    getLineForContentY: y => previewCommandHandler?.virtual?.getLineForContentY?.(y) ?? null,
    containsLineRange: (from, to) => previewCommandHandler?.virtual?.containsLineRange?.(from, to) ?? true,
    hasLineRangeMounted: (from, to) => previewCommandHandler?.virtual?.hasLineRangeMounted?.(from, to) ?? true,
    ensureLineRangeVisible: (from, to) => previewCommandHandler?.virtual?.ensureLineRangeVisible?.(from, to) ?? null,
    ensureLineVisible: line => previewCommandHandler?.virtual?.ensureLineVisible?.(line) ?? null
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
    componentMapping: createPreviewComponentMapping(),
    scrollController,
    documentRef: document,
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
    now: () => performance.now(),
    isHybridLayout: () => layoutState.snapshot.mode === 'hybrid',
    isGeometryChanging: () => layoutState.snapshot.resize.sidebarActive || layoutState.snapshot.resize.splitActive
      || layoutState.snapshot.resize.windowBurstEvents > 0,
    updateActiveLine: line => outlineController?.updateActiveLine?.(line),
    record: (operation, entry) => telemetry.record?.(operation, entry),
    diagnostic: (operation, entry) => telemetry.diagnostic?.(operation, entry)
  });

  try {
    previewRenderer = createPreviewRendererPort({
      root: previewHost,
      documentRef: document,
      documentModel,
      presentation: markdownPresentation,
      notify,
      record(operation, entry) { telemetry.record?.(operation, entry); },
      reportError(message, error) { console.error(message, error); }
    });
    previewRenderer.start();

    const previewShell = Object.freeze({
      getPreviewPerformanceMode() {
        if (!editorCommands.has('getPreviewRuntimeSettings')) return 'auto';
        return editorCommands.invoke('getPreviewRuntimeSettings')?.previewPerformanceMode || 'auto';
      },
      getEditorFontSize() {
        if (!editorCommands.has('getPreviewRuntimeSettings')) return 16;
        return editorCommands.invoke('getPreviewRuntimeSettings')?.editorFontSize || 16;
      },
      updatePreviewStrategyBadge(mode, stats) {
        if (editorCommands.has('updatePreviewStrategyBadge')) editorCommands.invoke('updatePreviewStrategyBadge', mode, stats);
      },
      updateDocumentStatistics(statistics) {
        if (editorCommands.has('updateDocumentStatistics')) editorCommands.invoke('updateDocumentStatistics', statistics);
      },
      persistCurrentDocumentIndex(headings, statistics) {
        if (editorCommands.has('persistCurrentDocumentIndex')) editorCommands.invoke('persistCurrentDocumentIndex', headings, statistics);
      },
      preparePreviewEditorMetrics() {
        if (editorCommands.has('preparePreviewEditorMetrics')) editorCommands.invoke('preparePreviewEditorMetrics');
      },
      invalidatePreviewAnchorMetrics() {
        if (editorCommands.has('invalidatePreviewAnchorMetrics')) editorCommands.invoke('invalidatePreviewAnchorMetrics');
      },
      invalidatePreviewAnchorStructure() {
        if (editorCommands.has('invalidatePreviewAnchorStructure')) editorCommands.invoke('invalidatePreviewAnchorStructure');
      },
      annotatePreviewSourceLines(source, tokens, blocks) {
        if (editorCommands.has('annotatePreviewSourceLines')) return editorCommands.invoke('annotatePreviewSourceLines', source, tokens, blocks);
        return null;
      },
      refreshPreviewAnchorStructure() {
        if (editorCommands.has('refreshPreviewAnchorStructure')) return editorCommands.invoke('refreshPreviewAnchorStructure');
        return null;
      },
      getPreviewAnchorMetrics() {
        return editorCommands.has('getPreviewAnchorMetrics') ? editorCommands.invoke('getPreviewAnchorMetrics') : [];
      },
      getPreviewAnchorCount() {
        return editorCommands.has('getPreviewAnchorCount') ? editorCommands.invoke('getPreviewAnchorCount') : 0;
      },
      scrollPreviewToLine(line, behavior, ratio) {
        if (editorCommands.has('scrollPreviewToLine')) return editorCommands.invoke('scrollPreviewToLine', line, behavior, ratio);
        return false;
      },
      requestAutoSave() {
        if (editorCommands.has('requestDocumentPersistence')) return editorCommands.invoke('requestDocumentPersistence', 'preview-shell');
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
      documentModel,
      documentSession: documentSessionStore,
      outline: outlineController,
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
      record(operation, entry) { telemetry.record?.(operation, entry); },
      diagnostic(operation, entry) { telemetry.diagnostic?.(operation, entry); }
    });
    previewController = createPreviewController({
      root: previewHost,
      editor: virtualEditor,
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
      selectionController,
      storage: window.localStorage
    });
    previewController.start();
    previewCommandHandler = createPreviewCommands(previewController);
    exportDocumentBuilder = createExportDocumentBuilder({
      documentRef: document, documentModel,
      getActiveDocumentId: () => documentSessionStore.activeId,
      preview: { capture: () => previewRenderEngine.captureExportSource() },
      presentation: markdownPresentation,
      createHtmlNodes: html => previewRenderer.createBlockNodes({ id: 'export-full', html }),
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: handle => window.cancelAnimationFrame(handle)
    });

    exportPreviewEnhancer = createExportPreviewEnhancer({
      documentRef: document, documentModel,
      getActiveDocumentId: () => documentSessionStore.activeId,
      builder: exportDocumentBuilder, presentation: markdownPresentation,
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: handle => window.cancelAnimationFrame(handle)
    });

    htmlExporter = createHtmlExporter({ documentModel, documents: documentController,
      builder: exportDocumentBuilder, enhancer: exportPreviewEnhancer, assets: htmlFontAssets,
      serializer: htmlDocumentSerializer, taskController: exportTaskController, fileWriter: exportFileWriter });

    wordExporter = createWordExporter({ documentModel, documents: documentController,
      builder: exportDocumentBuilder, enhancer: exportPreviewEnhancer, assets: htmlFontAssets,
      serializer: wordDocumentSerializer, taskController: exportTaskController, fileWriter: exportFileWriter });

    pdfPrintSurface = createPdfPrintSurface({ documentRef: document, styles: exportStyles,
      printWindow: frameWindow => createBrowserPrint({ windowObject: frameWindow }).print(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay), clearTimer: handle => window.clearTimeout(handle) });
    pdfExporter = createPdfExporter({ documentModel, documents: documentController,
      builder: exportDocumentBuilder, enhancer: exportPreviewEnhancer, assets: htmlFontAssets,
      surface: pdfPrintSurface, taskController: exportTaskController });

    imageExportSurface = createImageExportSurface({ documentRef: document,
      container: exportImageView.container, stage: exportImageView.stage, previewImage: exportImageView.previewImage,
      layout: imageExportLayout, styles: exportStyles, readStyle: root => window.getComputedStyle(root) });
    imageExporter = createImageExporter({ documentModel, documents: documentController,
      builder: exportDocumentBuilder, enhancer: exportPreviewEnhancer, assets: imageAssetPreloader,
      surface: imageExportSurface, encodeDataUrl: imageDataUrlToBytes, loadDomToImage,
      taskController: exportTaskController, fileWriter: exportFileWriter });

    exportController = createExportController({ requests: exportRequestPort, tasks: exportTaskController,
      owners: { markdown: markdownExporter, html: htmlExporter, word: wordExporter, pdf: pdfExporter, image: imageExporter },
      imageView: exportImageView, preview: previewCommandHandler,
      readInput: () => ({ name: document.getElementById('filename').value,
        directory: settingsStore.get('exportDirectory') }),
      notify, translate: t, reportError: error => console.error(error),
      now: () => performance.now(), record: (operation, entry) => telemetry.record?.(operation, entry) });

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
    unregisterPreviewEditorCommands = editorCommands.register({
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
        const contentY = virtualEditor.getScrollMetrics().top + virtualEditor.getScrollMetrics().clientHeight * 0.38;
        const sourceLine = editorScrollMapper.getLineAtContentY(contentY);
        const targetY = previewScrollMapper.getContentYForLine(sourceLine);
        scrollController.scheduleTarget('preview', targetY - previewHost.clientHeight * 0.38, { reason: 'linked-scroll' });
        outlineController?.updateActiveLine?.(Math.max(1, Math.floor(sourceLine)));
      },
      syncFromPreview: () => {
        const sourceLine = previewScrollMapper.getLineForContentY(previewHost.scrollTop + previewHost.clientHeight * 0.38);
        const targetY = editorScrollMapper.getContentYForLine(sourceLine);
        scrollController.scheduleTarget('editor', targetY - virtualEditor.getScrollMetrics().clientHeight * 0.38, { reason: 'linked-scroll' });
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
    configureMarkdownEditorE2EPorts({
      editorApi: virtualEditor,
      importDocument: (content, name) => documentCommands.invoke('importTextContent', name, content, ''),
      setLayout: mode => editorCommands.invoke('setLayoutMode', mode, false),
      readContext: () => {
        const state = documentModel.getState();
        return { documentId: state.documentId, generation: state.generation, version: state.version };
      },
      readPreviewStats: () => previewController?.getVirtualStats?.() || null
    });
    closeSavePort = createCloseSavePort();
    closeSaveController = createCloseSaveController({
      saveController,
      autosaveController,
      documentController,
      closeSavePort,
      readSaveContext: () => ({ title: documentModel.title }),
      async decideAfterFailure(error) {
        console.error('[DocumentLifecycle] close-save failed', error);
        const message = error instanceof Error
          ? error.message
          : String(error || '未知错误');
        return platform.dialogs.confirm(
          '关闭前保存失败：' + message + '\n\n仍然关闭软件吗？未保存的修改可能丢失。',
          {
            title: '关闭前保存失败',
            kind: 'warning',
            okLabel: '仍然关闭',
            cancelLabel: '返回编辑'
          }
        );
      }
    });
    closeSaveController.start();

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
        if (editorCommands.has('closeAppMenus')) editorCommands.invoke('closeAppMenus');
      },
      onGeometryChanged() { scrollController.notifyGeometryChanged(); },
      record(operation, entry) { telemetry.record?.(operation, entry); }
    });
    sidebarLayoutController.start();
    compactShellController.start();
    pageFullscreenController = createPageFullscreenController({
      state: layoutState,
      app: requireElement('.l-app-shell', 'Application shell'),
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
      formatGroup: requireElement('[data-ui-slot="toolbar"] .writing-mode-slot', 'Workspace mode group'),
      singleGroup: true,
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
      record(operation, entry) { telemetry.record?.(operation, entry); }
    });
    toolbarBoundaryController.start();
    unregisterLayoutUiCommands = editorCommands.register({
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
          telemetry.record?.('layout.system-fullscreen-error', {
            category: 'ui.layout',
            durationMs: 0,
            details: { message: String(result.error?.message || result.error || 'unknown') }
          });
        }
        return result;
      }
    });
    const editorPaneElement = requireElement('.f-editor-pane', 'Editor pane');
    const previewPaneElement = requireElement('.f-preview-pane', 'Preview pane');
    const splitResizerElement = requireElement('#resizer', 'Split resize handle');
    splitResizeController = createSplitResizeController({
      state: layoutState,
      main: requireElement('.l-split-pane', 'Main split layout'),
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
        if (!editorCommands.has('setLayoutMode')) throw new Error('Layout mode command is unavailable.');
        editorCommands.invoke('setLayoutMode', mode);
      },
      activateCompactPane: (pane, reason) => compactSplitController?.activatePane(pane, reason) || false,
      getCollapseLabel(pane, collapsed) {
        if (pane === 'editor') return t(collapsed ? 'expandEditor' : 'collapseEditor');
        return t(collapsed ? 'expandPreview' : 'collapsePreview');
      }
    });
    compactSplitController = createCompactSplitController({
      state: layoutState,
      main: requireElement('.l-split-pane', 'Main split layout'),
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

    splitResizeController.start();
    splitPaneController.start();
    compactSplitController.start();
    sidebarResizeController = createSidebarResizeController({
      state: layoutState,
      workspace: requireElement('.l-workspace', 'Workspace'),
      resizer: requireElement('#sidebar-resizer', 'Sidebar resize handle'),
      root: document.documentElement,
      body: document.body,
      storage: window.localStorage,
      viewport: window,
      matchMedia: typeof document.defaultView?.matchMedia === 'function'
        ? document.defaultView.matchMedia.bind(document.defaultView)
        : null,
      requestFrame: requestLayoutFrame,
      cancelFrame: cancelLayoutFrame,
      deferContentResize: () => virtualEditor.getTextLength() >= PREVIEW_BEHAVIOR_THRESHOLDS.mode.virtualChars,
      onGeometryChanged(event) { if (!event.active) scrollController.notifyGeometryChanged(); }
    });
    sidebarResizeController.start();
    const ownApplication = owner => { applicationLifetime.own(() => owner.destroy()); return owner; };
    const shellMenus = ownApplication(createShellMenus({
      document, window,
      toast: requireElement('#toast', 'Toast'),
      coreSubmenuPositionerPort: submenuPositioner,
      coreEditorUiCommandPort: editorCommands
    }));
    const workspaceStatus = ownApplication(createWorkspaceStatus({
      document,
      editor: virtualEditor,
      coreI18nPort: i18nService,
      corePreviewCommandPort: previewCommandHandler,
      coreSettingsStorePort: settingsStore,
      coreSaveStatusStorePort: saveStatusStore,
      coreDocumentSessionPort: documentSessionStore,
      coreLayoutStatePort: layoutState,
      coreEditorUiCommandPort: editorCommands,
      corePreviewStatePort: previewState
    }));
    const workspacePreferences = ownApplication(createWorkspacePreferences({
      document, window,
      editor: virtualEditor,
      preview: previewHost, documentModel,
      coreDocumentSessionPort: documentSessionStore,
      coreSettingsStorePort: settingsStore,
      coreEditorUiCommandPort: editorCommands,
      coreLayoutStatePort: layoutState,
      corePreviewCommandPort: previewCommandHandler,
      splitController: splitPaneController, compactSplitController, t,
      showToast: shellMenus.showToast,
      updateStatusBar: workspaceStatus.updateStatusBar,
      updateInlineColorToolAvailability: () => inlineColorView?.updateAvailability?.()
    }));
    const documentWorkspace = ownApplication(createDocumentWorkspace({
      document, window,
      editor: virtualEditor, documentModel,
      filenameInput: requireElement('#filename', 'Filename'),
      localStorage: documentStorage,
      navigator: window.navigator,
      prompt: (...args) => window.prompt(...args),
      confirm: (...args) => window.confirm(...args),
      nativeStore: nativeDocumentStore,
      t,
      showToast: shellMenus.showToast,
      corePlatformPort: platform,
      coreExportRequestPort: exportRequestPort,
      coreMarkdownExportPort: markdownExporter,
      coreExportTaskPort: exportTaskController,
      coreSettingsStorePort: settingsStore,
      coreDocumentSessionPort: documentSessionStore,
      coreDocumentControllerPort: documentController,
      coreRecentFilesPort: recentFilesRepository,
      coreDocumentUiCommandPort: documentCommands,
      coreEditorUiCommandPort: editorCommands,
      coreSidebarControllerPort: sidebarTabController,
      coreOutlineControllerPort: outlineController,
      coreFolderTreeControllerPort: folderTreeController,
      corePreviewCommandPort: previewCommandHandler,
      coreTaskSchedulerPort: backgroundTaskScheduler,
      coreSaveStatusStorePort: saveStatusStore
    }));
    notifyLinkPreview = shellMenus.showToast;
    readLinkDocumentContext = () => {
      const record = documentWorkspace.getCurrentDocument();
      return { documentId: String(record?.id || ''), filePath: String(record?.filePath || ''), title: String(record?.title || readCurrentDocumentTitle() || '') };
    };
    applicationLifetime.own(() => { notifyLinkPreview = () => {}; readLinkDocumentContext = () => ({}); });
    applicationLifetime.own(editorCommands.register({
      updatePreviewStrategyBadge: workspaceStatus.updatePreviewStrategyBadge
    }));
    ownApplication(createFindPreviewCommands({
      nativeStore: nativeDocumentStore, documentModel,
      getCurrentDocument: documentWorkspace.getCurrentDocument,
      saveDocument: () => documentController.saveActive({
        title: readCurrentDocumentTitle(),
        fallbackTitle: t('filenameDefault'),
        snapshotReason: 'find-native-search'
      }),
      webClipperEditorUiCommandPort: editorCommands,
      webClipperPreviewCommandPort: previewCommandHandler,
      requestAnimationFrame: callback => window.requestAnimationFrame(callback),
      cancelAnimationFrame: id => window.cancelAnimationFrame(id)
    }));
    ownApplication(createApplicationEvents({
      document, window,
      editor: editorHost, editorApi: virtualEditor,
      eventsEditorControllerPort: editorController,
      eventsEditorUiCommandPort: editorCommands,
      eventsPreviewCommandPort: previewCommandHandler,
      eventsDocumentUiCommandPort: documentCommands,
      ensureCurrentDocumentForEditing: documentWorkspace.ensureCurrentDocumentForEditing,
      updateLargeDocumentMode: workspaceStatus.updateLargeDocumentMode,
      closeAppMenus: shellMenus.closeAppMenus,
      closeContextMenus: shellMenus.closeContextMenus,
      showToast: shellMenus.showToast,
      newDocument: documentWorkspace.newDocument,
      toggleSidebar: workspacePreferences.toggleSidebar,
      renameCurrentDocument: documentWorkspace.renameCurrentDocument
    }));
    const workspaceStartup = ownApplication(createWorkspaceStartup({
      editor: virtualEditor,
      preview: previewHost,
      filenameInput: requireElement('#filename', 'Filename'), t,
      localStorage: window.localStorage,
      platform: platform,
      documentCommands: documentCommands,
      bootstrapSettingsStorePort: settingsStore,
      bootstrapEditorControllerPort: editorController,
      bootstrapLayoutStatePort: layoutState,
      bootstrapPreviewCommandPort: previewCommandHandler,
      bootstrapHelpPort: helpController, ...workspacePreferences,
      setupDocuments: documentWorkspace.setupDocuments,
      updateStatusBar: workspaceStatus.updateStatusBar,
      updateLargeDocumentMode: workspaceStatus.updateLargeDocumentMode,
      refreshClassicLocalizedState: workspaceStatus.refreshClassicLocalizedState
    }));
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
      target: requireElement('.l-menu-bar', 'Window drag region'),
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
      record(operation, entry) { telemetry.record?.(operation, entry); },
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
    if (!await workspaceStartup.start()) throw new Error('Application startup cancelled.');
    return Object.freeze({ exportCommands: exportController, recentFiles: recentFilesRepository });
  } catch (error) {
    destroyDocumentFeatures();
    throw error;
  }
}

const actions = await loadAppModules();
return Object.freeze({ ...actions,
  activate() {
    if (!startupLifetime.alive) throw new Error('Application is destroyed.');
    document.documentElement.classList.add('app-ready');
    installMarkdownEditorE2EBridge();
    telemetry.record('app.ready', { category: 'app.lifecycle', durationMs: performance.now(), details: { documentReadyState: document.readyState } });
  },
  destroy: startupLifetime.destroy
});
} catch (error) {
  try { startupLifetime.destroy(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Application startup and cleanup failed.'); }
  throw error;
}
}
