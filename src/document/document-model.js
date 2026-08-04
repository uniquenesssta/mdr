const DEFAULT_MAX_JOURNAL_ENTRIES = 8192;
const DEFAULT_MAX_JOURNAL_CHARS = 16 * 1024 * 1024;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cloneChanges(changes) {
  return Array.from(changes || []).map(change => ({
    from: Math.max(0, Number(change.from) || 0),
    to: Math.max(0, Number(change.to) || 0),
    insert: String(change.insert ?? '')
  }));
}

function estimateChangeChars(changes) {
  return Array.from(changes || []).reduce((total, change) => (
    total + Math.max(0, Number(change.to) - Number(change.from)) + String(change.insert ?? '').length
  ), 0);
}

export class DocumentModel {
  constructor(editor, options = {}) {
    if (!editor?.virtualEditor) throw new Error('DocumentModel requires the virtual editor');
    this.editor = editor;
    this.api = editor.virtualEditor;
    this.documentId = '';
    this.title = '';
    this.generation = 0;
    this.version = this.api.getDocumentVersion?.() || 0;
    this.backendVersion = 0;
    this.dirty = false;
    this.journal = [];
    this.journalChars = 0;
    this.maxJournalEntries = Math.max(512, Number(options.maxJournalEntries) || DEFAULT_MAX_JOURNAL_ENTRIES);
    this.maxJournalChars = Math.max(1024 * 1024, Number(options.maxJournalChars) || DEFAULT_MAX_JOURNAL_CHARS);
    this.consumerVersions = new Map();
    this.listeners = new Set();
    this.suspendChanges = 0;
    this.initialChunks = null;
    this.unsubscribeEditor = this.api.subscribeDocumentChanges?.(entry => this.handleEditorChange(entry)) || null;
    this.api.useExternalDocumentJournal?.(true);
  }

  handleEditorChange(entry) {
    if (this.suspendChanges > 0 || !entry) return;
    this.initialChunks = null;
    const changes = cloneChanges(entry.changes);
    const version = Math.max(this.version + 1, Number(entry.version) || 0);
    const size = estimateChangeChars(changes);
    this.version = version;
    this.dirty = true;
    this.journal.push({ version, changes, size });
    this.journalChars += size;
    this.trimJournal();
    this.emit({
      type: 'change',
      documentId: this.documentId,
      generation: this.generation,
      version,
      changes,
      length: this.getTextLength(),
      lines: this.getLineCount(),
      nonWhitespaceCount: this.getNonWhitespaceCount()
    });
  }

  trimJournal() {
    if (!this.journal.length) return;
    const acknowledged = [...this.consumerVersions.values()].filter(Number.isFinite);
    const minimumAcknowledged = acknowledged.length ? Math.min(...acknowledged) : -1;
    while (this.journal.length > 1 && this.journal[0].version <= minimumAcknowledged) {
      const removed = this.journal.shift();
      this.journalChars -= removed.size;
    }
    while (
      this.journal.length > 1
      && (this.journal.length > this.maxJournalEntries || this.journalChars > this.maxJournalChars)
    ) {
      const removed = this.journal.shift();
      this.journalChars -= removed.size;
    }
    this.journalChars = Math.max(0, this.journalChars);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('DocumentModel listener failed:', error);
      }
    }
  }

  activate(document, options = {}) {
    const contentProvided = Object.prototype.hasOwnProperty.call(options, 'content');
    const chunksProvided = Array.isArray(options.chunks);
    this.suspendChanges += 1;
    try {
      let loadedWithStateReset = false;
      if (chunksProvided && this.api.loadDocumentChunks) {
        this.initialChunks = options.chunks.map(chunk => String(chunk ?? ''));
        this.api.loadDocumentChunks(this.initialChunks, {
          selection: 0,
          nonWhitespaceCount: options.loaded?.nonWhitespaceCount
        });
        loadedWithStateReset = true;
      } else if (chunksProvided && this.api.setDocumentChunks) {
        this.initialChunks = options.chunks.map(chunk => String(chunk ?? ''));
        this.api.setDocumentChunks(this.initialChunks);
      } else if (contentProvided && this.api.loadDocument) {
        this.initialChunks = null;
        this.api.loadDocument(String(options.content ?? ''), {
          selection: 0,
          nonWhitespaceCount: options.loaded?.nonWhitespaceCount
        });
        loadedWithStateReset = true;
      } else if (contentProvided) {
        this.initialChunks = null;
        this.editor.value = String(options.content ?? '');
      } else {
        this.initialChunks = null;
      }
      if (!loadedWithStateReset) this.api.resetDocumentJournal?.(options.loaded?.nonWhitespaceCount);
      this.documentId = String(document?.id || '');
      this.title = String(document?.title || '');
      this.backendVersion = Math.max(0, Number(options.loaded?.version ?? document?.nativeVersion) || 0);
      this.generation += 1;
      this.version = 0;
      this.dirty = false;
      this.journal = [];
      this.journalChars = 0;
      this.consumerVersions.clear();
    } finally {
      this.suspendChanges -= 1;
    }
    this.emit({
      type: 'reset',
      documentId: this.documentId,
      generation: this.generation,
      version: this.version,
      length: this.getTextLength(),
      lines: this.getLineCount(),
      backendVersion: this.backendVersion
    });
    return this.getState();
  }

  adoptDocument(document) {
    const nextId = String(document?.id || '');
    if (!nextId || this.documentId === nextId) return this.getState();
    if (this.documentId) throw new Error('DocumentModel can only adopt an identity for an unbound document');
    this.documentId = nextId;
    this.title = String(document?.title || '');
    this.generation += 1;
    this.emit({
      type: 'adopt',
      documentId: this.documentId,
      generation: this.generation,
      version: this.version,
      title: this.title,
      length: this.getTextLength(),
      lines: this.getLineCount()
    });
    return this.getState();
  }

  updateTitle(title) {
    const nextTitle = String(title || '');
    if (nextTitle === this.title) return;
    this.title = nextTitle;
    this.dirty = true;
    this.emit({
      type: 'metadata',
      documentId: this.documentId,
      generation: this.generation,
      version: this.version,
      title: this.title
    });
  }

  getDocumentVersion() {
    return this.version;
  }

  getTextLength() {
    return this.api.getTextLength?.() ?? this.editor.textLength ?? 0;
  }

  getLineCount() {
    return this.api.getLineCount?.() ?? this.editor.lineCount ?? 1;
  }

  getNonWhitespaceCount() {
    return this.api.getNonWhitespaceCount?.() ?? 0;
  }

  getLineNumberAtPosition(position) {
    return this.api.getLineNumberAtPosition?.(position) ?? 1;
  }

  getLineStart(lineNumber) {
    return this.api.getLineStart?.(lineNumber) ?? 0;
  }

  getLineEnd(lineNumber) {
    return this.api.getLineEnd?.(lineNumber) ?? 0;
  }

  sliceText(from = 0, to = this.getTextLength()) {
    return this.api.sliceText?.(from, to) ?? this.editor.value.slice(from, to);
  }

  createSnapshot(reason = 'explicit') {
    const clock = globalThis.performance?.now?.bind(globalThis.performance) || Date.now;
    const started = clock();
    const value = this.editor.value;
    globalThis.window?.markdownEditorPerf?.record?.('document.snapshot', {
      category: 'document.model',
      durationMs: clock() - started,
      aggregate: true,
      details: {
        reason: String(reason || 'explicit'),
        documentId: this.documentId,
        generation: this.generation,
        version: this.version,
        chars: value.length
      }
    });
    return value;
  }

  createSnapshotPayload(reason = 'explicit') {
    if (this.version === 0 && Array.isArray(this.initialChunks)) {
      return {
        source: null,
        sourceChunks: this.initialChunks.slice(),
        reason: String(reason || 'explicit')
      };
    }
    return {
      source: this.createSnapshot(reason),
      sourceChunks: null,
      reason: String(reason || 'explicit')
    };
  }

  releaseInitialChunks() {
    this.initialChunks = null;
  }

  getSelection() {
    return {
      from: Math.max(0, Number(this.editor.selectionStart) || 0),
      to: Math.max(0, Number(this.editor.selectionEnd) || 0)
    };
  }

  getVisibleRange() {
    const range = this.api.getVisibleRange?.();
    if (!range) return null;
    const length = this.getTextLength();
    const from = clamp(range.from, 0, length);
    const to = clamp(range.to, from, length);
    return { from, to };
  }

  findText(query, from = 0, options = {}) {
    return this.api.findText?.(query, from, options) || null;
  }

  replaceAllText(query, replacement) {
    return this.api.replaceAllText?.(query, replacement) || 0;
  }

  replaceRange(replacement, from, to, selectionMode = 'preserve') {
    const length = this.getTextLength();
    const start = clamp(Math.min(from, to), 0, length);
    const end = clamp(Math.max(from, to), start, length);
    this.editor.setRangeText(String(replacement ?? ''), start, end, selectionMode);
  }

  registerConsumer(consumerId, version = this.version) {
    if (!consumerId) return;
    const id = String(consumerId);
    const requested = clamp(version, 0, this.version);
    const current = this.consumerVersions.get(id);
    this.consumerVersions.set(id, Number.isFinite(current) ? Math.min(current, requested) : requested);
  }

  getDocumentChangesSince(version) {
    return this.getChangesSince(version);
  }

  getChangesSince(version, consumerId = '') {
    const requested = Math.max(0, Number(version) || 0);
    if (requested === this.version) return [];
    const firstVersion = this.journal[0]?.version ?? this.version + 1;
    if (requested < firstVersion - 1 || requested > this.version) return null;
    if (consumerId) this.registerConsumer(consumerId, requested);
    return this.journal
      .filter(entry => entry.version > requested)
      .map(entry => ({
        version: entry.version,
        changes: cloneChanges(entry.changes)
      }));
  }

  acknowledge(consumerId, version) {
    if (!consumerId) return;
    const acknowledged = clamp(version, 0, this.version);
    this.consumerVersions.set(String(consumerId), acknowledged);
    this.trimJournal();
  }

  releaseConsumer(consumerId) {
    if (!consumerId) return;
    this.consumerVersions.delete(String(consumerId));
    this.trimJournal();
  }

  markPersisted(editorVersion = this.version, backendVersion = this.backendVersion) {
    if (Number(editorVersion) >= this.version) this.dirty = false;
    this.backendVersion = Math.max(this.backendVersion, Number(backendVersion) || 0);
    this.acknowledge('storage', editorVersion);
    this.emit({
      type: 'persisted',
      documentId: this.documentId,
      generation: this.generation,
      version: Math.max(0, Number(editorVersion) || 0),
      backendVersion: this.backendVersion
    });
  }

  getState() {
    return {
      documentId: this.documentId,
      title: this.title,
      generation: this.generation,
      version: this.version,
      backendVersion: this.backendVersion,
      dirty: this.dirty,
      length: this.getTextLength(),
      lines: this.getLineCount(),
      journalEntries: this.journal.length,
      journalChars: this.journalChars
    };
  }

  destroy() {
    this.unsubscribeEditor?.();
    this.api.useExternalDocumentJournal?.(false);
    this.listeners.clear();
    this.consumerVersions.clear();
    this.journal = [];
    this.initialChunks = null;
  }
}

export function createDocumentModel(editor, options = {}) {
  return new DocumentModel(editor, options);
}
