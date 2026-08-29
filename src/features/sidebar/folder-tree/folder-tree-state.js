/**
 * Responsibility: Authoritative in-memory Folder Tree runtime state, including expansion state.
 * Imports: Native path normalization only.
 * Exports: createFolderTreeState.
 * State/side effects: Owns active/loading/current paths/tree/error/expanded directories and synchronous subscribers.
 * Lifecycle: Explicit destroy clears subscribers and state; terminal after destroy.
 */
import { normalizeNativePath } from './folder-tree-path-policy.js';

function freezeSnapshot(state, expandedDirectories) {
  return Object.freeze({
    active: state.active,
    loading: state.loading,
    currentDocumentPath: state.currentDocumentPath,
    currentDirectoryPath: state.currentDirectoryPath,
    tree: state.tree,
    errorMessage: state.errorMessage,
    fileCount: state.tree?.fileCount || 0,
    truncated: Boolean(state.tree?.truncated),
    expandedDirectories: Object.freeze(Array.from(expandedDirectories))
  });
}

export function createFolderTreeState() {
  let destroyed = false;
  let state = {
    active: false,
    loading: false,
    currentDocumentPath: '',
    currentDirectoryPath: '',
    tree: null,
    errorMessage: ''
  };
  const expandedDirectories = new Set();
  const listeners = new Set();
  let snapshot = freezeSnapshot(state, expandedDirectories);

  const assertActive = () => {
    if (destroyed) throw new Error('FolderTreeState is destroyed.');
  };
  const publish = (reason, previous) => {
    snapshot = freezeSnapshot(state, expandedDirectories);
    for (const listener of Array.from(listeners)) listener(snapshot, previous, Object.freeze({ reason }));
  };
  const update = (patch, reason) => {
    assertActive();
    const previous = snapshot;
    state = { ...state, ...patch };
    publish(reason, previous);
    return snapshot;
  };

  return Object.freeze({
    get snapshot() {
      assertActive();
      return snapshot;
    },
    setActive(active, reason = 'active') {
      return update({ active: Boolean(active) }, reason);
    },
    setLoading(loading, reason = 'loading') {
      return update({ loading: Boolean(loading) }, reason);
    },
    setDocumentPath(path, reason = 'document-path') {
      return update({ currentDocumentPath: String(path || '').trim() }, reason);
    },
    setTree(tree, directoryPath, reason = 'tree') {
      return update({
        tree: tree || null,
        currentDirectoryPath: String(directoryPath || '').trim(),
        errorMessage: ''
      }, reason);
    },
    clearTree(directoryPath = '', reason = 'clear-tree') {
      return update({ tree: null, currentDirectoryPath: String(directoryPath || '').trim(), errorMessage: '' }, reason);
    },
    setError(message, directoryPath = '', reason = 'error') {
      return update({
        tree: null,
        currentDirectoryPath: String(directoryPath || '').trim(),
        errorMessage: String(message || '')
      }, reason);
    },
    isDirectoryExpanded(path, depth = 0) {
      assertActive();
      const normalized = normalizeNativePath(path);
      return Boolean(normalized && expandedDirectories.has(normalized)) || Number(depth) === 0;
    },
    setDirectoryExpanded(path, expanded, reason = 'directory-expanded') {
      assertActive();
      const normalized = normalizeNativePath(path);
      if (!normalized) return snapshot;
      const previous = snapshot;
      if (expanded) expandedDirectories.add(normalized);
      else expandedDirectories.delete(normalized);
      publish(reason, previous);
      return snapshot;
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('FolderTreeState listener must be a function.');
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      expandedDirectories.clear();
      state = { active: false, loading: false, currentDocumentPath: '', currentDirectoryPath: '', tree: null, errorMessage: '' };
    }
  });
}
