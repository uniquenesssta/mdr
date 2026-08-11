import './styles/index.css';
import './runtime/vendor.js';
import { createPlatform, mountClassicPlatformPort } from './platform/index.js';
import { configureLinkPreviewPlatform } from './runtime/link-preview.js';
import { configurePerformancePlatform } from './runtime/performance.js';
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
  IncrementalPreviewModel,
  selectionMappingApi
} from './model-kernel/index.js';
import { createPreviewWorkerClient } from './preview/preview-worker-client.js';
import { createVirtualPreviewController } from './preview/virtual-preview.js';
import { createPreviewEnhancementQueue } from './preview/enhancement-queue.js';
import { createNativeDocumentStore } from './storage/native-document-store.js';
import { createTaskScheduler } from './runtime/task-scheduler.js';
import { createScrollSyncController } from './sync/scroll-controller.js';
import { createSelectionSyncController } from './sync/selection-controller.js';
import { createMarkdownPresentationApi } from './rendering/presentation-api.js';
import { installMarkdownEditorE2EBridge } from './runtime/e2e-bridge.js';
import { createFolderFileTreeController } from './sidebar/folder-file-tree.js';
import { configureHybridImageSourcePlatform } from './editor/hybrid/image-source.js';
import {
  createDocumentContextMenuView,
  createDocumentListView,
  createDocumentSessionController,
  createDocumentTitleView,
  createRecentFilesRepository,
  createSessionDocumentRepository,
  mountClassicDocumentControllerPort,
  mountClassicDocumentUiCommandPort,
  mountClassicRecentFilesPort
} from './features/documents/index.js';

const platform = createPlatform({
  runtime: window,
  now: () => performance.now(),
  record: (operation, entry) => window.markdownEditorPerf?.record?.(operation, entry)
});
const compatibilityPlatformHost = document.getElementById('compatibility-business-ports');
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
  enabled: platform.capabilities.desktop.fileSystem
});
document.documentElement.classList.toggle('tauri-shell', platform.capabilities.isDesktop);
window.addEventListener('pagehide', () => {
  destroyLayoutStateFeature();
  compatibilityPlatformPort.destroy();
  void platform.destroy().catch(error => console.warn('Platform cleanup failed:', error));
}, { once: true });

window.markdownEditorSelectionMapping = selectionMappingApi;
window.markdownEditorPresentation = createMarkdownPresentationApi();
window.markdownEditorCodeHighlighter = window.markdownEditorPresentation.code;
window.markdownEditorMath = window.markdownEditorPresentation.math;

if (typeof document.startViewTransition === 'function') {
  document.documentElement.classList.add('view-transitions-supported');
}

const APP_MODULES = [
  '/app/core.js',
  '/app/scroll-sync.js',
  '/app/bootstrap.js',
  '/app/preview.js',
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
  const virtualEditor = createVirtualEditor(editorHost);
  const previewHost = document.getElementById('preview');
  if (!previewHost) throw new Error('Preview host is missing');
  const scrollController = createScrollSyncController(editorHost, previewHost);
  window.markdownEditorScrollController = scrollController;
  window.markdownEditorScrollSync = scrollController.getPublicApi();
  window.markdownEditorSelectionController = createSelectionSyncController(editorHost, previewHost);
  const documentModel = createDocumentModel(editorHost);
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
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }
  window.markdownEditorDocumentModel = documentModel;
  window.IncrementalPreviewModel = IncrementalPreviewModel;
  window.createPreviewWorkerClient = createPreviewWorkerClient;
  window.createVirtualPreviewController = createVirtualPreviewController;
  window.createPreviewEnhancementQueue = createPreviewEnhancementQueue;
  window.markdownEditorTaskScheduler = createTaskScheduler();
  window.markdownEditorDocumentStore = createNativeDocumentStore({
    documentStore: platform.documentStore,
    available: platform.capabilities.desktop.documentStore
  });

  const documentSessionPort = compatibilityPlatformHost?.markdownEditorDocumentSessionPort;
  if (!documentSessionPort) throw new Error('Document session compatibility port is unavailable.');
  const documentRepository = createSessionDocumentRepository({
    storage: window.localStorage,
    nativeStore: window.markdownEditorDocumentStore,
    scheduleCleanup(task) {
      const scheduler = window.markdownEditorTaskScheduler;
      if (scheduler?.schedule) return scheduler.schedule('document-session-cleanup-' + Date.now(), task, {
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
  let recentFilesPort;
  let documentUiCommandPort;
  try {
    recentFilesPort = mountClassicRecentFilesPort(compatibilityPlatformHost, recentFilesRepository);
    documentUiCommandPort = mountClassicDocumentUiCommandPort(compatibilityPlatformHost);
  } catch (error) {
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
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }

  const featureViews = [];
  let unregisterEditorViewCommands = null;
  let unregisterLayoutUiCommands = null;
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
    unregisterLayoutUiCommands?.();
    unregisterLayoutUiCommands = null;
    splitControllerPort?.destroy();
    splitControllerPort = null;
    destroyLayoutInteractionControllers();
    destroyDocumentEditorViews();
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
    documentModel.destroy();
    virtualEditor.destroy();
  };
  window.addEventListener('pagehide', destroyDocumentFeatures, { once: true });

  window.markdownEditorFileTree = createFolderFileTreeController({
    files: platform.files,
    available: platform.capabilities.desktop.fileSystem,
    getCurrentContext: () => window.markdownEditorRuntimeContext?.getCurrentDocumentContext?.() || {},
    openFile: async path => {
      if (typeof window.openFolderTreeFile === 'function') return window.openFolderTreeFile(path);
      if (typeof window.handleNativeDroppedPath === 'function') return window.handleNativeDroppedPath(path);
      return false;
    }
  });

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

  try {
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
