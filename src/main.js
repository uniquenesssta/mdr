import './styles/index.css';
import './runtime/vendor.js';
import { createPlatform, mountClassicPlatformPort } from './platform/index.js';
import { configureLinkPreviewPlatform } from './runtime/link-preview.js';
import { configurePerformancePlatform } from './runtime/performance.js';
import { createVirtualEditor } from './editor/virtual-editor.js';
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
  createDocumentSessionController,
  createRecentFilesRepository,
  createSessionDocumentRepository,
  mountClassicDocumentControllerPort,
  mountClassicRecentFilesPort
} from './features/documents/index.js';

const platform = createPlatform({
  runtime: window,
  now: () => performance.now(),
  record: (operation, entry) => window.markdownEditorPerf?.record?.(operation, entry)
});
const compatibilityPlatformHost = document.getElementById('compatibility-business-ports');
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

async function loadAppModules() {
  const editorHost = document.getElementById('editor');
  if (!editorHost) throw new Error('Editor host is missing');
  const virtualEditor = createVirtualEditor(editorHost);
  const previewHost = document.getElementById('preview');
  if (!previewHost) throw new Error('Preview host is missing');
  window.markdownEditorScrollController = createScrollSyncController(editorHost, previewHost);
  window.markdownEditorScrollSync = window.markdownEditorScrollController.getPublicApi();
  window.markdownEditorSelectionController = createSelectionSyncController(editorHost, previewHost);
  const documentModel = createDocumentModel(editorHost);
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
  try {
    recentFilesPort = mountClassicRecentFilesPort(compatibilityPlatformHost, recentFilesRepository);
  } catch (error) {
    recentFilesRepository.destroy();
    documentControllerPort.destroy();
    documentController.destroy();
    documentRepository.destroy();
    documentModel.destroy();
    virtualEditor.destroy();
    throw error;
  }
  let documentFeaturesDestroyed = false;
  const destroyDocumentFeatures = () => {
    if (documentFeaturesDestroyed) return;
    documentFeaturesDestroyed = true;
    recentFilesPort.destroy();
    recentFilesRepository.destroy();
    documentControllerPort.destroy();
    documentController.destroy();
    documentRepository.destroy();
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

  try {
    for (const src of APP_MODULES) {
      await loadClassicScript(src);
    }
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
  console.error(error);
  const status = document.getElementById('status');
  if (status) status.textContent = error.message;
});