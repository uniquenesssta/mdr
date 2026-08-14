/**
 * Responsibility: Select the Stage 7 preview render target from model output and mode policy.
 * Imports: Preview Mode Resolver and frozen preview thresholds only.
 * Exports: createPreviewRenderCoordinator().
 * State/side effects: Owns only lifecycle state; never reads DOM, settings UI, Worker or persistence state.
 * Lifecycle: createPlan()/execute() reject after destroy().
 */
import { resolvePreviewMode } from './preview-mode-resolver.js';
import { PREVIEW_BEHAVIOR_THRESHOLDS } from './preview-thresholds.js';

const STRATEGIES = Object.freeze({
  STABLE_REUSE: 'stable-reuse',
  DOM_WHOLE_DOCUMENT: 'dom-whole-document',
  VIRTUAL_MOUNT: 'virtual-mount',
  CHAPTER_VIEW: 'chapter-view',
  DOM_INCREMENTAL: 'dom-incremental'
});

function chapterPreviewResult(result, minimumBlocks) {
  const chapter = result?.focusChapter;
  const blocks = Array.isArray(result?.blocks) ? result.blocks : [];
  if (!chapter || !blocks.length) return result;

  const chapterStartIndex = Math.max(0, Math.min(blocks.length - 1, Number(chapter.startIndex) || 0));
  const chapterEndIndex = Math.max(
    chapterStartIndex + 1,
    Math.min(blocks.length, Number(chapter.endIndex) || blocks.length)
  );
  let startIndex = chapterStartIndex;
  let endIndex = chapterEndIndex;
  if (endIndex - startIndex < minimumBlocks) {
    const missing = minimumBlocks - (endIndex - startIndex);
    startIndex = Math.max(0, startIndex - Math.ceil(missing / 2));
    endIndex = Math.min(blocks.length, Math.max(chapterEndIndex, startIndex + minimumBlocks));
    startIndex = Math.max(0, Math.min(startIndex, endIndex - minimumBlocks));
  }

  const chapterBlocks = blocks.slice(startIndex, endIndex);
  const chapterIds = new Set(chapterBlocks.map(block => block.id));
  return {
    ...result,
    blocks: chapterBlocks,
    changedIds: new Set([...(result.changedIds || [])].filter(id => chapterIds.has(id))),
    removedIds: new Set(result.removedIds || []),
    previewScopeKey: 'chapter:'
      + (chapter.headingId || chapter.startLine || chapterStartIndex)
      + ':' + (chapter.endLine || chapterEndIndex)
      + ':' + startIndex + '-' + endIndex
  };
}

function requireRenderer(renderers, name) {
  const renderer = renderers?.[name];
  if (typeof renderer !== 'function') {
    throw new TypeError('Preview Render Coordinator requires renderer port: ' + name);
  }
  return renderer;
}

export function createPreviewRenderCoordinator({
  resolveMode = resolvePreviewMode,
  thresholds = PREVIEW_BEHAVIOR_THRESHOLDS
} = {}) {
  if (typeof resolveMode !== 'function') {
    throw new TypeError('Preview Render Coordinator requires resolveMode');
  }
  const minimumChapterBlocks = Number(thresholds?.chapter?.minimumBlocks);
  if (!Number.isSafeInteger(minimumChapterBlocks) || minimumChapterBlocks < 1) {
    throw new TypeError('Preview Render Coordinator requires chapter.minimumBlocks');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Preview Render Coordinator is destroyed.');
  };

  return Object.freeze({
    createPlan({
      modelResult,
      sourceLength = 0,
      previewPerformanceMode = 'auto',
      previousMode = 'full',
      previousScopeKey = previousMode,
      forceFullRebuild = false
    } = {}) {
      assertActive();
      const result = modelResult && typeof modelResult === 'object' ? modelResult : {};
      const blocks = Array.isArray(result.blocks) ? result.blocks : [];
      const normalizedSourceLength = Math.max(0, Number(sourceLength) || 0);
      const mode = resolveMode({ previewPerformanceMode }, normalizedSourceLength, blocks.length);
      const renderResult = mode === 'chapter'
        ? chapterPreviewResult(result, minimumChapterBlocks)
        : result;
      const scopeKey = mode === 'chapter'
        ? (renderResult?.previewScopeKey || 'chapter:document')
        : mode;
      const scopeChanged = mode !== previousMode || scopeKey !== previousScopeKey;
      const forceRender = Boolean(forceFullRebuild || scopeChanged);

      let strategy = STRATEGIES.DOM_INCREMENTAL;
      if (result.reason === 'unchanged' && !forceRender) {
        strategy = STRATEGIES.STABLE_REUSE;
      } else if (result.wholeDocument && result.wholeHtml && mode === 'full') {
        strategy = STRATEGIES.DOM_WHOLE_DOCUMENT;
      } else if (mode === 'virtual') {
        strategy = STRATEGIES.VIRTUAL_MOUNT;
      } else if (mode === 'chapter') {
        strategy = STRATEGIES.CHAPTER_VIEW;
      }

      return Object.freeze({
        mode,
        scopeKey,
        scopeChanged,
        forceRender,
        strategy,
        renderResult
      });
    },

    execute(plan, renderers) {
      assertActive();
      if (!plan || typeof plan !== 'object') {
        throw new TypeError('Preview Render Coordinator requires a render plan');
      }
      const context = Object.freeze({
        mode: plan.mode,
        scopeKey: plan.scopeKey,
        scopeChanged: Boolean(plan.scopeChanged),
        forceRender: Boolean(plan.forceRender),
        renderResult: plan.renderResult
      });
      switch (plan.strategy) {
        case STRATEGIES.STABLE_REUSE:
          return requireRenderer(renderers, 'reuseStable')(context);
        case STRATEGIES.DOM_WHOLE_DOCUMENT:
          return requireRenderer(renderers, 'renderWholeDocument')(context);
        case STRATEGIES.VIRTUAL_MOUNT:
          return requireRenderer(renderers, 'mountVirtual')(context);
        case STRATEGIES.CHAPTER_VIEW:
          return requireRenderer(renderers, 'mountChapter')(context);
        case STRATEGIES.DOM_INCREMENTAL:
          return requireRenderer(renderers, 'renderIncremental')(context);
        default:
          throw new TypeError('Preview Render Coordinator unknown strategy: ' + String(plan.strategy));
      }
    },

    destroy() {
      destroyed = true;
    }
  });
}
