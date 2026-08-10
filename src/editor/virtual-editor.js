import {
  createCodeMirrorAdapter,
  createCodeMirrorExtensionRegistry
} from '../features/editor/index.js';
import { getHybridComponentStateSnapshot } from './hybrid/component-state.js';
import { getHybridMarkdownStats } from './hybrid-markdown.js';

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

function installTextareaCompatibility(host, adapter, extensionRegistry) {
  let suppressInputEvent = 0;
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
    placeholder: { configurable: true, get() { return extensionRegistry.snapshot.placeholder; }, set(value) { const nextValue = String(value ?? ''); extensionRegistry.setPlaceholder(nextValue); host.setAttribute('data-placeholder', nextValue); } },
    readOnly: { configurable: true, get() { return extensionRegistry.snapshot.readOnly; }, set(value) { adapter.setReadOnly(Boolean(value)); } }
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

  const extensionRegistry = createCodeMirrorExtensionRegistry({
    placeholder: host.getAttribute('data-placeholder') || ''
  });
  let adapterApi = null;

  const { api: codeMirrorApi, integration: codeMirrorIntegration } = createCodeMirrorAdapter({
    parent: host,
    initialValue,
    extensions: extensionRegistry.getExtensions(),
    markProgrammaticScroll(duration) { window.markdownEditorScrollSync?.markProgrammaticScroll?.('editor', duration); },
    suspendScrollSync(duration) { window.markdownEditorScrollSync?.suspend?.(duration); },
    reportError(message, error) { console.error(message, error); }
  });
  adapterApi = codeMirrorApi;
  const detachExtensionRegistry = extensionRegistry.attach(codeMirrorIntegration.dispatchEffects);
  adapterApi.setReadOnly = value => extensionRegistry.setReadOnly(Boolean(value));
  const textareaCompatibility = installTextareaCompatibility(host, adapterApi, extensionRegistry);
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
    const length = codeMirrorIntegration.resetDocument(content, {
      selection: options.selection === 'end' ? 'end' : Number(options.selection),
      extensions: extensionRegistry.getExtensions()
    });
    changeJournal.version = 0;
    changeJournal.entries = [];
    changeJournal.nonWhitespaceCount = Number.isFinite(Number(options.nonWhitespaceCount)) ? Math.max(0, Number(options.nonWhitespaceCount) || 0) : countDocumentNonWhitespace(adapterApi);
    textareaCompatibility.invalidateValueCache();
    return length;
  }

  Object.assign(adapterApi, {
    loadDocument(content, options = {}) {
      return loadDocumentState(content, options);
    },
    loadDocumentChunks(chunks, options = {}) {
      return loadDocumentState(Array.from(chunks || []), options);
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
      return extensionRegistry.setPresentationMode(mode);
    },
    getPresentationMode() {
      return extensionRegistry.snapshot.presentationMode;
    },
    setHybridTableVisualEditing(enabled) {
      return extensionRegistry.setHybridTableVisualEditing(enabled);
    },
    getHybridTableVisualEditing() {
      return extensionRegistry.snapshot.hybridTableVisualEditing;
    },
    setHybridCodeVisualEditing(enabled) {
      return extensionRegistry.setHybridCodeVisualEditing(enabled);
    },
    getHybridCodeVisualEditing() {
      return extensionRegistry.snapshot.hybridCodeVisualEditing;
    },
    getPresentationStats() {
      return extensionRegistry.snapshot.presentationMode === 'hybrid'
        ? codeMirrorIntegration.readView(getHybridMarkdownStats)
        : { visibleLines: 0, decoratedLines: 0, headingLines: 0, sourceActiveLines: 0, hiddenMarkers: 0 };
    },
    getHybridComponentStates() {
      return codeMirrorIntegration.readView(getHybridComponentStateSnapshot);
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
    detachExtensionRegistry();
    extensionRegistry.destroy();
    destroyCodeMirrorAdapter();
    if (host.virtualEditor === adapterApi) delete host.virtualEditor;
    host.classList.remove('virtual-editor-host');
    if (host.getAttribute('role') === 'textbox') host.removeAttribute('role');
    if (host.getAttribute('aria-multiline') === 'true') host.removeAttribute('aria-multiline');
  };

  host.virtualEditor = adapterApi;
  return adapterApi;
}
