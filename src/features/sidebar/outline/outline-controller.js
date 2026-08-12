/**
 * Responsibility: Orchestrate the Outline heading index, hierarchy, collapse state, active heading, rendering and Sidebar activation lifecycle.
 * Imports: Only Outline-local pure/state/view collaborators; must not import Editor, Preview, Documents, Layout, Menu or browser globals.
 * Exports: createOutlineController.
 * State/side effects: Sole owner of the current Outline heading index/tree/document-version identity and active source line; delegates collapse persistence and DOM projection to injected Outline collaborators.
 * Lifecycle: Explicit start/activate/deactivate/destroy; stale index results for the same document are rejected and inactive updates do not render.
 */
import {
  buildOutlineTree,
  collectCollapsibleOutlineIds,
  normalizeOutlineHeadingIndex,
  normalizePreviewHeadingBlocks,
  outlineHeadingIndexesEqual
} from './outline-tree-builder.js';
import { resolveActiveOutlineHeading } from './outline-active-heading.js';

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}
function normalizeVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) ? Math.max(0, version) : null;
}

export function createOutlineController({
  view,
  collapseStore,
  getActiveLine,
  navigateToLine,
  now = () => 0,
  record = () => {},
  reportError = (message, error) => console.error(message, error)
} = {}) {
  requireObject(view, 'Outline view');
  requireFunction(view.start, 'Outline view.start');
  requireFunction(view.render, 'Outline view.render');
  requireFunction(view.setActiveHeading, 'Outline view.setActiveHeading');
  requireFunction(view.destroy, 'Outline view.destroy');
  requireObject(collapseStore, 'Outline collapse store');
  requireFunction(collapseStore.restore, 'Outline collapse store.restore');
  requireFunction(collapseStore.toggle, 'Outline collapse store.toggle');
  requireFunction(collapseStore.collapse, 'Outline collapse store.collapse');
  requireFunction(collapseStore.expandAll, 'Outline collapse store.expandAll');
  requireFunction(collapseStore.collapseAll, 'Outline collapse store.collapseAll');
  requireFunction(collapseStore.destroy, 'Outline collapse store.destroy');
  requireFunction(getActiveLine, 'Outline getActiveLine');
  requireFunction(navigateToLine, 'Outline navigateToLine');
  requireFunction(now, 'Outline clock');
  requireFunction(record, 'Outline performance recorder');
  requireFunction(reportError, 'Outline error reporter');

  let headings = Object.freeze([]);
  let tree = Object.freeze([]);
  let documentKey = '';
  let indexedVersion = null;
  let activeLine = 1;
  let active = false;
  let started = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('OutlineController is destroyed.');
  };

  function updateActiveProjection() {
    const heading = resolveActiveOutlineHeading(headings, activeLine);
    view.setActiveHeading(heading?.id || '');
    return heading;
  }

  function render(reason = 'render') {
    if (!started || !active) return Object.freeze({ rendered: false, reason: 'inactive' });
    const startedAt = now();
    const result = view.render(tree);
    updateActiveProjection();
    try {
      record('renderOutline', {
        category: 'render.pipeline',
        durationMs: Math.max(0, now() - startedAt),
        aggregate: true,
        details: {
          headings: headings.length,
          documentKey,
          indexedVersion,
          reason
        }
      });
    } catch (error) {
      reportError('Outline performance recording failed.', error);
    }
    return Object.freeze({ rendered: true, reason, ...result });
  }

  function replaceNormalizedIndex(nextHeadings, options = {}) {
    assertActive();
    const nextDocumentKey = String(options.documentKey || documentKey || '');
    const nextVersion = normalizeVersion(options.version);
    const documentChanged = nextDocumentKey !== documentKey;
    if (!documentChanged && nextVersion !== null && indexedVersion !== null && nextVersion < indexedVersion) {
      return Object.freeze({ accepted: false, stale: true, changed: false, documentKey, indexedVersion });
    }
    const changed = documentChanged
      || options.changedHint === true
      || !outlineHeadingIndexesEqual(headings, nextHeadings);
    documentKey = nextDocumentKey;
    if (nextVersion !== null) indexedVersion = nextVersion;
    else if (documentChanged) indexedVersion = null;
    if (changed) {
      headings = nextHeadings;
      tree = buildOutlineTree(headings);
      render(options.reason || 'index-update');
    } else if (active) {
      updateActiveProjection();
    }
    return Object.freeze({
      accepted: true,
      stale: false,
      changed,
      headings: headings.length,
      documentKey,
      indexedVersion
    });
  }

  const controller = Object.freeze({
    start() {
      assertActive();
      if (started) return controller;
      collapseStore.restore();
      view.start();
      activeLine = Math.max(1, Number(getActiveLine()) || 1);
      started = true;
      return controller;
    },
    activate({ reason = 'sidebar-activate' } = {}) {
      assertActive();
      if (!started) controller.start();
      active = true;
      activeLine = Math.max(1, Number(getActiveLine()) || activeLine || 1);
      return render(reason);
    },
    deactivate() {
      assertActive();
      active = false;
      return Object.freeze({ active: false });
    },
    replaceIndex(nextHeadings, options = {}) {
      return replaceNormalizedIndex(normalizeOutlineHeadingIndex(nextHeadings), options);
    },
    replacePreviewBlocks(blocks, options = {}) {
      return replaceNormalizedIndex(normalizePreviewHeadingBlocks(blocks), {
        ...options,
        reason: options.reason || 'preview-block-index'
      });
    },
    updateActiveLine(line) {
      assertActive();
      activeLine = Math.max(1, Math.floor(Number(line) || 1));
      if (!active || !started) return null;
      return updateActiveProjection();
    },
    refresh(reason = 'refresh') {
      assertActive();
      if (!active) return Object.freeze({ rendered: false, reason: 'inactive' });
      activeLine = Math.max(1, Number(getActiveLine()) || activeLine || 1);
      return render(reason);
    },
    navigate(line) {
      assertActive();
      const targetLine = Math.max(1, Math.floor(Number(line) || 1));
      activeLine = targetLine;
      const result = navigateToLine(targetLine);
      if (active && started) updateActiveProjection();
      return result;
    },
    toggleNode(id) {
      assertActive();
      const pending = collapseStore.toggle(id);
      render('toggle-node');
      return pending;
    },
    expandAll() {
      assertActive();
      const pending = collapseStore.expandAll();
      render('expand-all');
      return pending;
    },
    collapseAll() {
      assertActive();
      const pending = collapseStore.collapseAll(collectCollapsibleOutlineIds(tree));
      render('collapse-all');
      return pending;
    },
    collapseNode(id) {
      assertActive();
      const pending = collapseStore.collapse(id);
      render('collapse-node');
      return pending;
    },
    get snapshot() {
      assertActive();
      return Object.freeze({
        active,
        started,
        documentKey,
        indexedVersion,
        activeLine,
        headings: Object.freeze(headings.map(item => Object.freeze({ ...item }))),
        tree
      });
    },
    destroy() {
      if (destroyed) return;
      active = false;
      started = false;
      headings = Object.freeze([]);
      tree = Object.freeze([]);
      documentKey = '';
      indexedVersion = null;
      view.destroy();
      collapseStore.destroy();
      destroyed = true;
    }
  });
  return controller;
}
