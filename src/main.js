import './styles/index.css';
import './runtime/vendor.js';
import './runtime/tauri.js';
import './runtime/link-preview.js';
import './runtime/performance.js';
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
  createVirtualEditor(editorHost);
  const previewHost = document.getElementById('preview');
  if (!previewHost) throw new Error('Preview host is missing');
  window.markdownEditorScrollController = createScrollSyncController(editorHost, previewHost);
  window.markdownEditorScrollSync = window.markdownEditorScrollController.getPublicApi();
  window.markdownEditorSelectionController = createSelectionSyncController(editorHost, previewHost);
  window.markdownEditorDocumentModel = createDocumentModel(editorHost);
  window.IncrementalPreviewModel = IncrementalPreviewModel;
  window.createPreviewWorkerClient = createPreviewWorkerClient;
  window.createVirtualPreviewController = createVirtualPreviewController;
  window.createPreviewEnhancementQueue = createPreviewEnhancementQueue;
  window.markdownEditorTaskScheduler = createTaskScheduler();
  window.markdownEditorDocumentStore = createNativeDocumentStore();
  window.markdownEditorFileTree = createFolderFileTreeController({
    nativeApi: window.markdownEditorNative,
    getCurrentContext: () => window.markdownEditorRuntimeContext?.getCurrentDocumentContext?.() || {},
    openFile: async path => {
      if (typeof window.openFolderTreeFile === 'function') return window.openFolderTreeFile(path);
      if (typeof window.handleNativeDroppedPath === 'function') return window.handleNativeDroppedPath(path);
      return false;
    }
  });

  for (const src of APP_MODULES) {
    await loadClassicScript(src);
  }
  if (window.__markdownEditorInitPromise) await window.__markdownEditorInitPromise;
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
