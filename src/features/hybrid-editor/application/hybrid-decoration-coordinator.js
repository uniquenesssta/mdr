
/**
 * Responsibility: Build one immutable Hybrid decoration result by coordinating frozen block/range readers, block widget projection and Inline Presentation through injected capabilities.
 * Imports: None. Editor, frozen-model, Preview and CodeMirror capabilities must be injected by the editor integration boundary.
 * Exports: HybridDecorationCoordinator and createHybridDecorationCoordinator.
 * State/side effects: Owns no document or component state; emits only injected diagnostics while producing decoration/stat snapshots.
 * Lifecycle: Pure coordinator instance with no listeners, timers or destroy work.
 */

const EMPTY_HYBRID_STATS = Object.freeze({
  visibleLines: 0,
  decoratedLines: 0,
  headingLines: 0,
  sourceActiveLines: 0,
  hiddenMarkers: 0,
  renderedBlocks: 0,
  codeBlocks: 0,
  tableBlocks: 0,
  imageBlocks: 0,
  mathBlocks: 0,
  mermaidBlocks: 0,
  htmlBlocks: 0,
  htmlFallbackBlocks: 0
});

function requireFunction(name, value) {
  if (typeof value !== 'function') throw new TypeError(`Hybrid Decoration Coordinator requires ${name}()`);
  return value;
}

function hashText(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function countBlockTypes(blocks) {
  const counts = { code: 0, mermaid: 0, table: 0, image: 0, math: 0, html: 0 };
  for (const block of blocks) {
    if (Object.hasOwn(counts, block.type)) counts[block.type] += 1;
  }
  return counts;
}

export class HybridDecorationCoordinator {
  constructor(options = {}) {
    this.getSyntaxTree = requireFunction('getSyntaxTree', options.getSyntaxTree);
    this.getEditableRanges = requireFunction('getEditableRanges', options.getEditableRanges);
    this.getActiveSourceRange = requireFunction('getActiveSourceRange', options.getActiveSourceRange);
    this.collectHybridBlocks = requireFunction('collectHybridBlocks', options.collectHybridBlocks);
    this.buildInlinePresentation = requireFunction('buildInlinePresentation', options.buildInlinePresentation);
    this.createBlockDecoration = requireFunction('createBlockDecoration', options.createBlockDecoration);
    this.createDecorationSet = requireFunction('createDecorationSet', options.createDecorationSet);
    this.getTableVisualEditing = requireFunction('getTableVisualEditing', options.getTableVisualEditing);
    this.getCodeVisualEditing = requireFunction('getCodeVisualEditing', options.getCodeVisualEditing);
    this.reportDiagnostic = typeof options.reportDiagnostic === 'function' ? options.reportDiagnostic : () => {};
    this.getViewDiagnosticDetails = typeof options.getViewDiagnosticDetails === 'function'
      ? options.getViewDiagnosticDetails
      : () => ({});
    this.now = typeof options.now === 'function' ? options.now : () => 0;
    this.emptyDecorations = options.emptyDecorations;
  }

  getEmptyStats() {
    return { ...EMPTY_HYBRID_STATS };
  }

  getBlockPresentationRange(view, descriptor) {
    const from = Math.max(0, Number(descriptor?.from) || 0);
    let to = Math.max(from, Number(descriptor?.to) || from);
    const type = String(descriptor?.type || '');
    if ((type === 'code' || type === 'mermaid')
      && to === view.state.doc.length
      && to > from
      && view.state.doc.sliceString(Math.max(from, to - 2), to) === '\n\n') {
      to -= 1;
    }
    return { from, to };
  }

  validateBlocks(view, blocks) {
    const documentLength = view.state.doc.length;
    const valid = [];
    const invalid = [];
    let previousEnd = -1;
    for (const block of blocks) {
      const from = Number(block?.from);
      const to = Number(block?.to);
      const rangeValid = Number.isInteger(from)
        && Number.isInteger(to)
        && from >= 0
        && to > from
        && to <= documentLength
        && from >= previousEnd;
      if (!rangeValid) {
        invalid.push({ type: String(block?.type || ''), from, to });
        continue;
      }
      valid.push(block);
      previousEnd = to;
    }
    if (invalid.length) {
      this.reportDiagnostic('hybrid.invalid-block-range', {
        status: 'warning',
        dedupeKey: 'hybrid.invalid-block-range',
        details: {
          ...this.getViewDiagnosticDetails(view),
          invalidCount: invalid.length,
          invalid: invalid.slice(0, 6)
        }
      });
    }
    return valid;
  }

  getBlockSignature(blocks, options = {}) {
    return blocks.map(block => {
      let content = '';
      if (block.type === 'code' || block.type === 'mermaid') {
        content = `${block.fingerprint || `${block.language}\0${block.code}`}\0visual-edit:${Boolean(options.codeVisualEditing)}`;
      } else if (block.type === 'table') {
        content = `${block.fingerprint}\0visual-edit:${Boolean(options.tableVisualEditing)}`;
      } else if (block.type === 'image') content = `${block.source}\0${block.alt}\0${block.title}`;
      else if (block.type === 'math') content = `${block.fingerprint}\0${block.formula}`;
      else if (block.type === 'html') content = block.fingerprint || block.source || '';
      return `${block.type}:${block.from}:${block.to}:${hashText(content)}`;
    }).join('|');
  }

  build(view) {
    const started = this.now();
    try {
      const tree = this.getSyntaxTree(view);
      const editableRanges = this.getEditableRanges(view, tree);
      const activeSourceRange = this.getActiveSourceRange(view) || null;
      const protectedSourceRanges = activeSourceRange ? [activeSourceRange] : [];
      const blocks = this.validateBlocks(
        view,
        this.collectHybridBlocks(view, tree, protectedSourceRanges)
      );
      const blockRanges = blocks.map(block => this.getBlockPresentationRange(view, block));
      const blockDecorationRanges = [];
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        try {
          const decoration = this.createBlockDecoration(view, block, blockRanges[index]);
          if (decoration) blockDecorationRanges.push(decoration);
        } catch (error) {
          this.reportDiagnostic('hybrid.widget-build-failure', {
            status: 'error',
            dedupeKey: `hybrid.widget-build-failure:${block.type}`,
            details: {
              ...this.getViewDiagnosticDetails(view),
              blockType: block.type,
              blockFrom: block.from,
              blockTo: block.to,
              message: error?.message || String(error)
            }
          });
        }
      }

      const inline = this.buildInlinePresentation(
        view,
        tree,
        editableRanges,
        blockRanges,
        protectedSourceRanges
      );
      const blockCounts = countBlockTypes(blocks);
      const fallbackHtmlBlocks = blocks.filter(block => block.type === 'html' && block.discovery === 'fallback');
      if (fallbackHtmlBlocks.length) {
        const fallbackChars = fallbackHtmlBlocks.reduce(
          (total, block) => total + Math.max(0, block.to - block.from),
          0
        );
        this.reportDiagnostic('hybrid.html-range-fallback', {
          status: 'ok',
          dedupeKey: `hybrid.html-range-fallback:${fallbackHtmlBlocks.map(block => `${block.from}-${block.to}`).join(',')}`,
          details: {
            ...this.getViewDiagnosticDetails(view),
            fallbackCount: fallbackHtmlBlocks.length,
            fallbackChars,
            ranges: fallbackHtmlBlocks.slice(0, 8).map(block => ({ from: block.from, to: block.to }))
          }
        });
      }

      const result = {
        decorations: this.createDecorationSet(inline.ranges),
        blockDecorations: this.createDecorationSet(blockDecorationRanges),
        blockSignature: this.getBlockSignature(blocks, {
          tableVisualEditing: this.getTableVisualEditing(view),
          codeVisualEditing: this.getCodeVisualEditing(view)
        }),
        stats: {
          ...inline.stats,
          renderedBlocks: blocks.length,
          codeBlocks: blockCounts.code,
          mermaidBlocks: blockCounts.mermaid,
          tableBlocks: blockCounts.table,
          imageBlocks: blockCounts.image,
          mathBlocks: blockCounts.math,
          htmlBlocks: blockCounts.html,
          htmlFallbackBlocks: fallbackHtmlBlocks.length
        }
      };
      const durationMs = this.now() - started;
      if (durationMs >= 24) {
        this.reportDiagnostic('hybrid.slow-decoration-build', {
          status: 'warning',
          dedupeKey: 'hybrid.slow-decoration-build',
          fingerprint: `${Math.round(durationMs / 8)}:${view.state.doc.length}:${blocks.length}`,
          details: {
            ...this.getViewDiagnosticDetails(view),
            durationMs: Number(durationMs.toFixed(3)),
            editableRanges: editableRanges.length,
            renderedBlocks: blocks.length,
            decoratedLines: inline.stats.decoratedLines || 0
          }
        });
      }
      return result;
    } catch (error) {
      this.reportDiagnostic('hybrid.decoration-build-failure', {
        status: 'error',
        dedupeKey: `hybrid.decoration-build-failure:${error?.name || 'Error'}`,
        details: {
          ...this.getViewDiagnosticDetails(view),
          message: error?.message || String(error)
        }
      });
      return {
        decorations: this.emptyDecorations,
        blockDecorations: this.emptyDecorations,
        blockSignature: '',
        stats: this.getEmptyStats()
      };
    }
  }
}

export function createHybridDecorationCoordinator(options = {}) {
  return new HybridDecorationCoordinator(options);
}
