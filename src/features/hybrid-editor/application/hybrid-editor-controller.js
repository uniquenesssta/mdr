
/**
 * Responsibility: Own one mounted Hybrid editor runtime session: decoration rebuild scheduling, deferred block publication and SOURCE-controller teardown ordering.
 * Imports: None. CodeMirror, DOM, model, Preview, telemetry and scheduling capabilities are injected by the editor integration boundary.
 * Exports: HybridEditorController and createHybridEditorController.
 * State/side effects: Owns inline decorations/stats, document-scoped source-drag presentation ranges and pending/applied block publication; document text and component SOURCE state remain delegated.
 * Lifecycle: Explicit instance lifecycle; destroy() is idempotent, invalidates queued publication and destroys injected owned resources exactly once.
 */

function requireFunction(name, value) {
  if (typeof value !== 'function') throw new TypeError(`Hybrid Editor Controller requires ${name}()`);
  return value;
}

function requireDestroyable(name, value) {
  if (!value || typeof value.destroy !== 'function') {
    throw new TypeError(`Hybrid Editor Controller requires ${name}.destroy()`);
  }
  return value;
}

export class HybridEditorController {
  constructor(options = {}) {
    if (!options.view) throw new TypeError('Hybrid Editor Controller requires a view');
    if (!options.decorationCoordinator || typeof options.decorationCoordinator.build !== 'function') {
      throw new TypeError('Hybrid Editor Controller requires a decoration coordinator');
    }
    this.view = options.view;
    this.decorationCoordinator = options.decorationCoordinator;
    this.sourceEditorPort = requireDestroyable('sourceEditorPort', options.sourceEditorPort);
    this.sourceEditController = requireDestroyable('sourceEditController', options.sourceEditController);
    this.sourceEditPortMount = requireDestroyable('sourceEditPortMount', options.sourceEditPortMount);
    this.dispatchBlockDecorations = requireFunction('dispatchBlockDecorations', options.dispatchBlockDecorations);
    this.isBlockDecorationUpdate = requireFunction('isBlockDecorationUpdate', options.isBlockDecorationUpdate);
    this.configurationChanged = requireFunction('configurationChanged', options.configurationChanged);
    this.destroyGeometry = requireFunction('destroyGeometry', options.destroyGeometry);
    this.destroySession = requireFunction('destroySession', options.destroySession);
    this.reportDiagnostic = typeof options.reportDiagnostic === 'function' ? options.reportDiagnostic : () => {};
    this.getViewDiagnosticDetails = typeof options.getViewDiagnosticDetails === 'function'
      ? options.getViewDiagnosticDetails
      : () => ({});
    this.enqueueMicrotask = typeof options.enqueueMicrotask === 'function'
      ? options.enqueueMicrotask
      : callback => queueMicrotask(callback);

    this.destroyed = false;
    this.blockDispatchQueued = false;
    this.blockDispatchGeneration = 0;
    this.pendingBlockDecorations = null;
    this.pendingBlockSignature = '';
    this.appliedBlockSignature = '';
    this.appliedBlockDocument = undefined;
    this.sourceSelectionDocument = this.view.state?.doc;
    this.sourceSelectionRanges = [];

    const built = this.decorationCoordinator.build(this.view);
    this.sourceSelectionRanges = built.editableSourceRanges || [];
    this.decorations = built.decorations;
    this.stats = built.stats;
    this.scheduleBlockUpdate(built.blockDecorations, built.blockSignature);
  }

  getDecorations() {
    return this.decorations;
  }

  getStats() {
    return this.stats;
  }

  refreshPresentation() {
    if (this.destroyed || this.view?.destroyed) return false;
    const built = this.decorationCoordinator.build(this.view, {
      sourceSelectionRanges: this.sourceSelectionDocument === this.view.state?.doc ? this.sourceSelectionRanges : []
    });
    this.sourceSelectionDocument = this.view.state?.doc;
    this.sourceSelectionRanges = built.editableSourceRanges || [];
    this.decorations = built.decorations;
    this.stats = built.stats;
    this.scheduleBlockUpdate(built.blockDecorations, built.blockSignature);
    return true;
  }

  closeSourceFromPointer(pointer = {}) {
    if (this.destroyed) return false;
    return this.sourceEditController.closeFromPointer(pointer);
  }

  scheduleBlockUpdate(blockDecorations, signature) {
    if (this.destroyed) return false;
    this.pendingBlockDecorations = blockDecorations;
    this.pendingBlockSignature = String(signature || '');
    if ((this.pendingBlockSignature === this.appliedBlockSignature
      && this.appliedBlockDocument === this.view.state?.doc) || this.blockDispatchQueued) return false;
    this.blockDispatchQueued = true;
    const generation = ++this.blockDispatchGeneration;
    this.enqueueMicrotask(() => {
      this.blockDispatchQueued = false;
      if (this.destroyed
        || generation !== this.blockDispatchGeneration
        || this.view?.destroyed
        || this.view?.dom?.isConnected === false
        || (this.pendingBlockSignature === this.appliedBlockSignature
          && this.appliedBlockDocument === this.view.state?.doc)) {
        return;
      }
      const nextSignature = this.pendingBlockSignature;
      const nextDecorations = this.pendingBlockDecorations;
      try {
        this.dispatchBlockDecorations(this.view, nextDecorations);
        this.appliedBlockSignature = nextSignature;
        this.appliedBlockDocument = this.view.state?.doc;
      } catch (error) {
        this.reportDiagnostic('hybrid.block-dispatch-failure', {
          status: 'error',
          dedupeKey: `hybrid.block-dispatch-failure:${error?.name || 'Error'}`,
          details: {
            ...this.getViewDiagnosticDetails(this.view),
            signatureLength: nextSignature.length,
            message: error?.message || String(error)
          }
        });
      }
    });
    return true;
  }

  update(update) {
    if (this.destroyed) return false;
    this.sourceEditController.handleEditorUpdate(update);
    const blockEffectOnly = this.isBlockDecorationUpdate(update);
    const needsRebuild = Boolean(
      update.docChanged
      || update.selectionSet
      || update.viewportChanged
      || update.focusChanged
      || this.configurationChanged(update)
    );
    if (!needsRebuild || (blockEffectOnly
      && !update.docChanged
      && !update.selectionSet
      && !update.viewportChanged
      && !update.focusChanged)) {
      return false;
    }
    return this.refreshPresentation();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.blockDispatchQueued = false;
    this.blockDispatchGeneration += 1;
    this.sourceEditPortMount.destroy();
    this.sourceEditController.destroy();
    this.sourceEditorPort.destroy();
    this.destroyGeometry();
    this.destroySession();
    this.pendingBlockDecorations = null;
    this.appliedBlockDocument = null;
    this.sourceSelectionDocument = null;
    this.sourceSelectionRanges = [];
    this.view = null;
  }
}

export function createHybridEditorController(options = {}) {
  return new HybridEditorController(options);
}
