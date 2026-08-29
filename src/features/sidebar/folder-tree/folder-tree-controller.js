/**
 * Responsibility: Orchestrate Folder Tree lifecycle, platform-port reads, stale-result rejection, file-open coordination and telemetry.
 * Imports: Pure normalization/path policies only; state/view/platform dependencies are injected.
 * Exports: createFolderTreeController.
 * State/side effects: Owns request generation and lifecycle only; FolderTreeState owns runtime data and expansion state.
 * Lifecycle: Explicit start/activate/deactivate/destroy; destroy invalidates in-flight reads and tears down injected state/view.
 */
import { normalizeFolderTreeResult } from './folder-tree-normalizer.js';
import { getNativeParentPath, isNativePathWithinDirectory, isSameNativePath } from './folder-tree-path-policy.js';

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createFolderTreeController({
  state,
  view,
  files = null,
  available = false,
  getCurrentContext,
  openFile,
  now = () => 0,
  record = () => {},
  reportError = () => {}
} = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('FolderTreeController requires state.');
  if (!view || typeof view !== 'object') throw new TypeError('FolderTreeController requires view.');
  for (const method of ['setActive', 'setLoading', 'setDocumentPath', 'setTree', 'clearTree', 'setError', 'isDirectoryExpanded', 'setDirectoryExpanded', 'destroy']) {
    requiredFunction(state[method], `FolderTreeState.${method}`);
  }
  for (const method of ['start', 'render', 'updateHeader', 'updateActive', 'destroy']) {
    requiredFunction(view[method], `FolderTreeView.${method}`);
  }
  const desktopAvailable = Boolean(available);
  if (desktopAvailable && typeof files?.listTextTree !== 'function') {
    throw new TypeError('FolderTreeController requires files.listTextTree() when desktop file access is enabled.');
  }
  requiredFunction(getCurrentContext, 'getCurrentContext');
  requiredFunction(openFile, 'openFile');
  requiredFunction(now, 'now');
  requiredFunction(record, 'record');
  requiredFunction(reportError, 'reportError');

  let started = false;
  let destroyed = false;
  let requestGeneration = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('FolderTreeController is destroyed.');
  };
  const snapshot = () => state.snapshot;
  const project = () => view.render(snapshot());
  const recordSafe = (operation, entry) => {
    try { record(operation, entry); }
    catch (error) { reportError(`Folder Tree telemetry failed: ${operation}`, error); }
  };

  async function refresh(force = false) {
    assertActive();
    if (!started) throw new Error('FolderTreeController must be started before refresh().');
    const context = getCurrentContext() || {};
    const documentPath = String(context.filePath || '').trim();
    const directoryPath = getNativeParentPath(documentPath);
    state.setDocumentPath(documentPath, 'refresh-context');

    if (!desktopAvailable || typeof files?.listTextTree !== 'function') {
      requestGeneration += 1;
      state.setLoading(false, 'refresh-unavailable');
      state.clearTree('', 'refresh-unavailable');
      project();
      return null;
    }
    if (!documentPath || !directoryPath) {
      requestGeneration += 1;
      state.setLoading(false, 'refresh-no-document');
      state.clearTree('', 'refresh-no-document');
      project();
      return null;
    }

    const current = snapshot();
    if (!force && current.tree && isNativePathWithinDirectory(documentPath, current.currentDirectoryPath)) {
      view.updateActive(documentPath);
      view.updateHeader(snapshot());
      return current.tree;
    }

    const generation = ++requestGeneration;
    state.setLoading(true, 'refresh-start');
    state.clearTree(current.currentDirectoryPath, 'refresh-start-clear-error');
    state.setLoading(true, 'refresh-start-project');
    project();
    const startedAt = now();
    try {
      const result = await files.listTextTree(documentPath);
      if (destroyed || generation !== requestGeneration) return null;
      const tree = normalizeFolderTreeResult(result);
      const rootPath = tree.rootPath || directoryPath;
      state.setTree(tree, rootPath, 'refresh-success');
      state.setLoading(false, 'refresh-success');
      recordSafe('sidebar.file-tree-loaded', {
        category: 'sidebar.file-tree',
        durationMs: now() - startedAt,
        status: tree.truncated ? 'partial' : 'ok',
        details: {
          rootPath,
          files: tree.fileCount,
          directories: tree.directoryCount,
          skipped: tree.skippedCount,
          truncated: tree.truncated
        }
      });
      project();
      return tree;
    } catch (error) {
      if (destroyed || generation !== requestGeneration) return null;
      state.setError(error?.message || '无法读取当前文件夹', directoryPath, 'refresh-error');
      state.setLoading(false, 'refresh-error');
      recordSafe('sidebar.file-tree-load-error', {
        category: 'sidebar.file-tree',
        durationMs: now() - startedAt,
        status: 'error',
        details: { rootPath: directoryPath, error: error?.message || String(error) }
      });
      project();
      return null;
    }
  }

  function syncCurrentDocument(context = getCurrentContext()) {
    assertActive();
    if (!started) throw new Error('FolderTreeController must be started before syncCurrentDocument().');
    const nextPath = String(context?.filePath || '').trim();
    const nextDirectory = getNativeParentPath(nextPath);
    const current = snapshot();
    const insideCurrentRoot = isNativePathWithinDirectory(nextPath, current.currentDirectoryPath);
    const directoryChanged = Boolean(nextDirectory) && !insideCurrentRoot;
    state.setDocumentPath(nextPath, 'sync-document');
    if (!snapshot().active) {
      view.updateHeader(snapshot());
      return;
    }
    if (!nextPath || directoryChanged || !snapshot().tree) {
      void refresh(directoryChanged);
      return;
    }
    view.updateActive(nextPath);
    view.updateHeader(snapshot());
  }

  async function openTreeFile(path) {
    assertActive();
    const target = String(path || '').trim();
    if (!target || isSameNativePath(target, snapshot().currentDocumentPath)) return false;
    const opened = await openFile(target);
    if (destroyed) return false;
    if (opened !== false) {
      state.setDocumentPath(target, 'open-file');
      view.updateActive(target);
      view.updateHeader(snapshot());
      return true;
    }
    return false;
  }

  return Object.freeze({
    start() {
      assertActive();
      if (started) return;
      view.start({
        refresh,
        isDirectoryExpanded: (path, depth) => state.isDirectoryExpanded(path, depth),
        toggleDirectory(path, expanded) { state.setDirectoryExpanded(path, expanded); },
        openFile: openTreeFile
      });
      started = true;
      project();
    },
    activate() {
      assertActive();
      if (!started) throw new Error('FolderTreeController must be started before activate().');
      state.setActive(true, 'activate');
      return refresh(false);
    },
    deactivate() {
      assertActive();
      if (!started) return;
      requestGeneration += 1;
      state.setLoading(false, 'deactivate');
      state.setActive(false, 'deactivate');
      view.updateHeader(snapshot());
    },
    refresh,
    syncCurrentDocument,
    get snapshot() {
      assertActive();
      return snapshot();
    },
    getState() {
      assertActive();
      const current = snapshot();
      return Object.freeze({
        active: current.active,
        loading: current.loading,
        currentDocumentPath: current.currentDocumentPath,
        currentDirectoryPath: current.currentDirectoryPath,
        fileCount: current.fileCount,
        truncated: current.truncated
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestGeneration += 1;
      try { view.destroy(); }
      finally { state.destroy(); }
      started = false;
    }
  });
}
