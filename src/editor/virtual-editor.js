import { Compartment, Prec } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars, keymap, placeholder as editorPlaceholder } from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { createPrecisePointerSelectionExtension } from './precise-pointer-selection.js';
import { createCodeMirrorAdapter } from './codemirror/index.js';
import { getHybridComponentStateSnapshot } from './hybrid/component-state.js';
import {
  createHybridMarkdownConfiguration,
  createHybridMarkdownExtension,
  getHybridMarkdownStats
} from './hybrid-markdown.js';

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

function countDocumentNonWhitespace(editorApi) {
  const length = editorApi?.getTextLength?.() || 0;
  let count = 0;
  for (let from = 0; from < length; from += 64 * 1024) {
    count += countNonWhitespace(editorApi.sliceText(from, Math.min(length, from + 64 * 1024)));
  }
  return count;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function createSyntheticEvent(target, type, bubbles = false) {
  const EventConstructor = target?.ownerDocument?.defaultView?.Event || Event;
  const event = new EventConstructor(type, { bubbles, cancelable: false });
  Object.defineProperty(event, '__markdownEditorVirtualEditorSynthetic', { value: true });
  return event;
}

function installTextareaCompatibility(host, adapter, integration, placeholderCompartment) {
  let suppressInputEvent = 0;
  let placeholderValue = host.getAttribute('data-placeholder') || '';
  let readOnlyValue = false;
  let cachedValue = adapter.getText();
  let valueCacheValid = true;
  const adapterSetDocumentChunks = adapter.setDocumentChunks.bind(adapter);

  const withSuppressedInput = (callback) => {
    suppressInputEvent += 1;
    try {
      return callback();
    } finally {
      suppressInputEvent -= 1;
    }
  };

  const invalidateValueCache = () => { valueCacheValid = false; };

  const setValue = (nextValue) => {
    const value = String(nextValue ?? '');
    const currentLength = adapter.getTextLength();
    if (valueCacheValid && cachedValue === value) return false;
    if (!valueCacheValid && currentLength === value.length) {
      const currentValue = adapter.getText();
      cachedValue = currentValue;
      valueCacheValid = true;
      if (currentValue === value) return false;
    }
    const changed = withSuppressedInput(() => adapter.setText(value, { selection: 'end' }));
    cachedValue = value;
    valueCacheValid = true;
    return changed;
  };

  const setDocumentChunks = (chunks) => {
    const length = withSuppressedInput(() => adapterSetDocumentChunks(chunks, { selection: 0 }));
    cachedValue = '';
    valueCacheValid = length === 0;
    return length;
  };

  Object.defineProperties(host, {
    value: { configurable: true, get() { if (!valueCacheValid) { cachedValue = adapter.getText(); valueCacheValid = true; } return cachedValue; }, set(value) { setValue(value); } },
    textLength: { configurable: true, get() { return adapter.getTextLength(); } },
    lineCount: { configurable: true, get() { return adapter.getLineCount(); } },
    selectionStart: { configurable: true, get() { return adapter.getSelection().start; }, set(value) { const selection = adapter.getSelection(); adapter.setSelection(value, Math.max(Number(value) || 0, selection.end)); } },
    selectionEnd: { configurable: true, get() { return adapter.getSelection().end; }, set(value) { const selection = adapter.getSelection(); adapter.setSelection(selection.start, value); } },
    selectionDirection: { configurable: true, get() { return adapter.getSelection().direction; } },
    scrollTop: { configurable: true, get() { return adapter.getScrollMetrics().top; }, set(value) { adapter.setScrollTop(value); } },
    scrollLeft: { configurable: true, get() { return adapter.getScrollMetrics().left; }, set(value) { adapter.setScrollLeft(value); } },
    scrollHeight: { configurable: true, get() { return adapter.getScrollMetrics().height; } },
    scrollWidth: { configurable: true, get() { return adapter.getScrollMetrics().width; } },
    placeholder: { configurable: true, get() { return placeholderValue; }, set(value) { placeholderValue = String(value ?? ''); host.setAttribute('data-placeholder', placeholderValue); integration.dispatchEffects(placeholderCompartment.reconfigure(editorPlaceholder(placeholderValue))); } },
    readOnly: { configurable: true, get() { return readOnlyValue; }, set(value) { readOnlyValue = Boolean(value); adapter.setReadOnly(readOnlyValue); } }
  });

  host.focus = (options = {}) => adapter.focus(options);
  host.blur = () => adapter.blur();
  host.setSelectionRange = (start, end = start, direction = 'none') => { const backward = direction === 'backward'; adapter.setSelection(backward ? end : start, backward ? start : end); };
  host.setRangeText = (replacement, start = host.selectionStart, end = host.selectionEnd, selectionMode = 'preserve') => { withSuppressedInput(() => adapter.replaceRange(replacement, start, end, selectionMode)); };
  host.scrollTo = (optionsOrX, y) => adapter.scrollTo(optionsOrX, y);
  host.scrollBy = (optionsOrX, y) => adapter.scrollBy(optionsOrX, y);

  const compatibilityProperties = ['value', 'textLength', 'lineCount', 'selectionStart', 'selectionEnd', 'selectionDirection', 'scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth', 'placeholder', 'readOnly', 'focus', 'blur', 'setSelectionRange', 'setRangeText', 'scrollTo', 'scrollBy'];
  return {
    setDocumentChunks,
    invalidateValueCache,
    get suppressInputEvent() { return suppressInputEvent > 0; },
    destroy() { for (const property of compatibilityProperties) delete host[property]; }
  };
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
    const changes = update.changes.map(change => {
      changeJournal.nonWhitespaceCount += countNonWhitespace(change.insert) - countNonWhitespace(change.removed);
      return { from: change.from, to: change.to, insert: change.insert };
    });
    changeJournal.version += 1;
    const entry = { version: changeJournal.version, changes };
    if (!externalJournalOwner) {
      changeJournal.entries.push(entry);
      if (changeJournal.entries.length > maxJournalEntries) changeJournal.entries.splice(0, changeJournal.entries.length - maxJournalEntries);
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
    presentationCompartment.of([])
  ];

  const { api: codeMirrorApi, integration: codeMirrorIntegration } = createCodeMirrorAdapter({
    parent: host,
    initialValue,
    extensions: editorExtensions,
    markProgrammaticScroll(duration) { window.markdownEditorScrollSync?.markProgrammaticScroll?.('editor', duration); },
    suspendScrollSync(duration) { window.markdownEditorScrollSync?.suspend?.(duration); },
    reportError(message, error) { console.error(message, error); }
  });
  adapterApi = codeMirrorApi;
  const textareaCompatibility = installTextareaCompatibility(host, adapterApi, codeMirrorIntegration, placeholderCompartment);
  adapterApi.setDocumentChunks = textareaCompatibility.setDocumentChunks;
  adapterApi.invalidateValueCache = textareaCompatibility.invalidateValueCache;
  Object.defineProperty(adapterApi, 'suppressInputEvent', { configurable: true, get() { return textareaCompatibility.suppressInputEvent; } });

  const unsubscribeAdapterUpdates = adapterApi.subscribe(update => {
    const documentChange = recordDocumentChanges(update);
    if (update.docChanged) {
      textareaCompatibility.invalidateValueCache();
      if (documentChange) {
        const event = { version: documentChange.version, changes: documentChange.changes.map(change => ({ ...change })), suppressed: textareaCompatibility.suppressInputEvent, length: update.length, lines: update.lines, nonWhitespaceCount: changeJournal.nonWhitespaceCount };
        for (const listener of documentChangeListeners) {
          try { listener(event); } catch (error) { console.error('Virtual editor document listener failed:', error); }
        }
      }
      if (!textareaCompatibility.suppressInputEvent) host.dispatchEvent(createSyntheticEvent(host, 'input', true));
    }
    if (update.selectionSet) host.dispatchEvent(createSyntheticEvent(host, 'select'));
  });
  function loadDocumentState(content, options = {}) {
    const length = codeMirrorIntegration.resetDocument(content, { selection: options.selection === 'end' ? 'end' : Number(options.selection), extensions: editorExtensions });
    const dynamicEffects = [hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({ tableVisualEditing: hybridTableVisualEditing, codeVisualEditing: hybridCodeVisualEditing }))];
    if (presentationMode === 'hybrid') dynamicEffects.push(presentationCompartment.reconfigure(hybridPresentationExtension));
    codeMirrorIntegration.dispatchEffects(dynamicEffects);
    changeJournal.version = 0;
    changeJournal.entries = [];
    changeJournal.nonWhitespaceCount = Number.isFinite(Number(options.nonWhitespaceCount)) ? Math.max(0, Number(options.nonWhitespaceCount) || 0) : countDocumentNonWhitespace(adapterApi);
    textareaCompatibility.invalidateValueCache();
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
        : countDocumentNonWhitespace(adapterApi);
      adapterApi.invalidateValueCache();
    },
    setPresentationMode(mode = 'source') {
      const nextMode = mode === 'hybrid' ? 'hybrid' : 'source';
      if (presentationMode === nextMode) return false;
      presentationMode = nextMode;
      codeMirrorIntegration.dispatchEffects(presentationCompartment.reconfigure(nextMode === 'hybrid' ? hybridPresentationExtension : []));
      return true;
    },
    getPresentationMode() {
      return presentationMode;
    },
    setHybridTableVisualEditing(enabled) {
      const next = Boolean(enabled);
      if (hybridTableVisualEditing === next) return false;
      hybridTableVisualEditing = next;
      codeMirrorIntegration.dispatchEffects(hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({
        tableVisualEditing: hybridTableVisualEditing,
        codeVisualEditing: hybridCodeVisualEditing
      })));
      return true;
    },
    getHybridTableVisualEditing() {
      return hybridTableVisualEditing;
    },
    setHybridCodeVisualEditing(enabled) {
      const next = Boolean(enabled);
      if (hybridCodeVisualEditing === next) return false;
      hybridCodeVisualEditing = next;
      codeMirrorIntegration.dispatchEffects(hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({
        tableVisualEditing: hybridTableVisualEditing,
        codeVisualEditing: hybridCodeVisualEditing
      })));
      return true;
    },
    getHybridCodeVisualEditing() {
      return hybridCodeVisualEditing;
    },
    getPresentationStats() {
      return presentationMode === 'hybrid'
        ? codeMirrorIntegration.readView(getHybridMarkdownStats)
        : { visibleLines: 0, decoratedLines: 0, headingLines: 0, sourceActiveLines: 0, hiddenMarkers: 0 };
    },
    getHybridComponentStates() {
      return codeMirrorIntegration.readView(getHybridComponentStateSnapshot);
    },
    resetHistory() {
      codeMirrorIntegration.resetHistory({ extensions: editorExtensions });
      const dynamicEffects = [
        hybridConfigurationCompartment.reconfigure(createHybridMarkdownConfiguration({
          tableVisualEditing: hybridTableVisualEditing,
          codeVisualEditing: hybridCodeVisualEditing
        }))
      ];
      if (presentationMode === 'hybrid') dynamicEffects.push(presentationCompartment.reconfigure(hybridPresentationExtension));
      codeMirrorIntegration.dispatchEffects(dynamicEffects);
      textareaCompatibility.invalidateValueCache();
    }
  });

  const onCompatibilityInput = event => { if (!event.__markdownEditorVirtualEditorSynthetic) event.stopImmediatePropagation(); };
  host.addEventListener('input', onCompatibilityInput);
  const unsubscribeScroll = adapterApi.subscribeScroll(() => { host.dispatchEvent(createSyntheticEvent(host, 'scroll')); });
  const destroyCodeMirrorAdapter = adapterApi.destroy.bind(adapterApi);
  let destroyed = false;
  adapterApi.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    unsubscribeAdapterUpdates();
    unsubscribeScroll();
    documentChangeListeners.clear();
    host.removeEventListener('input', onCompatibilityInput);
    textareaCompatibility.destroy();
    destroyCodeMirrorAdapter();
    if (host.virtualEditor === adapterApi) delete host.virtualEditor;
    host.classList.remove('virtual-editor-host');
    if (host.getAttribute('role') === 'textbox') host.removeAttribute('role');
    if (host.getAttribute('aria-multiline') === 'true') host.removeAttribute('aria-multiline');
  };

  host.virtualEditor = adapterApi;
  return adapterApi;
}
