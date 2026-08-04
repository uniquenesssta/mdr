import { Compartment, EditorState, Prec, Text } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars, keymap, placeholder as editorPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, isolateHistory, redo as redoHistory, undo as undoHistory } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { createPrecisePointerSelectionExtension } from './precise-pointer-selection.js';
import { getHybridComponentStateSnapshot } from './hybrid/component-state.js';
import {
  createHybridMarkdownConfiguration,
  createHybridMarkdownExtension,
  getHybridMarkdownStats
} from './hybrid-markdown.js';

const forwardedScrollEvents = new WeakMap();

const continueMarkdownMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });
const markdownEditingKeymap = [
  { key: 'Enter', run: continueMarkdownMarkup },
  { key: 'Backspace', run: deleteMarkupBackward }
];

function countNonWhitespace(value) {
  let count = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const whitespace = code <= 32
      || code === 160
      || code === 5760
      || (code >= 8192 && code <= 8202)
      || code === 8232
      || code === 8233
      || code === 8239
      || code === 8287
      || code === 12288
      || code === 65279;
    if (!whitespace) count += 1;
  }
  return count;
}

function countDocumentNonWhitespace(documentText) {
  let count = 0;
  for (let iterator = documentText.iter(); !iterator.done; iterator.next()) {
    count += countNonWhitespace(iterator.value);
  }
  return count;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function textFromChunks(chunks) {
  let documentText = Text.empty;
  for (const chunk of Array.from(chunks || [], value => String(value ?? ''))) {
    if (!chunk) continue;
    documentText = documentText.append(Text.of(chunk.split('\n')));
  }
  return documentText;
}

function createSyntheticEvent(target, type, bubbles = false) {
  const EventConstructor = target?.ownerDocument?.defaultView?.Event || Event;
  const event = new EventConstructor(type, { bubbles, cancelable: false });
  Object.defineProperty(event, '__markdownEditorVirtualEditorSynthetic', { value: true });
  return event;
}

function getSelectionRange(view) {
  const range = view.state.selection.main;
  return {
    start: Math.min(range.anchor, range.head),
    end: Math.max(range.anchor, range.head),
    direction: range.anchor <= range.head ? 'forward' : 'backward'
  };
}

function installTextareaCompatibility(host, view, placeholderCompartment) {
  let suppressInputEvent = 0;
  let placeholderValue = host.getAttribute('data-placeholder') || '';
  let readOnlyValue = false;
  let cachedValue = view.state.doc.toString();
  let valueCacheValid = true;

  const withSuppressedInput = (callback) => {
    suppressInputEvent += 1;
    try {
      return callback();
    } finally {
      suppressInputEvent -= 1;
    }
  };

  const markEditorProgrammaticScroll = (duration = 240) => {
    window.markdownEditorScrollSync?.markProgrammaticScroll?.('editor', duration);
  };

  const suspendScrollSync = (duration = 240) => {
    window.markdownEditorScrollSync?.suspend?.(duration);
  };

  const dispatchSelection = (anchor, head = anchor, scrollIntoView = false) => {
    const length = view.state.doc.length;
    const safeAnchor = clamp(anchor, 0, length);
    const safeHead = clamp(head, 0, length);
    view.dispatch({
      selection: { anchor: safeAnchor, head: safeHead },
      scrollIntoView
    });
  };

  const setValue = (nextValue) => {
    const value = String(nextValue ?? '');
    const currentLength = view.state.doc.length;

    // 初始化和文档恢复流程可能连续写入同一份内容。CodeMirror 即使收到
    // 等值的全文替换也会重新解析语法树并触发布局，因此先在适配层去重。
    if (valueCacheValid && cachedValue === value) return false;
    if (!valueCacheValid && currentLength === value.length) {
      const currentValue = view.state.doc.toString();
      cachedValue = currentValue;
      valueCacheValid = true;
      if (currentValue === value) return false;
    }

    markEditorProgrammaticScroll(480);
    suspendScrollSync(320);
    withSuppressedInput(() => {
      view.dispatch({
        changes: { from: 0, to: currentLength, insert: value },
        selection: { anchor: value.length }
      });
    });
    cachedValue = value;
    valueCacheValid = true;
    return true;
  };

  const setDocumentChunks = (chunks) => {
    const documentText = textFromChunks(chunks);
    markEditorProgrammaticScroll(480);
    suspendScrollSync(320);
    withSuppressedInput(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: documentText },
        selection: { anchor: 0 }
      });
    });
    cachedValue = '';
    valueCacheValid = documentText.length === 0;
    return documentText.length;
  };

  Object.defineProperties(host, {
    value: {
      configurable: true,
      get() {
        if (!valueCacheValid) {
          cachedValue = view.state.doc.toString();
          valueCacheValid = true;
        }
        return cachedValue;
      },
      set(value) {
        setValue(value);
      }
    },
    textLength: {
      configurable: true,
      get() {
        return view.state.doc.length;
      }
    },
    lineCount: {
      configurable: true,
      get() {
        return view.state.doc.lines;
      }
    },
    selectionStart: {
      configurable: true,
      get() {
        return getSelectionRange(view).start;
      },
      set(value) {
        const selection = getSelectionRange(view);
        dispatchSelection(value, Math.max(Number(value) || 0, selection.end));
      }
    },
    selectionEnd: {
      configurable: true,
      get() {
        return getSelectionRange(view).end;
      },
      set(value) {
        const selection = getSelectionRange(view);
        dispatchSelection(selection.start, value);
      }
    },
    selectionDirection: {
      configurable: true,
      get() {
        return getSelectionRange(view).direction;
      }
    },
    scrollTop: {
      configurable: true,
      get() {
        return view.scrollDOM.scrollTop;
      },
      set(value) {
        markEditorProgrammaticScroll();
        view.scrollDOM.scrollTop = Number(value) || 0;
      }
    },
    scrollLeft: {
      configurable: true,
      get() {
        return view.scrollDOM.scrollLeft;
      },
      set(value) {
        view.scrollDOM.scrollLeft = Number(value) || 0;
      }
    },
    scrollHeight: {
      configurable: true,
      get() {
        return view.scrollDOM.scrollHeight;
      }
    },
    scrollWidth: {
      configurable: true,
      get() {
        return view.scrollDOM.scrollWidth;
      }
    },
    placeholder: {
      configurable: true,
      get() {
        return placeholderValue;
      },
      set(value) {
        placeholderValue = String(value ?? '');
        host.setAttribute('data-placeholder', placeholderValue);
        view.dispatch({ effects: placeholderCompartment.reconfigure(editorPlaceholder(placeholderValue)) });
      }
    },
    readOnly: {
      configurable: true,
      get() {
        return readOnlyValue;
      },
      set(value) {
        readOnlyValue = Boolean(value);
        view.contentDOM.setAttribute('contenteditable', readOnlyValue ? 'false' : 'true');
      }
    }
  });

  host.focus = (options = {}) => {
    const previousTop = view.scrollDOM.scrollTop;
    const previousLeft = view.scrollDOM.scrollLeft;
    view.focus();
    if (options?.preventScroll) {
      markEditorProgrammaticScroll();
      view.scrollDOM.scrollTop = previousTop;
      view.scrollDOM.scrollLeft = previousLeft;
    }
  };

  host.blur = () => view.contentDOM.blur();

  host.setSelectionRange = (start, end = start, direction = 'none') => {
    const safeStart = clamp(start, 0, view.state.doc.length);
    const safeEnd = clamp(end, 0, view.state.doc.length);
    const backward = direction === 'backward';
    dispatchSelection(backward ? safeEnd : safeStart, backward ? safeStart : safeEnd);
  };

  host.setRangeText = (replacement, start = host.selectionStart, end = host.selectionEnd, selectionMode = 'preserve') => {
    const text = String(replacement ?? '');
    const docLength = view.state.doc.length;
    const from = clamp(Math.min(start, end), 0, docLength);
    const to = clamp(Math.max(start, end), from, docLength);
    const oldSelection = getSelectionRange(view);
    const delta = text.length - (to - from);
    let anchor = from + text.length;
    let head = anchor;

    if (selectionMode === 'select') {
      anchor = from;
      head = from + text.length;
    } else if (selectionMode === 'start') {
      anchor = head = from;
    } else if (selectionMode === 'preserve') {
      const mapPosition = (position) => {
        if (position <= from) return position;
        if (position >= to) return position + delta;
        return from + text.length;
      };
      anchor = mapPosition(oldSelection.start);
      head = mapPosition(oldSelection.end);
    }

    withSuppressedInput(() => {
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor, head }
      });
    });
  };

  host.scrollTo = (optionsOrX, y) => {
    markEditorProgrammaticScroll(typeof optionsOrX === 'object' && optionsOrX?.behavior === 'smooth' ? 620 : 240);
    if (typeof optionsOrX === 'object') {
      view.scrollDOM.scrollTo(optionsOrX);
      return;
    }
    view.scrollDOM.scrollTo(optionsOrX || 0, y || 0);
  };

  host.scrollBy = (optionsOrX, y) => {
    markEditorProgrammaticScroll(typeof optionsOrX === 'object' && optionsOrX?.behavior === 'smooth' ? 620 : 240);
    if (typeof optionsOrX === 'object') {
      view.scrollDOM.scrollBy(optionsOrX);
      return;
    }
    view.scrollDOM.scrollBy(optionsOrX || 0, y || 0);
  };

  const api = {
    view,
    setDocumentChunks,
    invalidateValueCache() {
      valueCacheValid = false;
    },
    getTextLength() {
      return view.state.doc.length;
    },
    getLineCount() {
      return view.state.doc.lines;
    },
    getLineNumberAtPosition(position) {
      const safePosition = clamp(position, 0, view.state.doc.length);
      return view.state.doc.lineAt(safePosition).number;
    },
    getLineStart(lineNumber) {
      const safeLine = clamp(lineNumber, 1, Math.max(1, view.state.doc.lines));
      return view.state.doc.line(Math.floor(safeLine)).from;
    },
    getLineEnd(lineNumber) {
      const safeLine = clamp(lineNumber, 1, Math.max(1, view.state.doc.lines));
      return view.state.doc.line(Math.floor(safeLine)).to;
    },
    sliceText(from = 0, to = view.state.doc.length) {
      const start = clamp(from, 0, view.state.doc.length);
      const end = clamp(to, start, view.state.doc.length);
      return view.state.doc.sliceString(start, end);
    },
    findText(query, from = 0, options = {}) {
      const needle = String(query ?? '');
      if (!needle) return null;
      const doc = view.state.doc;
      const start = clamp(from, 0, doc.length);
      const wrap = options.wrap !== false;
      const chunkSize = 64 * 1024;
      const overlapLength = Math.max(0, needle.length - 1);

      const scan = (rangeStart, rangeEnd) => {
        let cursor = rangeStart;
        let carry = '';
        while (cursor < rangeEnd) {
          const end = Math.min(rangeEnd, cursor + chunkSize);
          const text = carry + doc.sliceString(cursor, end);
          const index = text.indexOf(needle);
          if (index >= 0) {
            const absolute = cursor - carry.length + index;
            if (absolute >= rangeStart && absolute + needle.length <= rangeEnd) {
              return { from: absolute, to: absolute + needle.length };
            }
          }
          if (end >= rangeEnd) break;
          carry = overlapLength ? text.slice(-overlapLength) : '';
          cursor = end;
        }
        return null;
      };

      return scan(start, doc.length) || (wrap && start > 0 ? scan(0, start) : null);
    },
    replaceAllText(query, replacement) {
      const needle = String(query ?? '');
      if (!needle) return 0;
      const insert = String(replacement ?? '');
      const doc = view.state.doc;
      const chunkSize = 64 * 1024;
      const overlapLength = Math.max(0, needle.length - 1);
      const changes = [];
      let cursor = 0;
      let carry = '';
      let nextAllowed = 0;

      while (cursor < doc.length) {
        const end = Math.min(doc.length, cursor + chunkSize);
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
      withSuppressedInput(() => {
        view.dispatch({ changes, selection: { anchor: changes[0].from + insert.length } });
      });
      return changes.length;
    },
    get suppressInputEvent() {
      return suppressInputEvent > 0;
    },
    getVisibleRange() {
      return { from: view.viewport.from, to: view.viewport.to };
    },
    getLineAtHeight(height) {
      const block = view.lineBlockAtHeight(Math.max(0, Number(height) || 0));
      const line = view.state.doc.lineAt(block.from);
      const span = Math.max(1, block.height || view.defaultLineHeight || 1);
      const fraction = clamp(((Number(height) || 0) - block.top) / span, 0, 0.999);
      return line.number + fraction;
    },
    getHeightForLine(lineFloat) {
      const maxLine = Math.max(1, view.state.doc.lines);
      const safeLine = clamp(lineFloat, 1, maxLine + 0.999);
      const lineNumber = Math.min(maxLine, Math.floor(safeLine));
      const fraction = clamp(safeLine - lineNumber, 0, 0.999);
      const line = view.state.doc.line(lineNumber);
      const block = view.lineBlockAt(line.from);
      return block.top + Math.max(1, block.height || view.defaultLineHeight || 1) * fraction;
    },
    getHeightForPosition(position) {
      const safePosition = clamp(position, 0, view.state.doc.length);
      const block = view.lineBlockAt(safePosition);
      return block.top + Math.max(1, block.height || view.defaultLineHeight || 1) * 0.5;
    },
    scrollPositionIntoView(position, behavior = 'auto', viewportRatio = 0.5) {
      const safePosition = clamp(position, 0, view.state.doc.length);
      markEditorProgrammaticScroll(behavior === 'smooth' ? 620 : 240);
      suspendScrollSync(behavior === 'smooth' ? 520 : 180);
      if (behavior !== 'smooth') {
        view.dispatch({ effects: EditorView.scrollIntoView(safePosition, { y: 'center' }) });
        return;
      }
      const top = api.getHeightForPosition(safePosition) - view.scrollDOM.clientHeight * viewportRatio;
      view.scrollDOM.scrollTo({ top: clamp(top, 0, Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)), behavior });
    }
  };

  host.virtualEditor = api;
  return api;
}

export function createVirtualEditor(host) {
  if (!host || host.virtualEditor) return host?.virtualEditor || null;

  const initialValue = host.textContent || '';
  const changeJournal = {
    version: 0,
    entries: [],
    nonWhitespaceCount: countNonWhitespace(initialValue)
  };
  const documentChangeListeners = new Set();
  let externalJournalOwner = false;
  const maxJournalEntries = 512;

  function recordDocumentChanges(update) {
    if (!update.docChanged) return null;
    const changes = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const insertedText = inserted.toString();
      const removedText = update.startState.doc.sliceString(fromA, toA);
      changeJournal.nonWhitespaceCount += countNonWhitespace(insertedText) - countNonWhitespace(removedText);
      changes.push({ from: fromA, to: toA, insert: insertedText });
    });
    changeJournal.version += 1;
    const entry = { version: changeJournal.version, changes };
    if (!externalJournalOwner) {
      changeJournal.entries.push(entry);
      if (changeJournal.entries.length > maxJournalEntries) {
        changeJournal.entries.splice(0, changeJournal.entries.length - maxJournalEntries);
      }
    }
    return entry;
  }
  host.textContent = '';
  host.classList.add('virtual-editor-host');
  host.setAttribute('role', 'textbox');
  host.setAttribute('aria-multiline', 'true');

  const placeholderCompartment = new Compartment();
  const presentationCompartment = new Compartment();
  const hybridConfigurationCompartment = new Compartment();
  const hybridMarkdownExtension = createHybridMarkdownExtension();
  const hybridPresentationExtension = [
    hybridMarkdownExtension,
    EditorView.editorAttributes.of({ class: 'cm-hybrid-mode' })
  ];
  let presentationMode = 'source';
  let hybridTableVisualEditing = false;
  let hybridCodeVisualEditing = false;
  let documentLoadResetPending = false;
  let adapterApi = null;

  const editorExtensions = [
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    Prec.high(createPrecisePointerSelectionExtension()),
    markdown({ extensions: GFM, addKeymap: false }),
    Prec.high(keymap.of(markdownEditingKeymap)),
    history({ minDepth: 100, newGroupDelay: 500 }),
    keymap.of(defaultKeymap.filter(binding => !/^(?:Mod-(?:z|y|s|b|i|u|k|f|o|n)|Shift-Mod-z|Tab)$/i.test(binding.key || ''))),
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
      translate: 'no'
    }),
    placeholderCompartment.of(editorPlaceholder(host.getAttribute('data-placeholder') || '')),
    hybridConfigurationCompartment.of(createHybridMarkdownConfiguration({
      tableVisualEditing: hybridTableVisualEditing,
      codeVisualEditing: hybridCodeVisualEditing
    })),
    presentationCompartment.of([]),
    EditorView.updateListener.of((update) => {
      const documentChange = recordDocumentChanges(update);
      if (!adapterApi) return;
      if (update.docChanged) {
        adapterApi.invalidateValueCache();
        if (documentChange) {
          const event = {
            version: documentChange.version,
            changes: documentChange.changes.map(change => ({ ...change })),
            suppressed: adapterApi.suppressInputEvent,
            length: update.state.doc.length,
            lines: update.state.doc.lines,
            nonWhitespaceCount: changeJournal.nonWhitespaceCount
          };
          for (const listener of documentChangeListeners) {
            try {
              listener(event);
            } catch (error) {
              console.error('Virtual editor document listener failed:', error);
            }
          }
        }
        if (!adapterApi.suppressInputEvent) host.dispatchEvent(createSyntheticEvent(host, 'input', true));
      }
      if (update.selectionSet) {
        host.dispatchEvent(createSyntheticEvent(host, 'select'));
      }
    })
  ];
  const state = EditorState.create({ doc: initialValue, extensions: editorExtensions });

  const view = new EditorView({ state, parent: host });
  adapterApi = installTextareaCompatibility(host, view, placeholderCompartment);

  function loadDocumentState(content, options = {}) {
    const documentText = Array.isArray(content) ? textFromChunks(content) : String(content ?? '');
    const length = documentText.length;
    const requestedSelection = options.selection === 'end' ? length : Number(options.selection);
    const anchor = clamp(Number.isFinite(requestedSelection) ? requestedSelection : 0, 0, length);
    view.setState(EditorState.create({
      doc: documentText,
      selection: { anchor },
      extensions: editorExtensions
    }));
    const dynamicEffects = [
      hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({
        tableVisualEditing: hybridTableVisualEditing,
        codeVisualEditing: hybridCodeVisualEditing
      }))
    ];
    if (presentationMode === 'hybrid') {
      dynamicEffects.push(presentationCompartment.reconfigure(hybridPresentationExtension));
    }
    view.dispatch({ effects: dynamicEffects });
    changeJournal.version = 0;
    changeJournal.entries = [];
    changeJournal.nonWhitespaceCount = Number.isFinite(Number(options.nonWhitespaceCount))
      ? Math.max(0, Number(options.nonWhitespaceCount) || 0)
      : countDocumentNonWhitespace(view.state.doc);
    adapterApi.invalidateValueCache();
    documentLoadResetPending = true;
    return length;
  }

  Object.assign(adapterApi, {
    loadDocument(content, options = {}) {
      return loadDocumentState(content, options);
    },
    loadDocumentChunks(chunks, options = {}) {
      return loadDocumentState(Array.from(chunks || []), options);
    },
    consumeDocumentLoadHistoryReset() {
      const pending = documentLoadResetPending;
      documentLoadResetPending = false;
      return pending;
    },
    getDocumentVersion() {
      return changeJournal.version;
    },
    subscribeDocumentChanges(listener) {
      if (typeof listener !== 'function') return () => {};
      documentChangeListeners.add(listener);
      return () => documentChangeListeners.delete(listener);
    },
    useExternalDocumentJournal(enabled = true) {
      externalJournalOwner = Boolean(enabled);
      if (externalJournalOwner) changeJournal.entries = [];
    },
    getNonWhitespaceCount() {
      return Math.max(0, changeJournal.nonWhitespaceCount);
    },
    getDocumentChangesSince(version) {
      const requested = Math.max(0, Number(version) || 0);
      if (requested === changeJournal.version) return [];
      const firstVersion = changeJournal.entries[0]?.version ?? changeJournal.version + 1;
      if (requested < firstVersion - 1 || requested > changeJournal.version) return null;
      return changeJournal.entries
        .filter(entry => entry.version > requested)
        .map(entry => ({
          version: entry.version,
          changes: entry.changes.map(change => ({ ...change }))
        }));
    },
    resetDocumentJournal(nonWhitespaceCount = null) {
      changeJournal.version = 0;
      changeJournal.entries = [];
      changeJournal.nonWhitespaceCount = Number.isFinite(Number(nonWhitespaceCount))
        ? Math.max(0, Number(nonWhitespaceCount) || 0)
        : countDocumentNonWhitespace(view.state.doc);
      adapterApi.invalidateValueCache();
    },
    isolateHistory() {
      view.dispatch({ annotations: isolateHistory.of('full') });
    },
    undo() {
      return undoHistory(view);
    },
    redo() {
      return redoHistory(view);
    },
    setPresentationMode(mode = 'source') {
      const nextMode = mode === 'hybrid' ? 'hybrid' : 'source';
      if (presentationMode === nextMode) return false;
      presentationMode = nextMode;
      view.dispatch({
        effects: presentationCompartment.reconfigure(nextMode === 'hybrid' ? hybridPresentationExtension : [])
      });
      return true;
    },
    getPresentationMode() {
      return presentationMode;
    },
    setHybridTableVisualEditing(enabled) {
      const next = Boolean(enabled);
      if (hybridTableVisualEditing === next) return false;
      hybridTableVisualEditing = next;
      view.dispatch({
        effects: hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({
          tableVisualEditing: hybridTableVisualEditing,
          codeVisualEditing: hybridCodeVisualEditing
        }))
      });
      return true;
    },
    getHybridTableVisualEditing() {
      return hybridTableVisualEditing;
    },
    setHybridCodeVisualEditing(enabled) {
      const next = Boolean(enabled);
      if (hybridCodeVisualEditing === next) return false;
      hybridCodeVisualEditing = next;
      view.dispatch({
        effects: hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({
          tableVisualEditing: hybridTableVisualEditing,
          codeVisualEditing: hybridCodeVisualEditing
        }))
      });
      return true;
    },
    getHybridCodeVisualEditing() {
      return hybridCodeVisualEditing;
    },
    getPresentationStats() {
      return presentationMode === 'hybrid'
        ? getHybridMarkdownStats(view)
        : { visibleLines: 0, decoratedLines: 0, headingLines: 0, sourceActiveLines: 0, hiddenMarkers: 0 };
    },
    getHybridComponentStates() {
      return getHybridComponentStateSnapshot(view);
    },
    resetHistory() {
      const selection = view.state.selection;
      view.setState(EditorState.create({
        doc: view.state.doc,
        selection,
        extensions: editorExtensions
      }));
      const dynamicEffects = [
        hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({
          tableVisualEditing: hybridTableVisualEditing,
          codeVisualEditing: hybridCodeVisualEditing
        }))
      ];
      if (presentationMode === 'hybrid') {
        dynamicEffects.push(presentationCompartment.reconfigure(hybridPresentationExtension));
      }
      view.dispatch({ effects: dynamicEffects });
      adapterApi.invalidateValueCache();
    }
  });

  host.addEventListener('input', (event) => {
    if (!event.__markdownEditorVirtualEditorSynthetic) event.stopImmediatePropagation();
  });

  const forwardScroll = () => host.dispatchEvent(createSyntheticEvent(host, 'scroll'));
  view.scrollDOM.addEventListener('scroll', forwardScroll, { passive: true });
  forwardedScrollEvents.set(host, forwardScroll);

  return adapterApi;
}
