import { createPreviewWorkerSession } from '../features/preview/index.js';

function createWorker() {
  return new Worker(new URL('./preview-worker.js', import.meta.url), { type: 'module' });
}

function normalizeBlockIds(ids) {
  return [...new Set(Array.from(ids || []).map(String).filter(Boolean))];
}

function resolveDocumentSource(source) {
  if (source && typeof source.getDocumentVersion === 'function') return source;
  return source?.virtualEditor || null;
}

function getSourceSelection(source, editor) {
  const selection = source?.getSelection?.();
  if (selection) return selection;
  return {
    from: Math.max(0, Number(editor?.selectionStart) || 0),
    to: Math.max(0, Number(editor?.selectionEnd) || 0)
  };
}

function getSourceVisibleRange(source, editor) {
  const range = source?.getVisibleRange?.() || editor?.virtualEditor?.getVisibleRange?.();
  if (!range) return null;
  const from = Math.max(0, Number(range.from) || 0);
  const to = Math.max(from, Number(range.to) || from);
  return { from, to };
}

function resolvePreviewFocusPosition(source, editor, selection) {
  const visibleRange = getSourceVisibleRange(source, editor);
  const selectionPosition = Math.max(0, Number(selection?.from) || 0);
  if (!visibleRange) return selectionPosition;
  if (selectionPosition < visibleRange.from || selectionPosition > visibleRange.to) {
    return Math.floor((visibleRange.from + visibleRange.to) / 2);
  }
  return selectionPosition;
}

export class PreviewWorkerClient {
  constructor() {
    this.session = createPreviewWorkerSession({ createWorker });
    this.active = null;
    this.pendingUpdate = null;
    this.pendingPrewarm = null;
    this.blocks = [];
    this.referenceDefinitions = '';
    this.headings = [];
    this.statistics = null;
    this.documentSource = null;
  }

  update(documentSource, source, forceFull = false, options = {}) {
    const api = resolveDocumentSource(documentSource);
    if (api && this.documentSource !== api) {
      this.documentSource?.releaseConsumer?.('preview');
      this.documentSource = api;
    }
    const editor = documentSource?.editor || documentSource;
    const version = api?.getDocumentVersion?.() ?? 0;
    const sessionState = this.session.snapshot;
    api?.registerConsumer?.('preview', sessionState.initialized ? sessionState.syncedVersion : version);
    const selection = getSourceSelection(api, editor);
    const focusPosition = resolvePreviewFocusPosition(api, editor, selection);
    const focusLine = api?.getLineNumberAtPosition?.(focusPosition) || 1;
    const getSource = typeof source === 'function'
      ? source
      : () => String(source ?? '');
    return new Promise((resolve, reject) => {
      const request = {
        kind: 'update',
        documentSource: api,
        editor,
        getSource,
        forceFull,
        indexOnly: Boolean(options.indexOnly),
        version,
        focusLine,
        resolve,
        reject
      };
      if (this.active) {
        if (this.pendingUpdate) this.pendingUpdate.resolve({ cancelled: true });
        this.pendingUpdate = request;
        return;
      }
      this.startUpdate(request);
    });
  }

  prewarmBlocks(ids) {
    const blockIds = normalizeBlockIds(ids);
    const sessionState = this.session.snapshot;
    if (!sessionState.initialized || !blockIds.length) {
      return Promise.resolve({ cancelled: !sessionState.initialized, renderedBlocks: [] });
    }
    return new Promise((resolve, reject) => {
      const request = {
        kind: 'prewarm',
        ids: blockIds,
        version: sessionState.syncedVersion,
        resolve,
        reject
      };
      if (this.active) {
        if (this.pendingPrewarm) this.pendingPrewarm.resolve({ cancelled: true, renderedBlocks: [] });
        this.pendingPrewarm = request;
        return;
      }
      this.startPrewarm(request);
    });
  }

  startUpdate(request) {
    const sessionState = this.session.snapshot;
    const api = request.documentSource || resolveDocumentSource(request.editor);
    let type;
    let payload;
    if (!sessionState.initialized) {
      const snapshot = typeof api?.createSnapshotPayload === 'function'
        ? api.createSnapshotPayload('preview-worker-reset')
        : { source: request.getSource(), sourceChunks: null };
      type = 'reset';
      payload = {
        source: snapshot.source,
        sourceChunks: snapshot.sourceChunks,
        forceFull: request.forceFull,
        indexOnly: request.indexOnly,
        focusLine: request.focusLine
      };
    } else {
      const transactions = typeof api?.getChangesSince === 'function'
        ? api.getChangesSince(sessionState.syncedVersion, 'preview')
        : api?.getDocumentChangesSince?.(sessionState.syncedVersion);
      if (!Array.isArray(transactions)) {
        const snapshot = typeof api?.createSnapshotPayload === 'function'
          ? api.createSnapshotPayload('preview-worker-resync')
          : { source: request.getSource(), sourceChunks: null };
        type = 'reset';
        payload = {
          source: snapshot.source,
          sourceChunks: snapshot.sourceChunks,
          forceFull: request.forceFull,
          indexOnly: request.indexOnly,
          focusLine: request.focusLine
        };
      } else {
        type = 'transactions';
        payload = {
          transactions,
          forceFull: request.forceFull,
          indexOnly: request.indexOnly,
          focusLine: request.focusLine
        };
      }
    }

    const active = {
      ...request,
      wasInitialized: sessionState.initialized,
      requestType: type
    };
    this.active = active;
    void this.session.request(type, { version: request.version, payload }).then(
      message => this.handleSessionSuccess(message, active),
      error => this.handleSessionFailure(error, active)
    );
  }

  startPrewarm(request) {
    const sessionState = this.session.snapshot;
    if (!sessionState.initialized || request.version !== sessionState.syncedVersion) {
      request.resolve({ cancelled: true, renderedBlocks: [] });
      this.startNext();
      return;
    }
    const active = {
      ...request,
      wasInitialized: true,
      requestType: 'render-window'
    };
    this.active = active;
    void this.session.request('render-window', {
      version: request.version,
      payload: { ids: request.ids }
    }).then(
      message => this.handleSessionSuccess(message, active),
      error => this.handleSessionFailure(error, active)
    );
  }

  applyRenderedBlocks(renderedBlocks) {
    if (!Array.isArray(renderedBlocks) || !renderedBlocks.length) return [];
    const htmlById = new Map(renderedBlocks.map(item => [item.id, item.html]));
    this.blocks = this.blocks.map(block => htmlById.has(block.id)
      ? { ...block, html: htmlById.get(block.id) }
      : block);
    return renderedBlocks;
  }

  applyUpdateResult(message, active) {
    const workerVersion = this.session.snapshot.syncedVersion;
    const result = message.result || {};
    if (Array.isArray(result.fullBlocks)) {
      this.blocks = result.fullBlocks;
    } else if (result.blockPatch) {
      const patch = result.blockPatch;
      const start = Math.max(0, Number(patch.start) || 0);
      const deleteCount = Math.max(0, Number(patch.deleteCount) || 0);
      const inserted = Array.isArray(patch.blocks) ? patch.blocks : [];
      const offsetDelta = Number(patch.tailOffsetDelta) || 0;
      const lineDelta = Number(patch.tailLineDelta) || 0;
      const prefix = this.blocks.slice(0, start);
      const oldTail = this.blocks.slice(start + deleteCount);
      const tail = offsetDelta || lineDelta
        ? oldTail.map(block => ({
            ...block,
            start: block.start + offsetDelta,
            end: block.end + offsetDelta,
            startLine: Math.max(1, block.startLine + lineDelta),
            endLine: Math.max(1, block.endLine + lineDelta)
          }))
        : oldTail;
      this.blocks = [...prefix, ...inserted, ...tail];
    }
    const headingIndexChanged = Array.isArray(result.headings) || Boolean(result.headingPatch);
    if (Array.isArray(result.headings)) {
      this.headings = result.headings.map(item => ({ ...item }));
    } else if (result.headingPatch) {
      const patch = result.headingPatch;
      const removed = new Set(Array.from(patch.removedBlockIds || []).map(String));
      const lineDelta = Number(patch.tailLineDelta) || 0;
      const oldTailStartLine = Number(patch.oldTailStartLine) || 0;
      this.headings = this.headings
        .filter(item => !removed.has(String(item.blockId || '')))
        .map(item => lineDelta && oldTailStartLine > 0 && item.line >= oldTailStartLine
          ? { ...item, line: Math.max(1, item.line + lineDelta) }
          : item);
      for (const heading of patch.headings || []) this.headings.push({ ...heading });
      this.headings.sort((left, right) => left.line - right.line || left.level - right.level);
    }
    if (result.statistics && typeof result.statistics === 'object') this.statistics = { ...result.statistics };
    if (typeof result.referenceDefinitions === 'string') {
      this.referenceDefinitions = result.referenceDefinitions;
    }
    if (result.referenceDefinitionsChanged) {
      const invalidated = new Set(result.changedIds || []);
      this.blocks = this.blocks.map(block => {
        if (!invalidated.has(block.id) || typeof block.html !== 'string') return block;
        const next = { ...block };
        delete next.html;
        return next;
      });
    }
    this.applyRenderedBlocks(result.renderedBlocks);
    active.documentSource?.acknowledge?.('preview', workerVersion);
    if (!active.wasInitialized) active.documentSource?.releaseInitialChunks?.();
    return {
      ...result,
      blocks: this.blocks,
      changedIds: new Set(result.changedIds || []),
      removedIds: new Set(result.removedIds || []),
      workerDurationMs: Number(message.durationMs) || 0,
      documentVersion: workerVersion,
      referenceDefinitions: this.referenceDefinitions,
      headings: this.headings,
      statistics: this.statistics,
      headingIndexChanged
    };
  }

  handleSessionSuccess(message, active) {
    if (this.active !== active) return;
    this.active = null;

    if (active.kind === 'prewarm') {
      const sessionState = this.session.snapshot;
      if (!sessionState.initialized || Number(message.version) !== sessionState.syncedVersion) {
        active.resolve({ cancelled: true, renderedBlocks: [] });
      } else {
        const renderedBlocks = this.applyRenderedBlocks(message.renderedBlocks || message.result?.renderedBlocks || []);
        active.resolve({
          cancelled: false,
          renderedBlocks,
          workerDurationMs: Number(message.durationMs) || 0,
          documentVersion: sessionState.syncedVersion
        });
      }
      this.startNext();
      return;
    }

    active.resolve(this.applyUpdateResult(message, active));
    this.startNext();
  }

  handleSessionFailure(error, active) {
    if (this.active !== active) return;
    this.active = null;
    const normalized = error instanceof Error ? error : new Error(String(error));
    active.reject(normalized);
    this.resetCachedState();

    if (normalized.previewWorkerSessionFault === 'worker') {
      if (this.pendingUpdate) {
        this.pendingUpdate.reject(normalized);
        this.pendingUpdate = null;
      }
      if (this.pendingPrewarm) {
        this.pendingPrewarm.resolve({ cancelled: true, renderedBlocks: [] });
        this.pendingPrewarm = null;
      }
    }
    this.startNext();
  }

  startNext() {
    if (this.active) return;
    if (this.pendingUpdate) {
      const next = this.pendingUpdate;
      this.pendingUpdate = null;
      this.startUpdate(next);
      return;
    }
    if (this.pendingPrewarm) {
      const next = this.pendingPrewarm;
      this.pendingPrewarm = null;
      this.startPrewarm(next);
    }
  }

  resetCachedState() {
    this.documentSource?.releaseConsumer?.('preview');
    this.blocks = [];
    this.referenceDefinitions = '';
    this.headings = [];
    this.statistics = null;
    this.documentSource = null;
  }

  destroy() {
    const active = this.active;
    this.active = null;
    if (active) {
      active.resolve(active.kind === 'prewarm'
        ? { cancelled: true, renderedBlocks: [] }
        : { cancelled: true });
    }
    if (this.pendingUpdate) this.pendingUpdate.resolve({ cancelled: true });
    if (this.pendingPrewarm) this.pendingPrewarm.resolve({ cancelled: true, renderedBlocks: [] });
    this.pendingUpdate = null;
    this.pendingPrewarm = null;
    this.resetCachedState();
    this.session.destroy();
  }
}

export function createPreviewWorkerClient() {
  return new PreviewWorkerClient();
}