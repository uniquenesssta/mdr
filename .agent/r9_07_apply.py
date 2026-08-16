from pathlib import Path
import json

ROOT = Path('.')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


selection_dir = ROOT / 'src/features/sync/selection'
selection_dir.mkdir(parents=True, exist_ok=True)

(selection_dir / 'editor-selection-reader.js').write_text(r'''/**
 * Responsibility: Read the final editor selection boundary from the neutral editor adapter without owning editor state, DOM listeners, mapping, highlighting or synchronization policy.
 * Imports: None; consumes only an injected editorApi.getSelection capability.
 * Exports: EditorSelectionReader and createEditorSelectionReader.
 * State/side effects: Owns only terminal lifecycle state; selection snapshots are immutable read results.
 * Lifecycle: Explicit instance lifecycle; destroy() is idempotent and later reads are rejected.
 */

function normalizeOffset(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : fallback;
}

export class EditorSelectionReader {
  constructor({ editorApi } = {}) {
    if (!editorApi || typeof editorApi.getSelection !== 'function') {
      throw new TypeError('EditorSelectionReader requires editorApi.getSelection');
    }
    this.editorApi = editorApi;
    this.destroyed = false;
  }

  read() {
    if (this.destroyed) throw new Error('EditorSelectionReader is destroyed');
    const selection = this.editorApi.getSelection?.() || {};
    const anchor = normalizeOffset(selection.anchor);
    const head = normalizeOffset(selection.head, anchor);
    const from = normalizeOffset(selection.from, Math.min(anchor, head));
    const to = Math.max(from, normalizeOffset(selection.to, Math.max(anchor, head)));
    return Object.freeze({
      anchor,
      head,
      from,
      to,
      isCollapsed: from === to
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editorApi = null;
  }
}

export function createEditorSelectionReader(options = {}) {
  return new EditorSelectionReader(options);
}
''', encoding='utf-8')

(selection_dir / 'preview-selection-reader.js').write_text(r'''/**
 * Responsibility: Read final preview Selection boundaries and own preview selectionchange/pointer stabilization before publishing a stable immutable snapshot.
 * Imports: None; browser Selection, DOM event targets and frame scheduling are injected capabilities.
 * Exports: PreviewSelectionReader and createPreviewSelectionReader.
 * State/side effects: Owns preview pointer-active state, one cancellable stabilization frame chain, subscribers and listener lifecycle only.
 * Lifecycle: start()/stop() are idempotent; destroy() is terminal, cancels stale frame work and removes every owned listener/subscriber.
 */

function assertEventTarget(target, label) {
  if (!target || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') {
    throw new TypeError(`PreviewSelectionReader requires ${label} event target`);
  }
}

function normalizeOffset(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

export class PreviewSelectionReader {
  constructor({ previewElement, documentRef, getSelection, requestFrame, cancelFrame } = {}) {
    assertEventTarget(previewElement, 'previewElement');
    assertEventTarget(documentRef, 'documentRef');
    if (typeof getSelection !== 'function') throw new TypeError('PreviewSelectionReader requires getSelection capability');
    if (typeof requestFrame !== 'function') throw new TypeError('PreviewSelectionReader requires requestFrame capability');
    if (typeof cancelFrame !== 'function') throw new TypeError('PreviewSelectionReader requires cancelFrame capability');

    this.previewElement = previewElement;
    this.documentRef = documentRef;
    this.getSelection = getSelection;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.listeners = new Set();
    this.started = false;
    this.destroyed = false;
    this.pointerActive = false;
    this.selectionDirty = false;
    this.frameId = 0;
    this.frameVersion = 0;

    this.onPointerDown = () => {
      this.pointerActive = true;
      this.selectionDirty = false;
      this.cancelPending();
    };
    this.onPointerEnd = () => {
      if (!this.pointerActive) return;
      this.pointerActive = false;
      this.selectionDirty = false;
      this.scheduleStable('preview-pointerup', { force: true, frames: 2, allowEmpty: true });
    };
    this.onSelectionChange = () => {
      if (!this.read()) return;
      if (this.pointerActive) {
        this.selectionDirty = true;
        return;
      }
      this.scheduleStable('document-selectionchange', { frames: 1 });
    };
  }

  read() {
    if (this.destroyed) return null;
    const selection = this.getSelection?.();
    if (!selection || selection.isCollapsed || Number(selection.rangeCount) < 1) return null;
    const text = String(selection.toString?.() || '');
    if (!text.trim()) return null;
    if (!this.previewElement.contains?.(selection.anchorNode) || !this.previewElement.contains?.(selection.focusNode)) return null;
    let range;
    try {
      const current = selection.getRangeAt(0);
      range = typeof current?.cloneRange === 'function' ? current.cloneRange() : current;
    } catch (_) {
      return null;
    }
    if (!range) return null;
    return Object.freeze({
      anchorNode: selection.anchorNode,
      anchorOffset: normalizeOffset(selection.anchorOffset),
      focusNode: selection.focusNode,
      focusOffset: normalizeOffset(selection.focusOffset),
      text,
      range,
      isCollapsed: false
    });
  }

  subscribe(listener) {
    if (this.destroyed) throw new Error('PreviewSelectionReader is destroyed');
    if (typeof listener !== 'function') throw new TypeError('PreviewSelectionReader subscriber must be a function');
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  start() {
    if (this.destroyed) throw new Error('PreviewSelectionReader is destroyed');
    if (this.started) return this;
    this.started = true;
    this.previewElement.addEventListener('pointerdown', this.onPointerDown, true);
    this.documentRef.addEventListener('pointerup', this.onPointerEnd, true);
    this.documentRef.addEventListener('pointercancel', this.onPointerEnd, true);
    this.documentRef.addEventListener('selectionchange', this.onSelectionChange);
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.pointerActive = false;
    this.selectionDirty = false;
    this.cancelPending();
    this.previewElement.removeEventListener('pointerdown', this.onPointerDown, true);
    this.documentRef.removeEventListener('pointerup', this.onPointerEnd, true);
    this.documentRef.removeEventListener('pointercancel', this.onPointerEnd, true);
    this.documentRef.removeEventListener('selectionchange', this.onSelectionChange);
  }

  scheduleStable(reason, { force = false, frames = 1, allowEmpty = false } = {}) {
    if (this.destroyed || !this.started) return false;
    this.cancelPending();
    const version = ++this.frameVersion;
    let remaining = Math.max(1, Number(frames) || 1);
    const run = () => {
      if (this.destroyed || !this.started || version !== this.frameVersion) return;
      if (--remaining > 0) {
        this.frameId = this.requestFrame(run);
        return;
      }
      this.frameId = 0;
      const snapshot = this.read();
      if (!snapshot && !allowEmpty) return;
      const event = Object.freeze({ reason, force: Boolean(force), snapshot });
      for (const listener of [...this.listeners]) listener(event);
    };
    this.frameId = this.requestFrame(run);
    return true;
  }

  cancelPending() {
    this.frameVersion += 1;
    if (this.frameId) this.cancelFrame(this.frameId);
    this.frameId = 0;
  }

  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.frameVersion += 1;
    this.listeners.clear();
    this.previewElement = null;
    this.documentRef = null;
    this.getSelection = null;
    this.requestFrame = null;
    this.cancelFrame = null;
  }
}

export function createPreviewSelectionReader(options = {}) {
  return new PreviewSelectionReader(options);
}
''', encoding='utf-8')

# Public Sync entry: retain prior Atomic markers while adding only R9-07 Readers.
index_path = ROOT / 'src/features/sync/index.js'
index = index_path.read_text(encoding='utf-8')
index = replace_once(
    index,
    'Responsibility: Public Stage 9 synchronization contract. R9-06 adds ScrollGeometrySession beside the Scroll Controller, sole source owner, R9-04 EditorScrollMapper and R9-05 PreviewScrollMapper; selection responsibilities remain later Atomic Tasks.',
    'Responsibility: Public Stage 9 synchronization contract. R9-04 EditorScrollMapper, R9-05 PreviewScrollMapper and R9-06 ScrollGeometrySession remain frozen while R9-07 adds EditorSelectionReader and PreviewSelectionReader; later selection policy remains unmigrated.',
    'sync index responsibility'
)
index = replace_once(
    index,
    ' * Exports: Scroll controller, source ownership, editor/preview mappers and geometry session classes/factories.\n',
    ' * Exports: Scroll controller, source ownership, editor/preview mappers, geometry session and R9-07 selection reader classes/factories.\n',
    'sync index exports'
)
index += """export {
  EditorSelectionReader,
  createEditorSelectionReader
} from './selection/editor-selection-reader.js';
export {
  PreviewSelectionReader,
  createPreviewSelectionReader
} from './selection/preview-selection-reader.js';
"""
index_path.write_text(index, encoding='utf-8')

# Extract final boundary reads and preview selectionchange stabilization from the legacy Selection controller.
controller_path = ROOT / 'src/sync/selection-controller.js'
controller = controller_path.read_text(encoding='utf-8')
controller = replace_once(controller, r'''function selectionInside(preview) {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;
  return Boolean(preview.contains(selection.anchorNode) && preview.contains(selection.focusNode));
}

''', '', 'selectionInside removal')
controller = replace_once(controller, '  constructor(editor, preview) {\n', '  constructor(editor, preview, { editorSelectionReader, previewSelectionReader } = {}) {\n', 'controller constructor signature')
controller = replace_once(controller, r'''    this.editor = editor;
    this.preview = preview;
    this.callbacks = {};
''', r'''    if (!editorSelectionReader || typeof editorSelectionReader.read !== 'function') {
      throw new TypeError('SelectionSyncController requires EditorSelectionReader');
    }
    if (!previewSelectionReader
      || typeof previewSelectionReader.read !== 'function'
      || typeof previewSelectionReader.subscribe !== 'function'
      || typeof previewSelectionReader.start !== 'function'
      || typeof previewSelectionReader.stop !== 'function') {
      throw new TypeError('SelectionSyncController requires PreviewSelectionReader');
    }
    this.editor = editor;
    this.preview = preview;
    this.editorSelectionReader = editorSelectionReader;
    this.previewSelectionReader = previewSelectionReader;
    this.previewSelectionDisposer = null;
    this.callbacks = {};
''', 'controller injected readers')
controller = replace_once(controller, r'''    this.editorPointerActive = false;
    this.previewPointerActive = false;
    this.previewSelectionDirty = false;
''', r'''    this.editorPointerActive = false;
''', 'controller preview reader state removal')
controller = replace_once(controller, r'''    this.onEditorKeyUp = event => {
      const hasSelection = (this.editor.selectionStart || 0) !== (this.editor.selectionEnd || 0);
      if (event.shiftKey || hasSelection) this.scheduleEditor(Boolean(event.shiftKey), 'editor-keyup');
    };
''', r'''    this.onEditorKeyUp = event => {
      const selection = this.editorSelectionReader.read();
      const hasSelection = Boolean(selection && !selection.isCollapsed);
      if (event.shiftKey || hasSelection) this.scheduleEditor(Boolean(event.shiftKey), 'editor-keyup');
    };
''', 'controller editor key read')
controller = replace_once(controller, r'''    this.onPreviewPointerDown = () => {
      this.previewPointerActive = true;
      this.previewSelectionDirty = false;
    };
''', '', 'controller preview pointerdown removal')
controller = replace_once(controller, r'''    this.onDocumentPointerUp = () => {
      if (this.editorPointerActive) {
        this.editorPointerActive = false;
        this.scheduleEditor(true, 'editor-pointerup', { force: true, frames: 1 });
      }
      if (this.previewPointerActive) {
        this.previewPointerActive = false;
        this.schedulePreview('preview-pointerup', { force: true, frames: 2 });
      }
    };
    this.onDocumentSelectionChange = () => {
      if (this.applyingSide) {
        this.stats.ignoredFeedbackEvents += 1;
        return;
      }
      if (!selectionInside(this.preview)) return;
      if (this.previewPointerActive) {
        this.previewSelectionDirty = true;
        return;
      }
      this.schedulePreview('document-selectionchange', { frames: 1 });
    };
''', r'''    this.onDocumentPointerUp = () => {
      if (this.editorPointerActive) {
        this.editorPointerActive = false;
        this.scheduleEditor(true, 'editor-pointerup', { force: true, frames: 1 });
      }
    };
    this.onStablePreviewSelection = ({ reason = 'preview-selection', force = false, snapshot = null } = {}) => {
      if (this.applyingSide) {
        this.stats.ignoredFeedbackEvents += 1;
        return;
      }
      this.stats.previewRequests += 1;
      this.runPreview(reason, Boolean(force), snapshot, true);
    };
''', 'controller preview stabilization delegation')
controller = replace_once(controller, r'''    this.started = true;
    this.editor.addEventListener('select', this.onEditorSelect);
    this.editor.addEventListener('keyup', this.onEditorKeyUp);
    this.editor.addEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.addEventListener('pointerdown', this.onPreviewPointerDown, true);
    this.preview.addEventListener('keyup', this.onPreviewKeyUp);
    document.addEventListener('pointerup', this.onDocumentPointerUp, true);
    document.addEventListener('pointercancel', this.onDocumentPointerUp, true);
    document.addEventListener('selectionchange', this.onDocumentSelectionChange);
''', r'''    const disposePreviewSelection = this.previewSelectionReader.subscribe(this.onStablePreviewSelection);
    try {
      this.previewSelectionReader.start();
    } catch (error) {
      disposePreviewSelection();
      throw error;
    }
    this.previewSelectionDisposer = disposePreviewSelection;
    this.started = true;
    this.editor.addEventListener('select', this.onEditorSelect);
    this.editor.addEventListener('keyup', this.onEditorKeyUp);
    this.editor.addEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.addEventListener('keyup', this.onPreviewKeyUp);
    document.addEventListener('pointerup', this.onDocumentPointerUp, true);
    document.addEventListener('pointercancel', this.onDocumentPointerUp, true);
''', 'controller start reader ownership')
controller = replace_once(controller, r'''    this.editor.removeEventListener('select', this.onEditorSelect);
    this.editor.removeEventListener('keyup', this.onEditorKeyUp);
    this.editor.removeEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.removeEventListener('pointerdown', this.onPreviewPointerDown, true);
    this.preview.removeEventListener('keyup', this.onPreviewKeyUp);
    document.removeEventListener('pointerup', this.onDocumentPointerUp, true);
    document.removeEventListener('pointercancel', this.onDocumentPointerUp, true);
    document.removeEventListener('selectionchange', this.onDocumentSelectionChange);
''', r'''    this.editor.removeEventListener('select', this.onEditorSelect);
    this.editor.removeEventListener('keyup', this.onEditorKeyUp);
    this.editor.removeEventListener('pointerdown', this.onEditorPointerDown, true);
    this.preview.removeEventListener('keyup', this.onPreviewKeyUp);
    document.removeEventListener('pointerup', this.onDocumentPointerUp, true);
    document.removeEventListener('pointercancel', this.onDocumentPointerUp, true);
    this.previewSelectionReader.stop();
    this.previewSelectionDisposer?.();
    this.previewSelectionDisposer = null;
''', 'controller stop reader ownership')
controller = replace_once(controller, r'''  makeEditorKey() {
    const from = Math.min(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const to = Math.max(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const documentVersion = window.markdownEditorDocumentModel?.getState?.().version || 0;
    return `${documentVersion}:${from}:${to}:${this.previewRevision}`;
  }
''', r'''  makeEditorKey(selection = this.editorSelectionReader.read()) {
    const from = Number(selection?.from) || 0;
    const to = Math.max(from, Number(selection?.to) || 0);
    const documentVersion = window.markdownEditorDocumentModel?.getState?.().version || 0;
    return `${documentVersion}:${from}:${to}:${this.previewRevision}`;
  }
''', 'controller editor key reader')
controller = replace_once(controller, r'''    const key = this.makeEditorKey();
    if (!force && key === this.lastEditorKey) return;
    this.applyingSide = 'editor';
    let result = null;
    try {
      result = this.callbacks.syncEditorToPreview?.({ shouldScroll, reason, attempt }) || { status: 'unconfigured' };
''', r'''    const selection = this.editorSelectionReader.read();
    const key = this.makeEditorKey(selection);
    if (!force && key === this.lastEditorKey) return;
    this.applyingSide = 'editor';
    let result = null;
    try {
      result = this.callbacks.syncEditorToPreview?.({ shouldScroll, reason, attempt, selection }) || { status: 'unconfigured' };
''', 'controller runEditor snapshot')
controller = replace_once(controller, r'''  runPreview(reason, force) {
    if (this.applyingSide === 'editor' || !selectionInside(this.preview)) return;
    const selection = window.getSelection();
    const key = `${selection?.toString() || ''}:${selection?.anchorOffset || 0}:${selection?.focusOffset || 0}`;
    if (!force && key === this.lastPreviewKey) return;
    this.applyingSide = 'preview';
    let result = null;
    try {
      result = this.callbacks.syncPreviewToEditor?.({ reason }) || { status: 'unconfigured' };
      if (result?.status === 'mapped') this.lastPreviewKey = key;
    } finally {
      this.releaseApplyingSide(96);
    }
    if (result?.status === 'mapping-failed') this.stats.mappingFailures += 1;
    this.recordResult('preview-to-editor', reason, result);
  }
''', r'''  runPreview(reason, force, snapshot = null, snapshotProvided = false) {
    if (this.applyingSide === 'editor') return;
    const selection = snapshotProvided ? snapshot : this.previewSelectionReader.read();
    if (!selection) return;
    const key = `${selection.text || ''}:${selection.anchorOffset || 0}:${selection.focusOffset || 0}`;
    if (!force && key === this.lastPreviewKey) return;
    this.applyingSide = 'preview';
    let result = null;
    try {
      result = this.callbacks.syncPreviewToEditor?.({ reason, selection }) || { status: 'unconfigured' };
      if (result?.status === 'mapped') this.lastPreviewKey = key;
    } finally {
      this.releaseApplyingSide(96);
    }
    if (result?.status === 'mapping-failed') this.stats.mappingFailures += 1;
    this.recordResult('preview-to-editor', reason, result);
  }
''', 'controller runPreview reader')
controller = replace_once(controller, r'''    const from = Math.min(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const to = Math.max(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    if (from === to) return;
''', r'''    const editorSelection = this.editorSelectionReader.read();
    if (!editorSelection || editorSelection.isCollapsed) return;
''', 'controller preview mounted editor read')
controller = replace_once(controller, r'''    const previewSelection = window.getSelection?.();
    const previewSelectionActive = Boolean(
      previewSelection
      && !previewSelection.isCollapsed
      && this.preview.contains(previewSelection.anchorNode)
      && this.preview.contains(previewSelection.focusNode)
    );
    if (previewSelectionActive) {
      this.schedulePreview(reason, { force: true, frames: 2 });
      return;
    }
    const from = Math.min(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    const to = Math.max(this.editor.selectionStart || 0, this.editor.selectionEnd || 0);
    if (from !== to) {
''', r'''    const previewSelection = this.previewSelectionReader.read();
    if (previewSelection) {
      this.schedulePreview(reason, { force: true, frames: 2 });
      return;
    }
    const editorSelection = this.editorSelectionReader.read();
    if (editorSelection && !editorSelection.isCollapsed) {
''', 'controller geometry reader')
controller = replace_once(controller, r'''export function createSelectionSyncController(editor, preview) {
  return new SelectionSyncController(editor, preview);
}
''', r'''export function createSelectionSyncController(editor, preview, options = {}) {
  return new SelectionSyncController(editor, preview, options);
}
''', 'controller factory options')
for forbidden in ['selectionInside(', 'window.getSelection', 'selectionStart', 'selectionEnd', 'previewPointerActive', 'previewSelectionDirty', "addEventListener('selectionchange'", "removeEventListener('selectionchange'"]:
    if forbidden in controller:
        raise RuntimeError(f'controller still owns selection read/stability token: {forbidden}')
controller_path.write_text(controller, encoding='utf-8')

# Composition creates the two Readers through the Sync public entry and exposes only scoped compatibility references.
main_path = ROOT / 'src/main.js'
main = main_path.read_text(encoding='utf-8')
main = replace_once(
    main,
    "import { createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController } from './features/sync/index.js';\n",
    "import { createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController } from './features/sync/index.js';\nimport { createEditorSelectionReader, createPreviewSelectionReader } from './features/sync/index.js';\n",
    'main reader import'
)
main = replace_once(main, r'''  window.markdownEditorScrollController = scrollController;
  window.markdownEditorScrollSync = scrollController.getPublicApi();
  window.markdownEditorSelectionController = createSelectionSyncController(editorHost, previewHost);
  const documentModel = createDocumentModel(editorHost);
''', r'''  window.markdownEditorScrollController = scrollController;
  window.markdownEditorScrollSync = scrollController.getPublicApi();
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
  if (compatibilityPlatformHost) {
    compatibilityPlatformHost.markdownEditorEditorSelectionReader = editorSelectionReader;
    compatibilityPlatformHost.markdownEditorPreviewSelectionReader = previewSelectionReader;
  }
  const selectionController = createSelectionSyncController(editorHost, previewHost, {
    editorSelectionReader,
    previewSelectionReader
  });
  window.markdownEditorSelectionController = selectionController;
  const destroySelectionReaders = () => {
    selectionController.stop();
    if (compatibilityPlatformHost?.markdownEditorEditorSelectionReader === editorSelectionReader) {
      delete compatibilityPlatformHost.markdownEditorEditorSelectionReader;
    }
    if (compatibilityPlatformHost?.markdownEditorPreviewSelectionReader === previewSelectionReader) {
      delete compatibilityPlatformHost.markdownEditorPreviewSelectionReader;
    }
    previewSelectionReader.destroy();
    editorSelectionReader.destroy();
  };
  window.addEventListener('pagehide', destroySelectionReaders, { once: true });
  const documentModel = createDocumentModel(editorHost);
''', 'main reader composition')
main_path.write_text(main, encoding='utf-8')

# Classic compatibility orchestration consumes scoped Reader snapshots; mapping/highlight/feedback code stays in place.
legacy_path = ROOT / 'public/app/scroll-sync.js'
legacy = legacy_path.read_text(encoding='utf-8')
legacy = replace_once(legacy, r'''    const scrollSyncPresentationPort = scrollSyncCompatibilityHost?.markdownEditorPresentationPort;
''', r'''    const scrollSyncPresentationPort = scrollSyncCompatibilityHost?.markdownEditorPresentationPort;
    const editorSelectionReader = scrollSyncCompatibilityHost?.markdownEditorEditorSelectionReader;
    const previewSelectionReader = scrollSyncCompatibilityHost?.markdownEditorPreviewSelectionReader;
''', 'classic reader references')
legacy = replace_once(legacy, r'''    if (!scrollSyncPresentationPort) throw new Error('Presentation compatibility port is unavailable.');
''', r'''    if (!scrollSyncPresentationPort) throw new Error('Presentation compatibility port is unavailable.');
    if (!editorSelectionReader) throw new Error('Editor Selection Reader compatibility capability is unavailable.');
    if (!previewSelectionReader) throw new Error('Preview Selection Reader compatibility capability is unavailable.');
''', 'classic reader validation')
legacy = replace_once(legacy, r'''      const start = editor.selectionStart || 0;
      const end = editor.selectionEnd || 0;
''', r'''      const editorSelection = editorSelectionReader.read();
      const start = editorSelection?.from || 0;
      const end = editorSelection?.to || 0;
''', 'classic editor selection read')
legacy = replace_once(legacy, r'''    function getPreviewSelectionContext() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return null;
      if (!preview.contains(selection.anchorNode) || !preview.contains(selection.focusNode)) return null;
      const range = selection.getRangeAt(0);
''', r'''    function getPreviewSelectionContext(selectionSnapshot = previewSelectionReader.read()) {
      const selection = selectionSnapshot;
      if (!selection) return null;
      const range = selection.range;
      if (!range) return null;
''', 'classic preview context reader')
legacy = replace_once(legacy, '        text: selection.toString(),\n', '        text: selection.text,\n', 'classic preview selection text')
legacy = replace_once(legacy, r'''    function syncPreviewSelectionToEditor(reason = 'preview-selection') {
      const context = getPreviewSelectionContext();
''', r'''    function syncPreviewSelectionToEditor(reason = 'preview-selection', selectionSnapshot = null) {
      const context = getPreviewSelectionContext(selectionSnapshot || previewSelectionReader.read());
''', 'classic preview sync snapshot')
legacy = replace_once(legacy, r'''      syncEditorToPreview: ({ shouldScroll, reason }) => syncEditorSelectionToPreview(shouldScroll, reason),
      syncPreviewToEditor: ({ reason }) => syncPreviewSelectionToEditor(reason),
''', r'''      syncEditorToPreview: ({ shouldScroll, reason, selection }) => syncEditorSelectionToPreview(shouldScroll, reason, selection),
      syncPreviewToEditor: ({ reason, selection }) => syncPreviewSelectionToEditor(reason, selection),
''', 'classic controller snapshot callbacks')
legacy = replace_once(legacy, "    function syncEditorSelectionToPreview(shouldScroll = false, reason = 'editor-selection') {\n", "    function syncEditorSelectionToPreview(shouldScroll = false, reason = 'editor-selection', selectionSnapshot = null) {\n", 'classic editor sync signature')
legacy = replace_once(legacy, r'''      const editorSelection = editorSelectionReader.read();
      const start = editorSelection?.from || 0;
      const end = editorSelection?.to || 0;
''', r'''      const editorSelection = selectionSnapshot || editorSelectionReader.read();
      const start = editorSelection?.from || 0;
      const end = editorSelection?.to || 0;
''', 'classic editor stable snapshot')
legacy = replace_once(legacy, r'''        const previewSelection = window.getSelection?.();
        const previewSelectionActive = Boolean(
          previewSelection
          && !previewSelection.isCollapsed
          && preview.contains(previewSelection.anchorNode)
          && preview.contains(previewSelection.focusNode)
        );
        if (previewSelectionActive) {
''', r'''        const previewSelection = previewSelectionReader.read();
        if (previewSelection) {
''', 'classic layout preview read')
legacy = replace_once(legacy, r'''        if ((editor.selectionStart || 0) !== (editor.selectionEnd || 0)) {
          controller.scheduleEditor(true, reason, { force: true, frames: 2 });
        }
''', r'''        const editorSelection = editorSelectionReader.read();
        if (editorSelection && !editorSelection.isCollapsed) {
          controller.scheduleEditor(true, reason, { force: true, frames: 2 });
        }
''', 'classic layout editor read')
for forbidden in ['editor.selectionStart', 'editor.selectionEnd', 'window.getSelection', 'document.getSelection']:
    if forbidden in legacy:
        raise RuntimeError(f'classic scroll-sync still reads raw selection boundary: {forbidden}')
legacy_path.write_text(legacy, encoding='utf-8')

# Production inventory: exactly two new production responsibilities.
inv_path = ROOT / 'tests/architecture/fixtures/production-modules.json'
inventory = json.loads(inv_path.read_text(encoding='utf-8'))
paths = {record[0] for record in inventory['modules']}
new_records = [
    ['src/features/sync/selection/editor-selection-reader.js', 'esm-module', 'sync-selection', 'R9-07 read-only final editor selection boundary over the neutral editor adapter without DOM, mapping, feedback or highlight ownership.', 'editor-selection-reader-lifecycle', 'explicit-instance', 'retain', False],
    ['src/features/sync/selection/preview-selection-reader.js', 'esm-module', 'sync-selection', 'R9-07 final preview Selection boundary reader and selectionchange/pointer stabilization session with injected browser capabilities and no mapping, feedback or highlight ownership.', 'preview-selection-stability-session', 'explicit-instance', 'retain', False],
]
for record in new_records:
    if record[0] in paths:
        raise RuntimeError(f'inventory already contains {record[0]}')
    inventory['modules'].append(record)
if len(inventory['modules']) != 378:
    raise RuntimeError(f'production module cardinality expected 378, got {len(inventory["modules"])}')
inv_path.write_text(json.dumps(inventory, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

# Historical architecture gates: Readers are no longer "later"; R9-08+ remains prohibited. Cardinality changes only mechanically.
reader_lines = [
    "  'src/features/sync/selection/editor-selection-reader.js',\n",
    "  'src/features/sync/selection/preview-selection-reader.js',\n",
]
for path in sorted((ROOT / 'tests/architecture').glob('stage-09-*.test.mjs')):
    text = path.read_text(encoding='utf-8')
    for line in reader_lines:
        text = text.replace(line, '')
    text = text.replace('inventory.modules.length, 376', 'inventory.modules.length, 378')
    text = text.replace('moduleFixture.modules.length, 376', 'moduleFixture.modules.length, 378')
    path.write_text(text, encoding='utf-8')
for path in sorted((ROOT / 'tests/architecture').glob('stage-08-*.test.mjs')):
    text = path.read_text(encoding='utf-8')
    text = text.replace('inventory.modules.length, 376', 'inventory.modules.length, 378')
    text = text.replace('moduleFixture.modules.length, 376', 'moduleFixture.modules.length, 378')
    path.write_text(text, encoding='utf-8')
handoff = ROOT / 'tests/stage-01-handoff.test.mjs'
if handoff.exists():
    text = handoff.read_text(encoding='utf-8')
    text = text.replace('inventory.modules.length, 376', 'inventory.modules.length, 378')
    text = text.replace('moduleFixture.modules.length, 376', 'moduleFixture.modules.length, 378')
    handoff.write_text(text, encoding='utf-8')

# R9-07 behavior tests.
(ROOT / 'tests/stage-09-selection-readers.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorSelectionReader,
  createPreviewSelectionReader
} from '../src/features/sync/index.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.members = new Set();
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
  contains(node) { return this.members.has(node); }
}

function createFrames() {
  let nextId = 1;
  const callbacks = new Map();
  const active = new Set();
  return {
    request(callback) { const id = nextId++; callbacks.set(id, callback); active.add(id); return id; },
    cancel(id) { active.delete(id); },
    activeCount() { return active.size; },
    activeIds() { return [...active]; },
    flushOne() {
      const [id] = active;
      if (!id) return;
      active.delete(id);
      callbacks.get(id)?.();
    },
    flushAll(limit = 20) { while (active.size && limit-- > 0) this.flushOne(); },
    force(id) { callbacks.get(id)?.(); }
  };
}

function previewHarness() {
  const preview = new FakeTarget();
  const documentRef = new FakeTarget();
  const frames = createFrames();
  const anchorNode = { id: 'anchor' };
  const focusNode = { id: 'focus' };
  preview.members.add(anchorNode);
  preview.members.add(focusNode);
  let selection = null;
  const reader = createPreviewSelectionReader({
    previewElement: preview,
    documentRef,
    getSelection: () => selection,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id)
  });
  const makeSelection = ({ text = 'hello', collapsed = false, anchorOffset = 1, focusOffset = 4 } = {}) => {
    const range = {
      startContainer: anchorNode,
      startOffset: anchorOffset,
      endContainer: focusNode,
      endOffset: focusOffset,
      cloneRange() { return { ...this, cloneRange: this.cloneRange }; }
    };
    return {
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset,
      isCollapsed: collapsed,
      rangeCount: 1,
      toString: () => text,
      getRangeAt: () => range
    };
  };
  return { preview, documentRef, frames, reader, makeSelection, setSelection(value) { selection = value; } };
}

test('R9-07 EditorSelectionReader requires neutral editor selection capability and returns immutable normalized final boundaries', () => {
  assert.throws(() => createEditorSelectionReader({ editorApi: {} }), /getSelection/);
  const reader = createEditorSelectionReader({
    editorApi: { getSelection: () => ({ anchor: 9, head: 3, from: 3, to: 9 }) }
  });
  const snapshot = reader.read();
  assert.deepEqual(snapshot, { anchor: 9, head: 3, from: 3, to: 9, isCollapsed: false });
  assert.equal(Object.isFrozen(snapshot), true);
  reader.destroy();
  reader.destroy();
  assert.throws(() => reader.read(), /destroyed/);
});

test('R9-07 EditorSelectionReader normalizes invalid/collapsed offsets without document or DOM reads', () => {
  const reader = createEditorSelectionReader({ editorApi: { getSelection: () => ({ anchor: -2, head: 'bad', from: 0, to: 0 }) } });
  assert.deepEqual(reader.read(), { anchor: 0, head: 0, from: 0, to: 0, isCollapsed: true });
  reader.destroy();
});

test('R9-07 PreviewSelectionReader rejects missing collapsed blank and outside-preview selections', () => {
  const h = previewHarness();
  try {
    assert.equal(h.reader.read(), null);
    h.setSelection(h.makeSelection({ collapsed: true }));
    assert.equal(h.reader.read(), null);
    h.setSelection(h.makeSelection({ text: '   ' }));
    assert.equal(h.reader.read(), null);
    const outside = h.makeSelection();
    outside.focusNode = { id: 'outside' };
    h.setSelection(outside);
    assert.equal(h.reader.read(), null);
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader returns immutable final boundary snapshot with a cloned stable range', () => {
  const h = previewHarness();
  try {
    const nativeSelection = h.makeSelection({ text: 'stable', anchorOffset: 2, focusOffset: 5 });
    h.setSelection(nativeSelection);
    const snapshot = h.reader.read();
    assert.equal(snapshot.text, 'stable');
    assert.equal(snapshot.anchorOffset, 2);
    assert.equal(snapshot.focusOffset, 5);
    assert.equal(snapshot.isCollapsed, false);
    assert.notEqual(snapshot.range, nativeSelection.getRangeAt(0));
    assert.equal(Object.isFrozen(snapshot), true);
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader waits through pointer selection and publishes one two-frame final snapshot on pointerup', () => {
  const h = previewHarness();
  const events = [];
  try {
    h.reader.subscribe(event => events.push(event));
    h.reader.start();
    h.setSelection(h.makeSelection({ text: 'dragging', focusOffset: 3 }));
    h.preview.emit('pointerdown');
    h.documentRef.emit('selectionchange');
    h.documentRef.emit('selectionchange');
    assert.equal(h.frames.activeCount(), 0);
    h.setSelection(h.makeSelection({ text: 'final', focusOffset: 8 }));
    h.documentRef.emit('pointerup');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.flushOne();
    assert.equal(events.length, 0);
    h.frames.flushOne();
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, 'preview-pointerup');
    assert.equal(events[0].force, true);
    assert.equal(events[0].snapshot.text, 'final');
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader coalesces stable selectionchange work and stale cancelled callbacks cannot publish', () => {
  const h = previewHarness();
  const events = [];
  try {
    h.reader.subscribe(event => events.push(event));
    h.reader.start();
    h.setSelection(h.makeSelection({ text: 'first' }));
    h.documentRef.emit('selectionchange');
    const [stale] = h.frames.activeIds();
    h.setSelection(h.makeSelection({ text: 'latest', focusOffset: 7 }));
    h.documentRef.emit('selectionchange');
    assert.equal(h.frames.activeCount(), 1);
    h.frames.force(stale);
    assert.equal(events.length, 0);
    h.frames.flushAll();
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, 'document-selectionchange');
    assert.equal(events[0].snapshot.text, 'latest');
  } finally { h.reader.destroy(); }
});

test('R9-07 PreviewSelectionReader stop/destroy remove every listener cancel pending work and remain terminal/idempotent', () => {
  const h = previewHarness();
  const events = [];
  h.reader.subscribe(event => events.push(event));
  h.reader.start();
  h.setSelection(h.makeSelection());
  h.documentRef.emit('selectionchange');
  const stale = h.frames.activeIds()[0];
  h.reader.stop();
  assert.equal(h.frames.activeCount(), 0);
  for (const target of [h.preview, h.documentRef]) {
    for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
  }
  h.frames.force(stale);
  assert.equal(events.length, 0);
  h.reader.destroy();
  h.reader.destroy();
  assert.equal(h.reader.read(), null);
  assert.throws(() => h.reader.start(), /destroyed/);
});
''', encoding='utf-8')

# R9-07 architecture tests.
(ROOT / 'tests/architecture/stage-09-selection-readers.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const LATER_SELECTION_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
  'src/features/sync/selection/selection-highlight-session.js',
  'src/features/sync/selection/selection-retry-scheduler.js',
  'src/features/sync/selection/selection-feedback-guard.js'
];

test('R9-07 creates exactly the two canonical Selection Readers and exports them only through the Sync public entry', async () => {
  const index = await read('src/features/sync/index.js');
  const editor = await read('src/features/sync/selection/editor-selection-reader.js');
  const preview = await read('src/features/sync/selection/preview-selection-reader.js');
  assert.match(index, /R9-04/);
  assert.match(index, /R9-05/);
  assert.match(index, /R9-06/);
  assert.match(index, /R9-07/);
  assert.match(editor, /export class EditorSelectionReader/);
  assert.match(editor, /export function createEditorSelectionReader/);
  assert.match(preview, /export class PreviewSelectionReader/);
  assert.match(preview, /export function createPreviewSelectionReader/);
  assert.match(index, /\.\/selection\/editor-selection-reader\.js/);
  assert.match(index, /\.\/selection\/preview-selection-reader\.js/);
});

test('R9-07 EditorSelectionReader is DOM-free and owns no mapping feedback highlight scheduling or document text', async () => {
  const source = await read('src/features/sync/selection/editor-selection-reader.js');
  assert.match(source, /editorApi\.getSelection/);
  assert.doesNotMatch(source, /document\.|window\.|globalThis\.|addEventListener|removeEventListener|selectionStart|selectionEnd/);
  assert.doesNotMatch(source, /selectionMapping|highlight|feedback|retry|scrollTo|scheduleTarget|DocumentModel|sliceText|\.value\b/);
});

test('R9-07 PreviewSelectionReader owns browser Selection reads and selectionchange/pointer stabilization but no mapping feedback highlight retry or scroll policy', async () => {
  const source = await read('src/features/sync/selection/preview-selection-reader.js');
  assert.match(source, /this\.getSelection/);
  assert.match(source, /addEventListener\('selectionchange'/);
  assert.match(source, /addEventListener\('pointerdown'/);
  assert.match(source, /addEventListener\('pointerup'/);
  assert.match(source, /requestFrame/);
  assert.match(source, /cancelFrame/);
  assert.doesNotMatch(source, /window\.|globalThis\.|selectionMapping|highlight|feedback|retry|scrollTo|scheduleTarget|markProgrammaticScroll|ScrollSourceOwnership/);
});

test('R9-07 legacy SelectionSyncController consumes Readers and no longer owns raw selection boundaries or preview stabilization listeners', async () => {
  const controller = await read('src/sync/selection-controller.js');
  assert.match(controller, /editorSelectionReader\.read\(\)/);
  assert.match(controller, /previewSelectionReader\.read\(\)/);
  assert.match(controller, /previewSelectionReader\.subscribe/);
  assert.match(controller, /previewSelectionReader\.start\(\)/);
  assert.match(controller, /previewSelectionReader\.stop\(\)/);
  assert.doesNotMatch(controller, /window\.getSelection|selectionStart|selectionEnd|selectionInside\(|previewPointerActive|previewSelectionDirty/);
  assert.doesNotMatch(controller, /addEventListener\('selectionchange'|removeEventListener\('selectionchange'/);
});

test('R9-07 composition injects neutral Editor and explicit browser Preview capabilities, exposes only scoped compatibility readers and owns teardown', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createEditorSelectionReader, createPreviewSelectionReader/);
  assert.match(main, /createEditorSelectionReader\(\{ editorApi: virtualEditor \}\)/);
  assert.match(main, /createPreviewSelectionReader\(\{/);
  assert.match(main, /documentRef: previewSelectionDocument/);
  assert.match(main, /markdownEditorEditorSelectionReader = editorSelectionReader/);
  assert.match(main, /markdownEditorPreviewSelectionReader = previewSelectionReader/);
  assert.match(main, /createSelectionSyncController\(editorHost, previewHost, \{/);
  assert.match(main, /editorSelectionReader,/);
  assert.match(main, /previewSelectionReader/);
  assert.match(main, /previewSelectionReader\.destroy\(\)/);
  assert.match(main, /editorSelectionReader\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorEditorSelectionReader|window\.markdownEditorPreviewSelectionReader/);
  assert.doesNotMatch(main, /\.\/features\/sync\/selection\/editor-selection-reader\.js|\.\/features\/sync\/selection\/preview-selection-reader\.js/);
});

test('R9-07 classic selection mapping orchestration consumes Reader snapshots without retaining a second raw selection authority', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /markdownEditorEditorSelectionReader/);
  assert.match(legacy, /markdownEditorPreviewSelectionReader/);
  assert.match(legacy, /editorSelectionReader\.read\(\)/);
  assert.match(legacy, /previewSelectionReader\.read\(\)/);
  assert.match(legacy, /getPreviewSelectionContext\(selectionSnapshot/);
  assert.doesNotMatch(legacy, /editor\.selectionStart|editor\.selectionEnd|window\.getSelection|document\.getSelection/);
});

test('R9-07 keeps frozen mapping and prior scroll owners untouched and does not advance later Selection Atomics', async () => {
  await access(file('src/features/sync/scroll/scroll-source-ownership.js'));
  await access(file('src/features/sync/scroll/scroll-sync-controller.js'));
  await access(file('src/features/sync/scroll/editor-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/preview-scroll-mapper.js'));
  await access(file('src/features/sync/scroll/scroll-geometry-session.js'));
  await access(file('src/sync/selection-mapping.js'));
  for (const path of LATER_SELECTION_FILES) await assert.rejects(access(file(path)), path);
  const mapping = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(mapping, /R9-07/);
});

test('R9-07 production inventory records exactly two Reader responsibilities and cardinality 378', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 378);
  assert.equal(records.get('src/features/sync/selection/editor-selection-reader.js')?.[4], 'editor-selection-reader-lifecycle');
  assert.equal(records.get('src/features/sync/selection/preview-selection-reader.js')?.[4], 'preview-selection-stability-session');
});
''', encoding='utf-8')
