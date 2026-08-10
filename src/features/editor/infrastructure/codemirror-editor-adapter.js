/**
 * Responsibility: Own the private CodeMirror state/view runtime and expose neutral editor text, transaction, selection, focus, scroll, history, subscription and teardown operations.
 * Imports: May import CodeMirror state/view/command primitives and use injected callbacks; must not import document, UI, persistence or other feature internals.
 * Exports: createCodeMirrorAdapter.
 * State/side effects: Owns one private EditorView plus update/scroll listeners and its scroll DOM listener; raw CodeMirror objects remain inside the returned integration boundary.
 * Lifecycle: Explicit instance lifecycle; destroy() is idempotent, releases listeners/view and makes later operations terminal.
 */
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory, redo as redoHistory, undo as undoHistory } from '@codemirror/commands';

const SEARCH_CHUNK_SIZE = 64 * 1024;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function toDocumentText(content) {
  if (!Array.isArray(content)) return String(content ?? '');
  let documentText = Text.empty;
  for (const chunk of content) {
    const value = String(chunk ?? '');
    if (!value) continue;
    documentText = documentText.append(Text.of(value.split('\n')));
  }
  return documentText;
}

function resolveSelection(selection, length, fallback = 0) {
  if (selection === 'end') return { anchor: length };
  if (selection && typeof selection === 'object') {
    const anchor = clamp(selection.anchor, 0, length);
    const head = clamp(selection.head ?? anchor, 0, length);
    return { anchor, head };
  }
  const requested = Number(selection);
  const anchor = clamp(Number.isFinite(requested) ? requested : fallback, 0, length);
  return { anchor };
}

function cloneRect(rect) {
  if (!rect) return null;
  return Object.freeze({
    top: Number(rect.top) || 0,
    bottom: Number(rect.bottom) || 0,
    left: Number(rect.left) || 0,
    right: Number(rect.right) || 0,
    width: Number(rect.width) || 0,
    height: Number(rect.height) || 0
  });
}

function selectionSnapshot(state) {
  const range = state.selection.main;
  const anchor = range.anchor;
  const head = range.head;
  return Object.freeze({
    anchor,
    head,
    start: Math.min(anchor, head),
    end: Math.max(anchor, head),
    direction: anchor <= head ? 'forward' : 'backward'
  });
}

function freezeChanges(update) {
  if (!update.docChanged) return Object.freeze([]);
  const changes = [];
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push(Object.freeze({
      from: fromA,
      to: toA,
      insert: inserted.toString(),
      removed: update.startState.doc.sliceString(fromA, toA)
    }));
  });
  return Object.freeze(changes);
}

function createUpdateSnapshot(update) {
  return Object.freeze({
    type: 'transaction',
    docChanged: Boolean(update.docChanged),
    selectionSet: Boolean(update.selectionSet),
    focusChanged: Boolean(update.focusChanged),
    viewportChanged: Boolean(update.viewportChanged),
    changes: freezeChanges(update),
    selection: selectionSnapshot(update.state),
    length: update.state.doc.length,
    lines: update.state.doc.lines,
    viewport: Object.freeze({
      from: Number(update.view?.viewport?.from) || 0,
      to: Number(update.view?.viewport?.to) || update.state.doc.length
    })
  });
}

function normalizeChanges(changes, documentLength) {
  const values = Array.isArray(changes) ? changes : [changes];
  return values
    .filter(Boolean)
    .map(change => {
      const from = clamp(change.from, 0, documentLength);
      const to = clamp(change.to ?? from, from, documentLength);
      return { from, to, insert: String(change.insert ?? '') };
    });
}

export function createCodeMirrorAdapter({
  parent,
  initialValue = '',
  extensions = [],
  viewFactory = config => new EditorView(config),
  reportError = (message, error) => console.error(message, error),
  markProgrammaticScroll = () => {},
  suspendScrollSync = () => {}
} = {}) {
  if (!parent) throw new TypeError('CodeMirror adapter requires a parent element.');
  if (!Array.isArray(extensions)) throw new TypeError('CodeMirror adapter extensions must be an array.');
  if (typeof viewFactory !== 'function') throw new TypeError('CodeMirror adapter viewFactory must be a function.');
  if (typeof reportError !== 'function') throw new TypeError('CodeMirror adapter reportError must be a function.');

  let destroyed = false;
  let view = null;
  const updateListeners = new Set();
  const scrollListeners = new Set();

  const assertActive = () => {
    if (destroyed || !view) throw new Error('CodeMirror adapter has been destroyed.');
  };

  const emitUpdate = update => {
    const snapshot = createUpdateSnapshot(update);
    for (const listener of [...updateListeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        reportError('CodeMirror adapter update listener failed:', error);
      }
    }
  };

  const updateExtension = EditorView.updateListener.of(emitUpdate);
  const withAdapterExtension = values => [...Array.from(values || []), updateExtension];
  const initialState = EditorState.create({
    doc: toDocumentText(initialValue),
    extensions: withAdapterExtension(extensions)
  });

  view = viewFactory({
    state: initialState,
    parent,
    notifyUpdate: emitUpdate
  });
  if (!view || !view.state || typeof view.dispatch !== 'function' || typeof view.setState !== 'function') {
    view?.destroy?.();
    view = null;
    throw new TypeError('CodeMirror adapter viewFactory returned an invalid view.');
  }

  const emitScroll = event => {
    for (const listener of [...scrollListeners]) {
      try {
        listener(event);
      } catch (error) {
        reportError('CodeMirror adapter scroll listener failed:', error);
      }
    }
  };
  view.scrollDOM?.addEventListener?.('scroll', emitScroll, { passive: true });

  const dispatch = specification => {
    assertActive();
    view.dispatch(specification);
  };

  const getDocument = () => {
    assertActive();
    return view.state.doc;
  };

  const getSelection = () => {
    assertActive();
    return selectionSnapshot(view.state);
  };

  const applyTransaction = ({ changes = null, selection = null, scrollIntoView = false } = {}) => {
    assertActive();
    const specification = {};
    if (changes) {
      const normalized = normalizeChanges(changes, view.state.doc.length);
      if (normalized.length) specification.changes = normalized.length === 1 ? normalized[0] : normalized;
    }
    if (selection !== null && selection !== undefined) {
      specification.selection = resolveSelection(selection, view.state.doc.length, getSelection().anchor);
    }
    if (scrollIntoView) specification.scrollIntoView = true;
    if (!Object.keys(specification).length) return false;
    view.dispatch(specification);
    return true;
  };

  const setText = (value, options = {}) => {
    assertActive();
    const text = String(value ?? '');
    const current = view.state.doc;
    if (current.length === text.length && current.toString() === text) return false;
    markProgrammaticScroll(480);
    suspendScrollSync(320);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      selection: resolveSelection(options.selection ?? 'end', text.length, text.length)
    });
    return true;
  };

  const setDocumentChunks = (chunks, options = {}) => {
    assertActive();
    const documentText = toDocumentText(Array.from(chunks || []));
    markProgrammaticScroll(480);
    suspendScrollSync(320);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: documentText },
      selection: resolveSelection(options.selection ?? 0, documentText.length, 0)
    });
    return documentText.length;
  };

  const replaceRange = (replacement, start, end = start, selectionMode = 'preserve') => {
    assertActive();
    const text = String(replacement ?? '');
    const documentLength = view.state.doc.length;
    const from = clamp(Math.min(start, end), 0, documentLength);
    const to = clamp(Math.max(start, end), from, documentLength);
    const previous = getSelection();
    const delta = text.length - (to - from);
    let anchor = from + text.length;
    let head = anchor;

    if (selectionMode === 'select') {
      anchor = from;
      head = from + text.length;
    } else if (selectionMode === 'start') {
      anchor = head = from;
    } else if (selectionMode === 'preserve') {
      const mapPosition = position => {
        if (position <= from) return position;
        if (position >= to) return position + delta;
        return from + text.length;
      };
      anchor = mapPosition(previous.start);
      head = mapPosition(previous.end);
    }

    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor, head }
    });
    return Object.freeze({ from, to, insert: text, selection: Object.freeze({ anchor, head }) });
  };

  const findText = (query, from = 0, options = {}) => {
    const needle = String(query ?? '');
    if (!needle) return null;
    const doc = getDocument();
    const start = clamp(from, 0, doc.length);
    const wrap = options.wrap !== false;
    const overlapLength = Math.max(0, needle.length - 1);

    const scan = (rangeStart, rangeEnd) => {
      let cursor = rangeStart;
      let carry = '';
      while (cursor < rangeEnd) {
        const end = Math.min(rangeEnd, cursor + SEARCH_CHUNK_SIZE);
        const text = carry + doc.sliceString(cursor, end);
        const index = text.indexOf(needle);
        if (index >= 0) {
          const absolute = cursor - carry.length + index;
          if (absolute >= rangeStart && absolute + needle.length <= rangeEnd) {
            return Object.freeze({ from: absolute, to: absolute + needle.length });
          }
        }
        if (end >= rangeEnd) break;
        carry = overlapLength ? text.slice(-overlapLength) : '';
        cursor = end;
      }
      return null;
    };

    return scan(start, doc.length) || (wrap && start > 0 ? scan(0, start) : null);
  };

  const replaceAllText = (query, replacement) => {
    const needle = String(query ?? '');
    if (!needle) return 0;
    const insert = String(replacement ?? '');
    const doc = getDocument();
    const overlapLength = Math.max(0, needle.length - 1);
    const changes = [];
    let cursor = 0;
    let carry = '';
    let nextAllowed = 0;

    while (cursor < doc.length) {
      const end = Math.min(doc.length, cursor + SEARCH_CHUNK_SIZE);
      const text = carry + doc.sliceString(cursor, end);
      const base = cursor - carry.length;
      let local = Math.max(0, nextAllowed - base);
      while (local <= text.length - needle.length) {
        const index = text.indexOf(needle, local);
        if (index < 0) break;
        const absolute = base + index;
        if (absolute >= nextAllowed && absolute + needle.length <= doc.length) {
          changes.push({ from: absolute, to: absolute + needle.length, insert });
          nextAllowed = absolute + needle.length;
        }
        local = index + Math.max(1, needle.length);
      }
      if (end >= doc.length) break;
      carry = overlapLength ? text.slice(-overlapLength) : '';
      cursor = end;
    }

    if (!changes.length) return 0;
    view.dispatch({ changes, selection: { anchor: changes[0].from + insert.length } });
    return changes.length;
  };

  const setSelection = (anchor, head = anchor, options = {}) => {
    assertActive();
    const selection = resolveSelection({ anchor, head }, view.state.doc.length, 0);
    view.dispatch({ selection, scrollIntoView: Boolean(options.scrollIntoView) });
    return getSelection();
  };

  const getScrollMetrics = () => {
    assertActive();
    const scrollDOM = view.scrollDOM;
    return Object.freeze({
      top: Number(scrollDOM?.scrollTop) || 0,
      left: Number(scrollDOM?.scrollLeft) || 0,
      height: Number(scrollDOM?.scrollHeight) || 0,
      width: Number(scrollDOM?.scrollWidth) || 0,
      clientHeight: Number(scrollDOM?.clientHeight) || 0,
      clientWidth: Number(scrollDOM?.clientWidth) || 0
    });
  };

  const api = {
    getText() { return getDocument().toString(); },
    getTextLength() { return getDocument().length; },
    getLineCount() { return getDocument().lines; },
    getLineNumberAtPosition(position) {
      const doc = getDocument();
      return doc.lineAt(clamp(position, 0, doc.length)).number;
    },
    getLineStart(lineNumber) {
      const doc = getDocument();
      const safeLine = clamp(lineNumber, 1, Math.max(1, doc.lines));
      return doc.line(Math.floor(safeLine)).from;
    },
    getLineEnd(lineNumber) {
      const doc = getDocument();
      const safeLine = clamp(lineNumber, 1, Math.max(1, doc.lines));
      return doc.line(Math.floor(safeLine)).to;
    },
    sliceText(from = 0, to = null) {
      const doc = getDocument();
      const start = clamp(from, 0, doc.length);
      const end = clamp(to === null ? doc.length : to, start, doc.length);
      return doc.sliceString(start, end);
    },
    applyTransaction,
    setText,
    setDocumentChunks,
    replaceRange,
    findText,
    replaceAllText,
    getSelection,
    setSelection,
    getVisibleRange() {
      assertActive();
      return Object.freeze({ from: view.viewport.from, to: view.viewport.to });
    },
    getLineAtHeight(height) {
      assertActive();
      const block = view.lineBlockAtHeight(Math.max(0, Number(height) || 0));
      const line = view.state.doc.lineAt(block.from);
      const span = Math.max(1, block.height || view.defaultLineHeight || 1);
      const fraction = clamp(((Number(height) || 0) - block.top) / span, 0, 0.999);
      return line.number + fraction;
    },
    getHeightForLine(lineFloat) {
      assertActive();
      const maxLine = Math.max(1, view.state.doc.lines);
      const safeLine = clamp(lineFloat, 1, maxLine + 0.999);
      const lineNumber = Math.min(maxLine, Math.floor(safeLine));
      const fraction = clamp(safeLine - lineNumber, 0, 0.999);
      const line = view.state.doc.line(lineNumber);
      const block = view.lineBlockAt(line.from);
      return block.top + Math.max(1, block.height || view.defaultLineHeight || 1) * fraction;
    },
    getHeightForPosition(position) {
      assertActive();
      const safePosition = clamp(position, 0, view.state.doc.length);
      const block = view.lineBlockAt(safePosition);
      return block.top + Math.max(1, block.height || view.defaultLineHeight || 1) * 0.5;
    },
    getDefaultLineHeight() {
      assertActive();
      return Math.max(1, Number(view.defaultLineHeight) || 1);
    },
    getPositionCoordinates(position, assoc = 1) {
      assertActive();
      try {
        return cloneRect(view.coordsAtPos(clamp(position, 0, view.state.doc.length), assoc));
      } catch (_) {
        return null;
      }
    },
    getScrollViewportRect() {
      assertActive();
      return cloneRect(view.scrollDOM?.getBoundingClientRect?.());
    },
    getScrollMetrics,
    setScrollTop(value) {
      assertActive();
      markProgrammaticScroll(240);
      view.scrollDOM.scrollTop = Number(value) || 0;
    },
    setScrollLeft(value) {
      assertActive();
      view.scrollDOM.scrollLeft = Number(value) || 0;
    },
    scrollTo(optionsOrX, y) {
      assertActive();
      markProgrammaticScroll(typeof optionsOrX === 'object' && optionsOrX?.behavior === 'smooth' ? 620 : 240);
      if (typeof optionsOrX === 'object') view.scrollDOM.scrollTo(optionsOrX);
      else view.scrollDOM.scrollTo(optionsOrX || 0, y || 0);
    },
    scrollBy(optionsOrX, y) {
      assertActive();
      markProgrammaticScroll(typeof optionsOrX === 'object' && optionsOrX?.behavior === 'smooth' ? 620 : 240);
      if (typeof optionsOrX === 'object') view.scrollDOM.scrollBy(optionsOrX);
      else view.scrollDOM.scrollBy(optionsOrX || 0, y || 0);
    },
    scrollPositionIntoView(position, behavior = 'auto', viewportRatio = 0.5) {
      assertActive();
      const safePosition = clamp(position, 0, view.state.doc.length);
      markProgrammaticScroll(behavior === 'smooth' ? 620 : 240);
      suspendScrollSync(behavior === 'smooth' ? 520 : 180);
      if (behavior !== 'smooth') {
        view.dispatch({ effects: EditorView.scrollIntoView(safePosition, { y: 'center' }) });
        return;
      }
      const block = view.lineBlockAt(safePosition);
      const targetY = block.top + Math.max(1, block.height || view.defaultLineHeight || 1) * 0.5;
      const top = targetY - view.scrollDOM.clientHeight * clamp(viewportRatio, 0, 1);
      view.scrollDOM.scrollTo({
        top: clamp(top, 0, Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)),
        behavior
      });
    },
    focus(options = {}) {
      assertActive();
      const previous = getScrollMetrics();
      view.focus();
      if (options?.preventScroll) {
        markProgrammaticScroll(240);
        view.scrollDOM.scrollTop = previous.top;
        view.scrollDOM.scrollLeft = previous.left;
      }
    },
    blur() {
      assertActive();
      view.contentDOM?.blur?.();
    },
    hasFocus() {
      assertActive();
      return Boolean(view.hasFocus);
    },
    setReadOnly(value) {
      assertActive();
      view.contentDOM?.setAttribute?.('contenteditable', value ? 'false' : 'true');
    },
    isolateHistory() { dispatch({ annotations: isolateHistory.of('full') }); },
    undo() {
      assertActive();
      return undoHistory(view);
    },
    redo() {
      assertActive();
      return redoHistory(view);
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') return () => {};
      updateListeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        updateListeners.delete(listener);
      };
    },
    subscribeScroll(listener) {
      assertActive();
      if (typeof listener !== 'function') return () => {};
      scrollListeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        scrollListeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      updateListeners.clear();
      scrollListeners.clear();
      view?.scrollDOM?.removeEventListener?.('scroll', emitScroll);
      view?.destroy?.();
      view = null;
    }
  };

  const integration = Object.freeze({
    dispatchEffects(effects) {
      assertActive();
      const values = Array.isArray(effects) ? effects : [effects];
      const filtered = values.filter(Boolean);
      if (!filtered.length) return false;
      view.dispatch({ effects: filtered });
      return true;
    },
    resetDocument(content, options = {}) {
      assertActive();
      const documentText = toDocumentText(content);
      const selection = resolveSelection(options.selection, documentText.length, 0);
      view.setState(EditorState.create({
        doc: documentText,
        selection,
        extensions: withAdapterExtension(options.extensions || extensions)
      }));
      return documentText.length;
    },
    resetHistory(options = {}) {
      assertActive();
      const selection = view.state.selection;
      const documentText = view.state.doc;
      view.setState(EditorState.create({
        doc: documentText,
        selection,
        extensions: withAdapterExtension(options.extensions || extensions)
      }));
    },
    readView(reader) {
      assertActive();
      if (typeof reader !== 'function') throw new TypeError('CodeMirror adapter readView requires a reader function.');
      return reader(view);
    }
  });

  return Object.freeze({ api, integration });
}
