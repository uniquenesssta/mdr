/**
 * Responsibility: Own compact split entry/exit hysteresis, mutually-exclusive compact pane selection and collapsed-pane activation gestures.
 * Imports: The shared responsive breakpoint policy only.
 * Exports: createCompactSplitController().
 * State/side effects: Writes canonical LayoutState compact split fields and compact split CSS classes; delegates collapse projection to SplitPaneController.
 * Lifecycle: Explicit start/destroy; ResizeObserver/viewport fallback, RAF and pane listeners are all cleaned.
 */
import { getCompactSplitMaxWidth } from '../shell/responsive-breakpoints.js';

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createCompactSplitController({
  state,
  main,
  editorPane,
  previewPane,
  paneController,
  viewport,
  createResizeObserver = null,
  requestFrame,
  cancelFrame
} = {}) {
  requireObject(state, 'Compact Split LayoutState');
  requireFunction(state.setSplit, 'LayoutState.setSplit');
  requireObject(main, 'Compact Split main');
  requireObject(editorPane, 'Compact Split editor pane');
  requireObject(previewPane, 'Compact Split preview pane');
  requireObject(paneController, 'Compact Split pane controller');
  requireFunction(paneController.setCollapsed, 'SplitPaneController.setCollapsed');
  requireObject(viewport, 'Compact Split viewport');
  requireFunction(viewport.addEventListener, 'Compact Split viewport addEventListener');
  requireFunction(viewport.removeEventListener, 'Compact Split viewport removeEventListener');
  requireFunction(requestFrame, 'Compact Split requestFrame');
  requireFunction(cancelFrame, 'Compact Split cancelFrame');
  if (createResizeObserver !== null) requireFunction(createResizeObserver, 'Compact Split ResizeObserver factory');

  let started = false;
  let destroyed = false;
  let observer = null;
  let evaluationFrame = 0;

  const snapshot = () => state.snapshot;
  const width = () => Math.max(0, Number(main.getBoundingClientRect?.().width) || Number(main.clientWidth) || 0);

  function setClass(active) {
    main.classList?.toggle('compact-split', Boolean(active));
    main.classList?.toggle('is-compact-split', Boolean(active));
  }

  function activatePane(pane, reason = 'compact-pane') {
    if (destroyed) throw new Error('Compact Split Controller is destroyed.');
    const current = snapshot();
    if (!current.split.compactActive || current.mode !== 'both') return false;
    const nextPane = pane === 'preview' ? 'preview' : 'editor';
    const alreadyActive = nextPane === 'editor'
      ? !current.split.editorCollapsed && current.split.previewCollapsed
      : current.split.editorCollapsed && !current.split.previewCollapsed;
    state.setSplit({ compactPane: nextPane });
    if (!alreadyActive) {
      paneController.setCollapsed({
        editorCollapsed: nextPane !== 'editor',
        previewCollapsed: nextPane !== 'preview'
      }, `compact-split:${reason}`);
    }
    return true;
  }

  function reconcile(mode = snapshot().mode, { resetPane = false } = {}) {
    if (destroyed) throw new Error('Compact Split Controller is destroyed.');
    const current = snapshot();
    const measuredWidth = width();
    const threshold = getCompactSplitMaxWidth(current.split.compactActive);
    const shouldCompact = mode === 'both' && measuredWidth > 0 && measuredWidth <= threshold;
    const wasCompact = current.split.compactActive;

    if (!shouldCompact) {
      if (wasCompact) state.setSplit({ compactActive: false });
      setClass(false);
      if (wasCompact && mode === 'both') {
        paneController.setCollapsed({ editorCollapsed: false, previewCollapsed: false }, 'compact-split:exit');
      }
      return false;
    }

    if (!wasCompact) state.setSplit({ compactActive: true });
    setClass(true);
    if (!wasCompact || resetPane) state.setSplit({ compactPane: 'editor' });
    const pane = snapshot().split.compactPane;
    paneController.setCollapsed({
      editorCollapsed: pane !== 'editor',
      previewCollapsed: pane !== 'preview'
    }, wasCompact ? 'compact-split:reconcile' : 'compact-split:enter');
    return true;
  }

  function scheduleEvaluation() {
    if (evaluationFrame) cancelFrame(evaluationFrame);
    evaluationFrame = requestFrame(() => {
      evaluationFrame = 0;
      if (!destroyed) reconcile(snapshot().mode);
    });
  }

  function onPaneClick(pane, event) {
    if (event?.target?.closest?.('.collapse-btn')) return;
    const current = snapshot();
    if (!current.split.compactActive) return;
    const collapsed = pane === 'editor' ? current.split.editorCollapsed : current.split.previewCollapsed;
    if (collapsed) activatePane(pane, `collapsed-${pane}-click`);
  }
  const onEditorClick = event => onPaneClick('editor', event);
  const onPreviewClick = event => onPaneClick('preview', event);

  const controller = Object.freeze({
    start() {
      if (destroyed) throw new Error('Compact Split Controller is destroyed.');
      if (started) return controller;
      editorPane.addEventListener?.('click', onEditorClick);
      previewPane.addEventListener?.('click', onPreviewClick);
      if (createResizeObserver) {
        observer = createResizeObserver(scheduleEvaluation);
        observer?.observe?.(main);
      } else {
        viewport.addEventListener('resize', scheduleEvaluation, { passive: true });
      }
      started = true;
      reconcile(snapshot().mode);
      return controller;
    },
    reconcile,
    activatePane,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (evaluationFrame) cancelFrame(evaluationFrame);
      evaluationFrame = 0;
      observer?.disconnect?.();
      observer = null;
      if (started && !createResizeObserver) viewport.removeEventListener('resize', scheduleEvaluation);
      editorPane.removeEventListener?.('click', onEditorClick);
      previewPane.removeEventListener?.('click', onPreviewClick);
      started = false;
    }
  });
  return controller;
}
