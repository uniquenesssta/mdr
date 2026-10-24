/**
 * Responsibility: Compose the Editor adapter, extensions, host events and document change journal.
 * Imports: Editor infrastructure and the public Hybrid feature only.
 * Exports: createVirtualEditor; application callers use the Editor public entry.
 * State/side effects: One adapter, journal and owned subscriptions per host; no DOM value/selection projection or text cache.
 * Lifecycle: Explicit create and idempotent destroy release subscriptions, extensions and CodeMirror.
 */
import { createCodeMirrorAdapter } from './codemirror-editor-adapter.js';
import { createCodeMirrorExtensionRegistry } from './codemirror-extension-registry.js';
import { getHybridComponentStateSnapshot } from '../../hybrid-editor/index.js';
import { getHybridMarkdownStats } from './codemirror-hybrid-extension.js';

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

const editors = new WeakMap();

export function createVirtualEditor(host, { scrollSync = null } = {}) {
  if (scrollSync !== null && (typeof scrollSync.markProgrammaticScroll !== 'function' || typeof scrollSync.suspend !== 'function')) {
    throw new TypeError('Virtual Editor scrollSync requires markProgrammaticScroll/suspend');
  }
  if (!host) return null;
  if (editors.has(host)) return editors.get(host);

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
    markProgrammaticScroll(duration) { scrollSync?.markProgrammaticScroll?.('editor', duration); },
    suspendScrollSync(duration) { scrollSync?.suspend?.(duration); },
    reportError(message, error) { console.error(message, error); }
  });
  adapterApi = codeMirrorApi;
  const detachExtensionRegistry = extensionRegistry.attach(codeMirrorIntegration.dispatchEffects);
  adapterApi.setReadOnly = value => extensionRegistry.setReadOnly(Boolean(value));
  let programmaticChanges = 0;
  adapterApi.runProgrammaticChange = callback => {
    programmaticChanges += 1;
    try { return callback(); } finally { programmaticChanges -= 1; }
  };
  const setDocumentChunks = adapterApi.setDocumentChunks.bind(adapterApi);
  adapterApi.setDocumentChunks = (chunks, options) => adapterApi.runProgrammaticChange(() => setDocumentChunks(chunks, options));
  adapterApi.setPlaceholder = value => {
    const text = String(value ?? '');
    extensionRegistry.setPlaceholder(text);
    host.setAttribute('data-placeholder', text);
  };

  const unsubscribeAdapterUpdates = adapterApi.subscribe(update => {
    const documentChange = recordDocumentChanges(update);
    if (update.docChanged) {
      if (documentChange) {
        const event = { version: documentChange.version, changes: documentChange.changes.map(change => ({ ...change })), suppressed: programmaticChanges > 0, length: update.length, lines: update.lines, nonWhitespaceCount: changeJournal.nonWhitespaceCount };
        for (const listener of documentChangeListeners) {
          try { listener(event); } catch (error) { console.error('Virtual editor document listener failed:', error); }
        }
      }
    }
  });
  function loadDocumentState(content, options = {}) {
    const length = codeMirrorIntegration.resetDocument(content, {
      selection: options.selection === 'end' ? 'end' : Number(options.selection),
      extensions: extensionRegistry.getExtensions()
    });
    changeJournal.version = 0;
    changeJournal.entries = [];
    changeJournal.nonWhitespaceCount = Number.isFinite(Number(options.nonWhitespaceCount)) ? Math.max(0, Number(options.nonWhitespaceCount) || 0) : countDocumentNonWhitespace(adapterApi);
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

  const destroyCodeMirrorAdapter = adapterApi.destroy.bind(adapterApi);
  let destroyed = false;
  adapterApi.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    unsubscribeAdapterUpdates();
    documentChangeListeners.clear();
    detachExtensionRegistry();
    extensionRegistry.destroy();
    destroyCodeMirrorAdapter();
    if (editors.get(host) === adapterApi) editors.delete(host);
    host.classList.remove('virtual-editor-host');
    if (host.getAttribute('role') === 'textbox') host.removeAttribute('role');
    if (host.getAttribute('aria-multiline') === 'true') host.removeAttribute('aria-multiline');
  };

  editors.set(host, adapterApi);
  return adapterApi;
}
