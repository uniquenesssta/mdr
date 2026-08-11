/**
 * Responsibility: Own split-pane collapse state, pane/resizer collapsed presentation and collapse persistence.
 * Imports: None; LayoutState and compact/mode requests are injected explicitly.
 * Exports: createSplitPaneController() plus stable pane-collapse storage keys.
 * State/side effects: Writes canonical LayoutState split collapse fields, pane/resizer classes, collapse-button presentation and local storage.
 * Lifecycle: Explicit start/destroy; preview collapse listener is owned and removed here.
 */
export const EDITOR_COLLAPSED_STORAGE_KEY = 'md_editor_editor_collapsed';
export const PREVIEW_COLLAPSED_STORAGE_KEY = 'md_editor_preview_collapsed';

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createSplitPaneController({
  state,
  editorPane,
  previewPane,
  resizer,
  editorCollapseButton,
  previewCollapseButton,
  storage,
  requestLayoutMode = () => {},
  activateCompactPane = () => false,
  getCollapseLabel = () => ''
} = {}) {
  requireObject(state, 'Split Pane LayoutState');
  requireFunction(state.setSplit, 'LayoutState.setSplit');
  for (const [value, label] of [
    [editorPane, 'editor pane'], [previewPane, 'preview pane'], [resizer, 'split resizer'],
    [editorCollapseButton, 'editor collapse button'], [previewCollapseButton, 'preview collapse button'],
    [storage, 'split pane storage']
  ]) requireObject(value, `Split Pane ${label}`);
  requireFunction(previewCollapseButton.addEventListener, 'Split Pane preview button addEventListener');
  requireFunction(previewCollapseButton.removeEventListener, 'Split Pane preview button removeEventListener');
  requireFunction(storage.getItem, 'Split Pane storage getItem');
  requireFunction(storage.setItem, 'Split Pane storage setItem');
  requireFunction(requestLayoutMode, 'Split Pane layout-mode request');
  requireFunction(activateCompactPane, 'Split Pane compact-pane activation');
  requireFunction(getCollapseLabel, 'Split Pane collapse label');

  let started = false;
  let destroyed = false;

  const snapshot = () => state.snapshot;

  function persist() {
    const split = snapshot().split;
    storage.setItem(EDITOR_COLLAPSED_STORAGE_KEY, split.editorCollapsed ? 'true' : 'false');
    storage.setItem(PREVIEW_COLLAPSED_STORAGE_KEY, split.previewCollapsed ? 'true' : 'false');
  }

  function updateButton(button, pane, collapsed, collapsedIcon, expandedIcon) {
    const use = button.querySelector?.('use');
    use?.setAttribute?.('href', collapsed ? collapsedIcon : expandedIcon);
    const label = String(getCollapseLabel(pane, collapsed) || '');
    if (label) {
      button.setAttribute?.('title', label);
      button.setAttribute?.('aria-label', label);
    }
    button.setAttribute?.('aria-expanded', collapsed ? 'false' : 'true');
  }

  function project() {
    const split = snapshot().split;
    editorPane.classList?.toggle('collapsed', split.editorCollapsed);
    editorPane.classList?.toggle('is-collapsed', split.editorCollapsed);
    previewPane.classList?.toggle('collapsed', split.previewCollapsed);
    previewPane.classList?.toggle('is-collapsed', split.previewCollapsed);
    const hidden = split.editorCollapsed || split.previewCollapsed;
    resizer.classList?.toggle('hidden', hidden);
    resizer.classList?.toggle('is-hidden', hidden);
    updateButton(
      editorCollapseButton,
      'editor',
      split.editorCollapsed,
      '/assets/icons.svg#icon-chevron-right',
      '/assets/icons.svg#icon-chevron-left'
    );
    updateButton(
      previewCollapseButton,
      'preview',
      split.previewCollapsed,
      '/assets/icons.svg#icon-chevron-left',
      '/assets/icons.svg#icon-chevron-right'
    );
    return split;
  }

  function setCollapsed({ editorCollapsed, previewCollapsed }, reason = 'pane-state') {
    if (destroyed) throw new Error('Split Pane Controller is destroyed.');
    const current = snapshot().split;
    const nextEditor = editorCollapsed === undefined ? current.editorCollapsed : Boolean(editorCollapsed);
    const nextPreview = previewCollapsed === undefined ? current.previewCollapsed : Boolean(previewCollapsed);
    if (nextEditor && nextPreview) throw new RangeError('Split panes cannot both be collapsed.');
    state.setSplit({ editorCollapsed: nextEditor, previewCollapsed: nextPreview });
    persist();
    project();
    return Object.freeze({ reason, editorCollapsed: nextEditor, previewCollapsed: nextPreview });
  }

  function applyMode(mode, { resetCompactPane = false } = {}) {
    const normalized = String(mode || 'both');
    let next;
    if (normalized === 'edit' || normalized === 'hybrid') next = { editorCollapsed: false, previewCollapsed: true };
    else if (normalized === 'preview') next = { editorCollapsed: true, previewCollapsed: false };
    else next = { editorCollapsed: false, previewCollapsed: false };
    const result = setCollapsed(next, `layout-mode:${normalized}`);
    return Object.freeze({ ...result, resetCompactPane: Boolean(resetCompactPane) });
  }

  function togglePane(pane, reason = 'collapse-button') {
    if (destroyed) throw new Error('Split Pane Controller is destroyed.');
    const target = pane === 'preview' ? 'preview' : 'editor';
    const current = snapshot();
    if (current.mode === 'hybrid') {
      const requestedMode = target === 'editor' ? 'preview' : 'both';
      requestLayoutMode(requestedMode);
      return Object.freeze({ changed: false, requestedMode });
    }
    if (current.split.compactActive && current.mode === 'both') {
      const collapsed = target === 'editor' ? current.split.editorCollapsed : current.split.previewCollapsed;
      const nextPane = collapsed ? target : (target === 'editor' ? 'preview' : 'editor');
      const changed = Boolean(activateCompactPane(nextPane, `toggle:${target}`));
      return Object.freeze({ changed, compactPane: nextPane });
    }
    if (target === 'editor') {
      if (!current.split.editorCollapsed && current.split.previewCollapsed) return Object.freeze({ changed: false });
      setCollapsed({ editorCollapsed: !current.split.editorCollapsed }, `pane:${target}`);
    } else {
      if (!current.split.previewCollapsed && current.split.editorCollapsed) return Object.freeze({ changed: false });
      setCollapsed({ previewCollapsed: !current.split.previewCollapsed }, `pane:${target}`);
    }
    return Object.freeze({ changed: true });
  }

  function restore() {
    const editorStored = storage.getItem(EDITOR_COLLAPSED_STORAGE_KEY) === 'true';
    const previewStored = storage.getItem(PREVIEW_COLLAPSED_STORAGE_KEY) === 'true';
    const safe = editorStored && previewStored
      ? { editorCollapsed: false, previewCollapsed: true }
      : { editorCollapsed: editorStored, previewCollapsed: previewStored };
    state.setSplit(safe);
    project();
    return safe;
  }

  function onPreviewCollapse(event) {
    event?.preventDefault?.();
    togglePane('preview');
  }

  const controller = Object.freeze({
    start() {
      if (destroyed) throw new Error('Split Pane Controller is destroyed.');
      if (started) return controller;
      restore();
      previewCollapseButton.addEventListener('click', onPreviewCollapse);
      started = true;
      return controller;
    },
    togglePane,
    setCollapsed,
    applyMode,
    project,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started) previewCollapseButton.removeEventListener('click', onPreviewCollapse);
      started = false;
    }
  });
  return controller;
}
