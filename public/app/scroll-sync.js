    const SYNC_VIEWPORT_RATIO = 0.38;
    const SELECTION_VIEWPORT_RATIO = 0.5;
    const SELECTION_SAFE_EDGE_MIN_PX = 32;
    const SELECTION_SAFE_EDGE_MAX_PX = 96;
    const SELECTION_LAYOUT_SETTLE_MS = 140;

    function clampSelectionViewportRatio(value, viewportHeight, fallback = SELECTION_VIEWPORT_RATIO) {
      const height = Math.max(1, Number(viewportHeight) || 1);
      const safeMargin = Math.min(
        SELECTION_SAFE_EDGE_MAX_PX,
        Math.max(SELECTION_SAFE_EDGE_MIN_PX, height * 0.1)
      );
      const minimum = Math.min(0.32, safeMargin / height);
      const ratio = Number.isFinite(Number(value)) ? Number(value) : fallback;
      return Math.max(minimum, Math.min(1 - minimum, ratio));
    }

    function getRectViewportRatio(container, rect, fallback = SELECTION_VIEWPORT_RATIO) {
      if (!container || !rect) return fallback;
      const containerRect = container.getBoundingClientRect?.();
      const height = Math.max(1, containerRect?.height || container.clientHeight || 1);
      const top = Number(rect.top);
      const bottom = Number(rect.bottom);
      const rectHeight = Number(rect.height);
      const center = Number.isFinite(top) && Number.isFinite(bottom)
        ? (top + bottom) / 2
        : Number.isFinite(top) && Number.isFinite(rectHeight)
          ? top + rectHeight / 2
          : NaN;
      if (!Number.isFinite(center) || !Number.isFinite(containerRect?.top)) {
        return clampSelectionViewportRatio(fallback, height, fallback);
      }
      return clampSelectionViewportRatio((center - containerRect.top) / height, height, fallback);
    }

    function getRangeViewportRect(range) {
      if (!range) return null;
      const rects = Array.from(range.getClientRects?.() || []).filter(rect => rect.width || rect.height);
      if (!rects.length) {
        const rect = range.getBoundingClientRect?.();
        return rect && (rect.width || rect.height) ? rect : null;
      }
      const top = Math.min(...rects.map(rect => rect.top));
      const bottom = Math.max(...rects.map(rect => rect.bottom));
      const left = Math.min(...rects.map(rect => rect.left));
      const right = Math.max(...rects.map(rect => rect.right));
      return { top, bottom, left, right, width: Math.max(0, right - left), height: Math.max(1, bottom - top) };
    }
    const scrollController = window.markdownEditorScrollController;
    if (!scrollController) throw new Error('Scroll controller is not initialized');
    // CodeMirror 使用自身的虚拟行几何；以下 Canvas 索引仅作为旧式文本控件的兼容回退。
    // 避免为每一行创建隐藏 DOM 标记，防止大文档和布局变化时阻塞主线程。
    let editorLineIndexText = null;
    let editorMetricText = null;
    let editorMetricSignature = '';
    let editorMetricLines = [''];
    let editorLineStarts = [0];
    let editorLineRows = [1];
    let editorVisualOffsets = [0, 1];
    let editorMetricTotalRows = 1;
    let editorMetricContentHeight = 1;
    let editorMetricPaddingTop = 0;
    let editorMetricPaddingBottom = 0;
    let editorMetricContentWidth = 1;
    let editorMetricLineHeight = 24;
    let editorMetricTimer = 0;
    let editorMeasureCanvas = null;
    let editorMeasureContext = null;

    function getEditorLineHeight() {
      const style = window.getComputedStyle(editor);
      return parseFloat(style.lineHeight) || Math.max(24, (parseFloat(style.fontSize) || 16) * 1.8);
    }

    function getEditorMeasureContext(style) {
      if (!editorMeasureCanvas) editorMeasureCanvas = document.createElement('canvas');
      if (!editorMeasureContext) editorMeasureContext = editorMeasureCanvas.getContext('2d');
      if (!editorMeasureContext) return null;
      editorMeasureContext.font = [
        style.fontStyle || 'normal',
        style.fontVariant || 'normal',
        style.fontWeight || '400',
        style.fontSize || '16px',
        style.fontFamily || 'monospace'
      ].join(' ');
      editorMeasureContext.letterSpacing = style.letterSpacing || '0px';
      return editorMeasureContext;
    }

    function measureVisualRows(line, context, contentWidth) {
      if (!line) return 1;
      const expanded = line.includes('\t') ? line.replace(/\t/g, '    ') : line;
      if (!context) return Math.max(1, Math.ceil(expanded.length / Math.max(1, contentWidth / 8)));
      const width = context.measureText(expanded).width;
      return Math.max(1, Math.ceil((width + 1) / Math.max(1, contentWidth)));
    }

    function ensureEditorLineIndex() {
      const text = editor.value;
      if (editorLineIndexText === text) return;
      const lines = text.split('\n');
      if (!lines.length) lines.push('');
      const starts = new Array(lines.length);
      let offset = 0;
      for (let index = 0; index < lines.length; index++) {
        starts[index] = offset;
        offset += lines[index].length + (index < lines.length - 1 ? 1 : 0);
      }
      editorLineIndexText = text;
      editorMetricLines = lines;
      editorLineStarts = starts;
    }

    function rebuildEditorLineMetrics(force = false) {
      if (editor.virtualEditor) {
        editorMetricContentHeight = Math.max(1, editor.scrollHeight);
        editorMetricLineHeight = editor.virtualEditor.getDefaultLineHeight?.() || getEditorLineHeight();
        return;
      }
      const style = window.getComputedStyle(editor);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const contentWidth = Math.max(24, editor.clientWidth - paddingLeft - paddingRight);
      const signature = [
        Math.round(contentWidth),
        style.fontFamily,
        style.fontSize,
        style.fontWeight,
        style.fontStyle,
        style.lineHeight,
        style.letterSpacing,
        style.wordBreak,
        style.overflowWrap,
        style.tabSize
      ].join('|');
      const text = editor.value;
      if (!force && editorMetricText === text && editorMetricSignature === signature) return;

      const context = getEditorMeasureContext(style);
      ensureEditorLineIndex();
      const lines = editorMetricLines;
      const rows = new Array(lines.length);
      const offsets = new Array(lines.length + 1);
      let visualOffset = 0;
      offsets[0] = 0;

      for (let index = 0; index < lines.length; index++) {
        const visualRows = measureVisualRows(lines[index], context, contentWidth);
        rows[index] = visualRows;
        visualOffset += visualRows;
        offsets[index + 1] = visualOffset;
      }

      editorMetricText = text;
      editorMetricSignature = signature;
      editorLineRows = rows;
      editorVisualOffsets = offsets;
      editorMetricTotalRows = Math.max(1, visualOffset);
      editorMetricPaddingTop = parseFloat(style.paddingTop) || 0;
      editorMetricPaddingBottom = parseFloat(style.paddingBottom) || 0;
      editorMetricContentWidth = contentWidth;
      editorMetricLineHeight = getEditorLineHeight();
      // textarea.scrollHeight 是浏览器实际换行后的总高度；视觉行索引只负责分配相对位置。
      editorMetricContentHeight = Math.max(1, editor.scrollHeight);
    }

    function invalidateEditorLineMetrics() {
      editorMetricSignature = '';
    }

    function scheduleEditorMetricsRebuild(delay = 100) {
      invalidateEditorLineMetrics();
      clearTimeout(editorMetricTimer);
      editorMetricTimer = setTimeout(() => {
        editorMetricTimer = 0;
        const run = () => {
          rebuildEditorLineMetrics();
          scrollController.notifyGeometryChanged('editor');
        };
        if ('requestIdleCallback' in window) {
          requestIdleCallback(run, { timeout: 220 });
        } else {
          run();
        }
      }, delay);
    }

    function findEditorLineIndexAtTextIndex(index) {
      if (editor.virtualEditor) return editor.virtualEditor.getLineNumberAtPosition(index) - 1;
      ensureEditorLineIndex();
      const safeIndex = Math.max(0, Math.min(index, editorLineIndexText.length));
      let low = 0;
      let high = editorLineStarts.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (editorLineStarts[mid] <= safeIndex) low = mid;
        else high = mid - 1;
      }
      return low;
    }

    function getLineStartIndex(line) {
      if (editor.virtualEditor) return editor.virtualEditor.getLineStart(line);
      ensureEditorLineIndex();
      const index = Math.max(0, Math.min(editorLineStarts.length - 1, Number(line || 1) - 1));
      return editorLineStarts[index] || 0;
    }

    function getLineEndIndex(line) {
      if (editor.virtualEditor) return editor.virtualEditor.getLineEnd(line);
      ensureEditorLineIndex();
      const index = Math.max(0, Math.min(editorMetricLines.length - 1, Number(line || 1) - 1));
      return (editorLineStarts[index] || 0) + (editorMetricLines[index] || '').length;
    }

    function getLineNumberAtIndex(text, index) {
      if (editor.virtualEditor && text.length === editor.textLength) {
        return editor.virtualEditor.getLineNumberAtPosition(index);
      }
      if (text === editor.value) return findEditorLineIndexAtTextIndex(index) + 1;
      return text.slice(0, Math.max(0, index)).split('\n').length;
    }

    function getEditorCursorLine() {
      if (editor.virtualEditor) return editor.virtualEditor.getLineNumberAtPosition(editor.selectionStart || 0);
      return getLineNumberAtIndex(editor.value, editor.selectionStart || 0);
    }

    function getEditorHeightScale() {
      rebuildEditorLineMetrics();
      const usableHeight = Math.max(
        editorMetricLineHeight,
        editorMetricContentHeight - editorMetricPaddingTop - editorMetricPaddingBottom
      );
      return usableHeight / Math.max(1, editorMetricTotalRows);
    }

    function getEditorLineFloatAtY(contentY) {
      if (editor.virtualEditor) return editor.virtualEditor.getLineAtHeight(contentY);
      rebuildEditorLineMetrics();
      const rowScale = getEditorHeightScale();
      const rowY = Math.max(
        0,
        Math.min(editorMetricTotalRows - 0.001, (contentY - editorMetricPaddingTop) / Math.max(0.001, rowScale))
      );
      let low = 0;
      let high = editorLineRows.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (editorVisualOffsets[mid] <= rowY) low = mid;
        else high = mid - 1;
      }
      const index = low;
      const start = editorVisualOffsets[index] || 0;
      const rows = Math.max(1, editorLineRows[index] || 1);
      return index + 1 + Math.max(0, Math.min(0.999, (rowY - start) / rows));
    }

    function getEditorYForLineFloat(lineFloat) {
      if (editor.virtualEditor) return editor.virtualEditor.getHeightForLine(lineFloat);
      rebuildEditorLineMetrics();
      const maxLine = Math.max(1, editorLineRows.length);
      const clamped = Math.max(1, Math.min(lineFloat, maxLine + 0.999));
      const index = Math.min(maxLine - 1, Math.floor(clamped) - 1);
      const fraction = Math.max(0, Math.min(0.999, clamped - Math.floor(clamped)));
      const row = (editorVisualOffsets[index] || 0) + (editorLineRows[index] || 1) * fraction;
      return editorMetricPaddingTop + row * getEditorHeightScale();
    }

    function measureEditorIndexY(index) {
      if (editor.virtualEditor) return editor.virtualEditor.getHeightForPosition(index);
      rebuildEditorLineMetrics();
      const lineIndex = findEditorLineIndexAtTextIndex(index);
      const lineStart = editorLineStarts[lineIndex] || 0;
      const prefix = editor.value.slice(lineStart, Math.max(lineStart, index));
      const style = window.getComputedStyle(editor);
      const context = getEditorMeasureContext(style);
      const expanded = prefix.includes('\t') ? prefix.replace(/\t/g, '    ') : prefix;
      const prefixWidth = context ? context.measureText(expanded).width : expanded.length * 8;
      const lineRows = Math.max(1, editorLineRows[lineIndex] || 1);
      const rowWithinLine = Math.min(lineRows - 0.5, Math.floor(prefixWidth / Math.max(1, editorMetricContentWidth)) + 0.5);
      const row = (editorVisualOffsets[lineIndex] || 0) + Math.max(0.5, rowWithinLine);
      return editorMetricPaddingTop + row * getEditorHeightScale();
    }

    function getTopVisibleEditorLine() {
      return Math.max(1, Math.floor(getEditorLineFloatAtY(editor.scrollTop + 8)));
    }

    function getMaxScroll(element) {
      return Math.max(0, element.scrollHeight - element.clientHeight);
    }

    function clampScrollTop(element, value) {
      return Math.max(0, Math.min(getMaxScroll(element), Number.isFinite(value) ? value : 0));
    }

    function suspendAutomaticScrollSync(duration = 360) {
      scrollController.suspend(duration);
    }

    function cancelScrollSyncAnimation() {
      scrollController.cancelTarget();
    }

    function markProgrammaticScroll(side, duration = 700) {
      scrollController.markProgrammaticScroll(side, duration);
    }

    function markManualScroll(side) {
      scrollController.beginUserGesture(side, 'legacy');
    }

    function scheduleSyncedScroll(element, side, top) {
      scrollController.scheduleTarget(side, top, { reason: 'linked-scroll' });
    }

    function getEditorSelectionViewportRatio(fromIndex, toIndex = fromIndex) {
      const start = Math.max(0, Math.min(fromIndex, toIndex));
      const end = Math.max(start, Math.max(fromIndex, toIndex));
      const virtualEditor = editor.virtualEditor;
      const viewportRect = virtualEditor?.getScrollViewportRect?.();
      if (viewportRect && virtualEditor?.getPositionCoordinates) {
        const startRect = virtualEditor.getPositionCoordinates(start, 1);
        const endRect = virtualEditor.getPositionCoordinates(Math.max(start, end - 1), -1);
        if (startRect || endRect) {
          const first = startRect || endRect;
          const last = endRect || startRect;
          const top = Math.min(first.top, last.top);
          const bottom = Math.max(first.bottom, last.bottom);
          const height = Math.max(1, viewportRect.height || editor.clientHeight || 1);
          return clampSelectionViewportRatio(((top + bottom) / 2 - viewportRect.top) / height, height);
        }
      }
      const middle = start + Math.floor((end - start) / 2);
      const relativeY = measureEditorIndexY(middle) - editor.scrollTop;
      return clampSelectionViewportRatio(relativeY / Math.max(1, editor.clientHeight), editor.clientHeight);
    }

    function scrollEditorToIndex(index, behavior = 'auto', viewportRatio = SELECTION_VIEWPORT_RATIO) {
      const targetY = measureEditorIndexY(index);
      const resolvedRatio = clampSelectionViewportRatio(viewportRatio, editor.clientHeight);
      const targetTop = clampScrollTop(editor, targetY - editor.clientHeight * resolvedRatio);
      scrollController.scrollTo('editor', targetTop, {
        behavior,
        reason: 'editor-position',
        suspendMs: behavior === 'smooth' ? 520 : 180,
        settleMs: behavior === 'smooth' ? 1000 : 700
      });
    }

    function scrollEditorToLine(line, behavior = 'auto', viewportRatio = SYNC_VIEWPORT_RATIO) {
      const targetY = getEditorYForLineFloat(Math.max(1, line));
      const targetTop = clampScrollTop(editor, targetY - editor.clientHeight * viewportRatio);
      scrollController.scrollTo('editor', targetTop, {
        behavior,
        reason: 'editor-position',
        suspendMs: behavior === 'smooth' ? 520 : 180,
        settleMs: behavior === 'smooth' ? 1000 : 700
      });
    }

    function getPreviewAnchors() {
      if (window.markdownEditorVirtualPreview?.active) {
        previewAnchorsCache = window.markdownEditorVirtualPreview.getMountedAnchors();
        return previewAnchorsCache;
      }
      if (previewAnchorsCache) return previewAnchorsCache;
      previewAnchorsCache = Array.from(preview.querySelectorAll('[data-source-line]'));
      return previewAnchorsCache;
    }

    function invalidatePreviewAnchorMetrics() {
      previewAnchorMetricsCache = null;
    }

    function invalidatePreviewAnchorStructure() {
      previewAnchorsCache = null;
      previewAnchorMetricsCache = null;
    }

    function observePreviewBodySize() {
      if (typeof ResizeObserver === 'undefined') return;
      if (window.markdownEditorVirtualPreview?.active) {
        previewBodyResizeObserver?.disconnect();
        observedPreviewBody = null;
        return;
      }
      const body = preview.querySelector('.markdown-body');
      if (!body) return;
      if (!previewBodyResizeObserver) {
        previewBodyResizeObserver = new ResizeObserver(() => {
          clearTimeout(previewBodyResizeTimer);
          previewBodyResizeTimer = setTimeout(() => {
            previewBodyResizeTimer = 0;
            invalidatePreviewAnchorMetrics();
            scrollController.notifyGeometryChanged('preview');
          }, 64);
        });
      }
      if (observedPreviewBody === body) return;
      previewBodyResizeObserver.disconnect();
      previewBodyResizeObserver.observe(body);
      observedPreviewBody = body;
    }

    function getPreviewAnchorMetrics() {
      if (previewAnchorMetricsCache) return previewAnchorMetricsCache;
      if (window.markdownEditorVirtualPreview?.active) {
        previewAnchorMetricsCache = window.markdownEditorVirtualPreview.getMetrics() || [];
        return previewAnchorMetricsCache;
      }
      const body = preview.querySelector('.markdown-body');
      if (!body) return [];
      const bodyTop = body.offsetTop;
      previewAnchorMetricsCache = getPreviewAnchors().map(anchor => {
        const top = bodyTop + anchor.offsetTop;
        return {
          anchor,
          startLine: Number(anchor.dataset.sourceLine || 1),
          endLine: Number(anchor.dataset.sourceEndLine || anchor.dataset.sourceLine || 1),
          top,
          bottom: top + Math.max(1, anchor.offsetHeight)
        };
      });
      return previewAnchorMetricsCache;
    }

    function findLastMetricIndex(metrics, value, field) {
      let low = 0;
      let high = metrics.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (metrics[mid][field] <= value) low = mid;
        else high = mid - 1;
      }
      return low;
    }

    function findPreviewAnchor(line) {
      const metrics = getPreviewAnchorMetrics();
      if (!metrics.length) return null;
      return metrics[findLastMetricIndex(metrics, Math.max(1, Number(line) || 1), 'startLine')]?.anchor || metrics[0].anchor;
    }

    function sourceLineToPreviewY(lineFloat) {
      if (window.markdownEditorVirtualPreview?.active && typeof window.markdownEditorVirtualPreview.getContentYForLine === 'function') {
        return window.markdownEditorVirtualPreview.getContentYForLine(lineFloat);
      }
      const metrics = getPreviewAnchorMetrics();
      if (!metrics.length) return 0;
      const line = Math.max(1, lineFloat);
      if (line <= metrics[0].startLine) return metrics[0].top;
      const index = findLastMetricIndex(metrics, line, 'startLine');
      const current = metrics[index];
      const next = metrics[index + 1];
      if (line <= current.endLine + 0.999 || !next) {
        const span = Math.max(1, current.endLine - current.startLine + 1);
        const fraction = Math.max(0, Math.min(1, (line - current.startLine) / span));
        return current.top + (current.bottom - current.top) * fraction;
      }
      const gapLines = Math.max(1, next.startLine - current.endLine);
      const fraction = Math.max(0, Math.min(1, (line - current.endLine) / gapLines));
      return current.bottom + (next.top - current.bottom) * fraction;
    }

    function previewYToSourceLine(contentY) {
      if (window.markdownEditorVirtualPreview?.active && typeof window.markdownEditorVirtualPreview.getLineForContentY === 'function') {
        return window.markdownEditorVirtualPreview.getLineForContentY(contentY);
      }
      const metrics = getPreviewAnchorMetrics();
      if (!metrics.length) return 1;
      const y = Math.max(0, contentY);
      if (y <= metrics[0].top) return metrics[0].startLine;
      const index = findLastMetricIndex(metrics, y, 'top');
      const current = metrics[index];
      const next = metrics[index + 1];
      if (y <= current.bottom || !next) {
        const fraction = Math.max(0, Math.min(1, (y - current.top) / Math.max(1, current.bottom - current.top)));
        return current.startLine + fraction * Math.max(1, current.endLine - current.startLine + 1);
      }
      const fraction = Math.max(0, Math.min(1, (y - current.bottom) / Math.max(1, next.top - current.bottom)));
      return current.endLine + fraction * Math.max(1, next.startLine - current.endLine);
    }

    function scrollPreviewContentYIntoView(contentY, behavior = 'auto', viewportRatio = SELECTION_VIEWPORT_RATIO) {
      const resolvedRatio = clampSelectionViewportRatio(viewportRatio, preview.clientHeight);
      const targetTop = clampScrollTop(preview, contentY - preview.clientHeight * resolvedRatio);
      scrollController.scrollTo('preview', targetTop, {
        behavior,
        reason: 'preview-position',
        suspendMs: behavior === 'smooth' ? 520 : 180,
        settleMs: behavior === 'smooth' ? 1000 : 700
      });
    }

    function scrollPreviewRectIntoView(rect, behavior = 'smooth', viewportRatio = SELECTION_VIEWPORT_RATIO) {
      if (!rect) return;
      const previewRect = preview.getBoundingClientRect();
      const centerY = preview.scrollTop + rect.top - previewRect.top + Math.max(1, rect.height) / 2;
      scrollPreviewContentYIntoView(centerY, behavior, viewportRatio);
    }

    function scrollPreviewToLine(line, behavior = 'auto', viewportRatio = SYNC_VIEWPORT_RATIO) {
      scrollPreviewContentYIntoView(sourceLineToPreviewY(Math.max(1, line)), behavior, viewportRatio);
    }

    function getTopVisiblePreviewLine() {
      return Math.max(1, Math.floor(previewYToSourceLine(preview.scrollTop + 8)));
    }

    function syncFromEditorScroll() {
      updateActiveOutlineByLine(getTopVisibleEditorLine());
      const focusY = editor.scrollTop + editor.clientHeight * SYNC_VIEWPORT_RATIO;
      const sourceLine = getEditorLineFloatAtY(focusY);
      const previewY = sourceLineToPreviewY(sourceLine);
      scheduleSyncedScroll(preview, 'preview', previewY - preview.clientHeight * SYNC_VIEWPORT_RATIO);
    }

    function syncFromPreviewScroll() {
      updateActiveOutlineByLine(getTopVisiblePreviewLine());
      const focusY = preview.scrollTop + preview.clientHeight * SYNC_VIEWPORT_RATIO;
      const sourceLine = previewYToSourceLine(focusY);
      const editorY = getEditorYForLineFloat(sourceLine);
      scheduleSyncedScroll(editor, 'editor', editorY - editor.clientHeight * SYNC_VIEWPORT_RATIO);
    }

    function scheduleSourceScrollSync(side) {
      scrollController.scheduleSourceSync(side);
    }

    function collectMarkedBlockTokens(tokens, out = []) {
      tokens.forEach(token => {
        if (token.raw && token.type !== 'space') out.push(token);
      });
      return out;
    }

    function getTokenLineRange(text, raw, cursorRef) {
      let startIndex = text.indexOf(raw, cursorRef.value);
      if (startIndex < 0) startIndex = cursorRef.value;
      const endIndex = Math.min(text.length, startIndex + String(raw || '').length);
      cursorRef.value = endIndex;
      const startLine = getLineNumberAtIndex(text, startIndex);
      const rawLines = String(raw || '').replace(/\n+$/g, '').split('\n').length;
      return { startLine, endLine: startLine + Math.max(0, rawLines - 1), startIndex, endIndex };
    }

    function annotatePreviewSourceLines(text, providedTokens = null) {
      const body = preview.querySelector('.markdown-body');
      if (!body) return;
      invalidatePreviewAnchorStructure();
      const children = Array.from(body.children);
      let tokens = Array.isArray(providedTokens) ? providedTokens : [];
      if (!tokens.length) {
        try {
          tokens = typeof marked !== 'undefined' && marked.lexer ? collectMarkedBlockTokens(marked.lexer(text)) : [];
        } catch (_) {
          tokens = [];
        }
      }
      if (!tokens.length) {
        children.forEach((child, index) => {
          child.dataset.sourceLine = String(index + 1);
          child.dataset.sourceEndLine = String(index + 1);
          child.dataset.sourceStartIndex = String(getLineStartIndex(index + 1));
          child.dataset.sourceEndIndex = String(getLineEndIndex(index + 1));
        });
        previewAnchorsCache = children;
        observePreviewBodySize();
        return;
      }
      const cursorRef = { value: 0 };
      let childIndex = 0;
      let lastRange = null;
      tokens.forEach(token => {
        const child = children[childIndex++];
        if (!child) return;
        const range = getTokenLineRange(text, token.raw || '', cursorRef);
        lastRange = range;
        child.dataset.sourceLine = String(range.startLine);
        child.dataset.sourceEndLine = String(range.endLine);
        child.dataset.sourceStartIndex = String(range.startIndex);
        child.dataset.sourceEndIndex = String(range.endIndex);
      });
      // 某些 HTML / 扩展语法会产生比 token 更多的顶层节点；为剩余节点继承相邻块范围，
      // 避免滚动映射突然缺失锚点。
      while (childIndex < children.length) {
        const child = children[childIndex++];
        const fallbackLine = lastRange?.endLine || 1;
        const fallbackIndex = lastRange?.endIndex || 0;
        child.dataset.sourceLine = String(fallbackLine);
        child.dataset.sourceEndLine = String(fallbackLine);
        child.dataset.sourceStartIndex = String(fallbackIndex);
        child.dataset.sourceEndIndex = String(fallbackIndex);
      }
      previewAnchorsCache = children;
      observePreviewBodySize();
    }

    function clearPreviewSelectionHighlights() {
      if (window.CSS?.highlights) CSS.highlights.delete('preview-selection-sync');
      preview.querySelectorAll('.preview-source-highlight').forEach(el => el.classList.remove('preview-source-highlight'));
      preview.querySelectorAll('.preview-atomic-selection-highlight')
        .forEach(el => el.classList.remove('preview-atomic-selection-highlight'));
      preview.querySelectorAll('.preview-text-highlight').forEach(span => {
        const text = document.createTextNode(span.textContent || '');
        span.replaceWith(text);
        text.parentNode?.normalize();
      });
    }

    function normalizeSearchText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function buildNormalizedTextMap(root) {
      const nodes = [];
      const chars = [];
      const map = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        const nodeIndex = nodes.push(node) - 1;
        for (let i = 0; i < node.nodeValue.length; i++) {
          const char = node.nodeValue[i];
          if (/\s/.test(char)) {
            if (!chars.length || chars[chars.length - 1] === ' ') continue;
            chars.push(' ');
          } else {
            chars.push(char);
          }
          map.push({ nodeIndex, offset: i });
        }
      }
      while (chars[0] === ' ') {
        chars.shift();
        map.shift();
      }
      while (chars[chars.length - 1] === ' ') {
        chars.pop();
        map.pop();
      }
      return { text: chars.join(''), map, nodes };
    }

    function createRangeFromNormalizedMatch(root, selectedText, preferredOffsetRatio = null) {
      const needle = normalizeSearchText(selectedText);
      if (!needle) return null;
      const projection = buildNormalizedTextMap(root);
      let index = projection.text.indexOf(needle);
      let bestIndex = -1;
      let bestScore = Number.POSITIVE_INFINITY;
      while (index >= 0) {
        if (projection.map[index]) {
          const centerRatio = projection.text.length > 0
            ? (index + needle.length / 2) / projection.text.length
            : 0.5;
          const score = Number.isFinite(preferredOffsetRatio)
            ? Math.abs(centerRatio - preferredOffsetRatio)
            : index;
          if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
          }
          if (!Number.isFinite(preferredOffsetRatio)) break;
        }
        index = projection.text.indexOf(needle, index + 1);
      }
      if (bestIndex < 0) return null;
      const startMap = projection.map[bestIndex];
      const endMap = projection.map[Math.min(projection.map.length - 1, bestIndex + needle.length - 1)];
      const startNode = projection.nodes[startMap.nodeIndex];
      const endNode = projection.nodes[endMap.nodeIndex];
      if (!startNode || !endNode) return null;
      const range = document.createRange();
      range.setStart(startNode, Math.min(startMap.offset, startNode.nodeValue.length));
      range.setEnd(endNode, Math.min(endMap.offset + 1, endNode.nodeValue.length));
      return range;
    }

    function highlightTextFallbackInPreviewRange(selectedText, fromLine, toLine, sourceStartIndex = null, sourceEndIndex = null) {
      const raw = (selectedText || '').trim();
      if (!raw || raw.length > 2000) return null;
      const simplified = raw.replace(/^[#>\s-]+/gm, '').replace(/[\*_`~]/g, '').trim();
      const candidates = Array.from(new Set([raw, simplified])).filter(Boolean);
      const sourceCenter = Number.isFinite(sourceStartIndex) && Number.isFinite(sourceEndIndex)
        ? (sourceStartIndex + sourceEndIndex) / 2
        : null;
      const anchors = getPreviewAnchors().filter(anchor => {
        const line = Number(anchor.dataset.sourceLine || 1);
        const end = Number(anchor.dataset.sourceEndLine || line);
        return end >= fromLine && line <= toLine;
      }).map(anchor => {
        const anchorStart = Number(anchor.dataset.sourceStartIndex);
        const anchorEnd = Number(anchor.dataset.sourceEndIndex);
        const hasSourceRange = Number.isFinite(anchorStart) && Number.isFinite(anchorEnd) && anchorEnd > anchorStart;
        const distance = Number.isFinite(sourceCenter) && hasSourceRange
          ? sourceCenter < anchorStart
            ? anchorStart - sourceCenter
            : sourceCenter > anchorEnd
              ? sourceCenter - anchorEnd
              : 0
          : 0;
        const preferredOffsetRatio = Number.isFinite(sourceCenter) && hasSourceRange
          ? Math.max(0, Math.min(1, (sourceCenter - anchorStart) / (anchorEnd - anchorStart)))
          : null;
        return { anchor, distance, preferredOffsetRatio };
      }).sort((left, right) => left.distance - right.distance);

      for (const candidate of candidates) {
        for (const entry of anchors) {
          const range = createRangeFromNormalizedMatch(entry.anchor, candidate, entry.preferredOffsetRatio);
          if (!range) continue;
          const visibleRect = getRangeViewportRect(range);
          if (window.CSS?.highlights && typeof Highlight !== 'undefined') {
            CSS.highlights.set('preview-selection-sync', new Highlight(range));
            if (!visibleRect) {
              CSS.highlights.delete('preview-selection-sync');
              continue;
            }
          } else if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
            const node = range.startContainer;
            const after = node.splitText(range.startOffset);
            const tail = after.splitText(range.endOffset - range.startOffset);
            const mark = document.createElement('span');
            mark.className = 'preview-text-highlight';
            mark.textContent = after.nodeValue;
            after.replaceWith(mark);
            void tail;
            return { range: document.createRange(), element: mark, rect: mark.getBoundingClientRect() };
          }
          return { range, element: entry.anchor, rect: visibleRect || range.getBoundingClientRect() };
        }
      }
      return null;
    }

    function getPreviewAnchorSourceRange(anchor) {
      const sourceStart = Number(anchor?.dataset?.sourceStartIndex);
      const sourceEnd = Number(anchor?.dataset?.sourceEndIndex);
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) return null;
      return { sourceStart, sourceEnd };
    }

    function getCombinedRangeViewportRect(ranges) {
      const rects = Array.from(ranges || [], range => getRangeViewportRect(range)).filter(Boolean);
      if (!rects.length) return null;
      const top = Math.min(...rects.map(rect => rect.top));
      const bottom = Math.max(...rects.map(rect => rect.bottom));
      const left = Math.min(...rects.map(rect => rect.left));
      const right = Math.max(...rects.map(rect => rect.right));
      return { top, bottom, left, right, width: Math.max(0, right - left), height: Math.max(1, bottom - top) };
    }

    function highlightMappedSourceRangeInPreview(fromLine, toLine, sourceStartIndex, sourceEndIndex) {
      const mapping = window.markdownEditorSelectionMapping;
      if (!mapping?.createPreviewRangesForSourceSelection
        || !Number.isFinite(sourceStartIndex)
        || !Number.isFinite(sourceEndIndex)
        || sourceEndIndex <= sourceStartIndex) return null;

      const candidates = getPreviewAnchors().filter(anchor => {
        const range = getPreviewAnchorSourceRange(anchor);
        if (range) return range.sourceEnd > sourceStartIndex && range.sourceStart < sourceEndIndex;
        const line = Number(anchor.dataset.sourceLine || 1);
        const end = Number(anchor.dataset.sourceEndLine || line);
        return end >= fromLine && line <= toLine;
      });
      if (!candidates.length) return null;

      const ranges = [];
      const atomicElements = new Set();
      const mappedAnchors = new Set();
      let mappedCharacters = 0;
      let sourceCharacters = 0;
      let minimumProjectionCoverage = 1;
      for (const anchor of candidates) {
        const anchorRange = getPreviewAnchorSourceRange(anchor);
        if (!anchorRange) continue;
        const source = documentModel?.sliceText?.(anchorRange.sourceStart, anchorRange.sourceEnd)
          ?? editor.virtualEditor?.sliceText?.(anchorRange.sourceStart, anchorRange.sourceEnd)
          ?? editor.value.slice(anchorRange.sourceStart, anchorRange.sourceEnd);
        const result = mapping.createPreviewRangesForSourceSelection(
          anchor,
          source,
          anchorRange.sourceStart,
          sourceStartIndex,
          sourceEndIndex
        );
        sourceCharacters += Number(result?.sourceCharacters) || 0;
        mappedCharacters += Number(result?.mappedCharacters) || 0;
        minimumProjectionCoverage = Math.min(
          minimumProjectionCoverage,
          Number.isFinite(result?.projectionCoverage) ? result.projectionCoverage : 0
        );
        if (result?.ranges?.length) {
          ranges.push(...result.ranges);
          mappedAnchors.add(anchor);
        }
        for (const element of result?.atomicElements || []) atomicElements.add(element);
      }

      const visibleCoverage = sourceCharacters ? mappedCharacters / sourceCharacters : 1;
      if (minimumProjectionCoverage < 0.96 || visibleCoverage < 0.96) {
        window.markdownEditorPerf?.diagnostic?.('selection.precision-fallback', {
          category: 'sync.selection',
          status: 'warning',
          dedupeKey: `selection.precision-fallback:${Math.round(minimumProjectionCoverage * 10)}:${Math.round(visibleCoverage * 10)}`,
          minIntervalMs: 4000,
          details: {
            sourceStartIndex,
            sourceEndIndex,
            sourceCharacters,
            mappedCharacters,
            visibleCoverage: Number(visibleCoverage.toFixed(3)),
            projectionCoverage: Number(minimumProjectionCoverage.toFixed(3)),
            candidateAnchors: candidates.length,
            mappedAnchors: mappedAnchors.size
          }
        });
        return null;
      }

      if (ranges.length && window.CSS?.highlights && typeof Highlight !== 'undefined') {
        CSS.highlights.set('preview-selection-sync', new Highlight(...ranges));
      } else if (ranges.length) {
        return null;
      }
      atomicElements.forEach(element => element.classList.add('preview-atomic-selection-highlight'));
      return {
        ranges,
        rect: getCombinedRangeViewportRect(ranges),
        element: mappedAnchors.values().next().value || candidates[0],
        matchedAnchors: mappedAnchors.size,
        sourceCharacters,
        mappedCharacters,
        visibleCoverage,
        projectionCoverage: minimumProjectionCoverage,
        mappingMode: 'source-dom'
      };
    }

    function highlightTextInPreviewRange(selectedText, fromLine, toLine, sourceStartIndex = null, sourceEndIndex = null) {
      const mapped = highlightMappedSourceRangeInPreview(fromLine, toLine, sourceStartIndex, sourceEndIndex);
      if (mapped) return mapped;
      const fallback = highlightTextFallbackInPreviewRange(
        selectedText,
        fromLine,
        toLine,
        sourceStartIndex,
        sourceEndIndex
      );
      return fallback ? { ...fallback, matchedAnchors: 1, mappingMode: 'text-search' } : null;
    }

    function highlightPreviewLines(startLine, endLine, shouldScroll = true, selectedText = '', options = {}) {
      clearPreviewSelectionHighlights();
      const from = Math.min(startLine, endLine);
      const to = Math.max(startLine, endLine);
      const virtualController = window.markdownEditorVirtualPreview;
      const targetViewportRatio = clampSelectionViewportRatio(options.viewportRatio, preview.clientHeight);
      if (virtualController?.active) {
        const inCurrentScope = virtualController.containsLineRange?.(from, to) !== false;
        if (!inCurrentScope) {
          void focusPreviewLine?.(from, { behavior: 'auto', scroll: shouldScroll });
          return {
            status: 'pending',
            selectionLength: String(selectedText || '').length,
            matchedAnchors: 0,
            maxRetries: 3,
            targetViewportRatio
          };
        }
        const alreadyMounted = virtualController.hasLineRangeMounted?.(from, to);
        if (shouldScroll || !alreadyMounted) {
          virtualController.ensureLineRangeVisible?.(from, to)
            || virtualController.ensureLineVisible?.(from);
          invalidatePreviewAnchorStructure();
        }
      }

      const scrollBehavior = options.behavior === 'auto' ? 'auto' : 'smooth';
      const exact = highlightTextInPreviewRange(
        selectedText,
        from,
        to,
        Number.isFinite(options.sourceStartIndex) ? options.sourceStartIndex : null,
        Number.isFinite(options.sourceEndIndex) ? options.sourceEndIndex : null
      );
      const metrics = getPreviewAnchorMetrics();
      let startIndex = metrics.length ? findLastMetricIndex(metrics, from, 'startLine') : 0;
      while (startIndex > 0 && metrics[startIndex - 1].endLine >= from) startIndex -= 1;
      const matchingAnchors = [];
      for (let index = startIndex; index < metrics.length; index++) {
        const metric = metrics[index];
        if (metric.startLine > to) break;
        if (metric.endLine >= from && metric.anchor) matchingAnchors.push(metric.anchor);
      }
      // A text selection must never fall back to highlighting whole Markdown
      // blocks. A missing exact range is less visually misleading than a large,
      // unrelated block highlight; anchors remain available only for scrolling.
      if (shouldScroll) {
        if (exact?.rect && exact.rect.height) scrollPreviewRectIntoView(exact.rect, scrollBehavior, targetViewportRatio);
        else if (matchingAnchors.length) {
          const firstRect = matchingAnchors[0].getBoundingClientRect();
          const lastRect = matchingAnchors[matchingAnchors.length - 1].getBoundingClientRect();
          scrollPreviewRectIntoView({
            top: firstRect.top,
            bottom: lastRect.bottom,
            height: Math.max(1, lastRect.bottom - firstRect.top)
          }, scrollBehavior, targetViewportRatio);
        } else {
          scrollPreviewToLine(from, scrollBehavior, targetViewportRatio);
        }
      }

      const selectionLength = String(selectedText || '').length;
      if (exact) {
        return {
          status: 'exact',
          selectionLength,
          matchedAnchors: exact.matchedAnchors || 1,
          targetViewportRatio,
          mappedCharacters: exact.mappedCharacters || 0,
          mappingCoverage: Math.min(
            Number.isFinite(exact.visibleCoverage) ? exact.visibleCoverage : 1,
            Number.isFinite(exact.projectionCoverage) ? exact.projectionCoverage : 1
          ),
          mappingMode: exact.mappingMode || 'text-search',
          exactMapping: exact.mappingMode === 'source-dom'
        };
      }
      return {
        status: virtualController?.active && !matchingAnchors.length ? 'pending' : 'mapping-failed',
        selectionLength,
        matchedAnchors: matchingAnchors.length,
        maxRetries: 3,
        targetViewportRatio
      };
    }

    function syncEditorSelectionToPreview(shouldScroll = false, reason = 'editor-selection') {
      if (selectionSyncLock) return { status: 'locked', selectionLength: 0, matchedAnchors: 0 };
      const start = editor.selectionStart || 0;
      const end = editor.selectionEnd || 0;
      const cursorLine = editor.virtualEditor
        ? editor.virtualEditor.getLineNumberAtPosition(start)
        : getLineNumberAtIndex(editor.value, start);
      updateActiveOutlineByLine(cursorLine);
      if (typeof isHybridLayoutMode === 'function' && isHybridLayoutMode()) {
        clearPreviewSelectionHighlights();
        return { status: 'hybrid', selectionLength: Math.max(0, end - start), matchedAnchors: 0 };
      }
      if (start === end) {
        clearPreviewSelectionHighlights();
        return { status: 'cleared', selectionLength: 0, matchedAnchors: 0 };
      }
      const fromIndex = Math.min(start, end);
      const toIndex = Math.max(start, end);
      const startLine = editor.virtualEditor
        ? editor.virtualEditor.getLineNumberAtPosition(fromIndex)
        : getLineNumberAtIndex(editor.value, fromIndex);
      const endLine = editor.virtualEditor
        ? editor.virtualEditor.getLineNumberAtPosition(Math.max(fromIndex, toIndex - 1))
        : getLineNumberAtIndex(editor.value, Math.max(fromIndex, toIndex - 1));
      const selectedText = documentModel?.sliceText?.(fromIndex, toIndex)
        ?? editor.virtualEditor?.sliceText?.(fromIndex, toIndex)
        ?? editor.value.slice(fromIndex, toIndex);
      const sourceViewportRatio = getEditorSelectionViewportRatio(fromIndex, toIndex);
      const result = highlightPreviewLines(startLine, endLine, shouldScroll, selectedText, {
        sourceStartIndex: fromIndex,
        sourceEndIndex: toIndex,
        viewportRatio: sourceViewportRatio,
        behavior: /pointerup|keyup|editor-select/.test(reason) ? 'smooth' : 'auto'
      });
      return { ...result, sourceViewportRatio };
    }

    function closestPreviewSourceAnchor(node) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.('[data-source-line]') || null;
    }

    function getTextOffsetWithin(root, node, offset) {
      if (!root || !node || !root.contains(node)) return 0;
      try {
        const probe = document.createRange();
        probe.selectNodeContents(root);
        probe.setEnd(node, offset);
        return probe.toString().length;
      } catch (_) {
        return 0;
      }
    }

    function estimatePreviewCodeSourcePosition(anchor, node, offset) {
      const codeSourceStart = Number(anchor?.dataset?.codeSourceStartIndex);
      if (!Number.isFinite(codeSourceStart) || !node) return null;
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const row = element?.closest?.('.preview-code-row');
      if (!row || !anchor.contains(row)) return null;
      const rowStart = Number(row.dataset.codeOffsetStart);
      if (!Number.isFinite(rowStart)) return null;
      return codeSourceStart + rowStart + getTextOffsetWithin(row, node, offset);
    }

    function estimateSourcePosition(anchor, node, offset, fallback) {
      if (!anchor) return fallback;
      const sourceStart = Number(anchor.dataset.sourceStartIndex);
      const sourceEnd = Number(anchor.dataset.sourceEndIndex);
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) return fallback;
      const codePosition = estimatePreviewCodeSourcePosition(anchor, node, offset);
      if (Number.isFinite(codePosition)) {
        return Math.max(sourceStart, Math.min(sourceEnd, codePosition));
      }
      const renderedLength = Math.max(1, anchor.textContent?.length || 0);
      const renderedOffset = Math.max(0, Math.min(renderedLength, getTextOffsetWithin(anchor, node, offset)));
      return Math.round(sourceStart + (sourceEnd - sourceStart) * (renderedOffset / renderedLength));
    }

    function mapPreviewPointToExactSource(anchor, node, offset, affinity) {
      const mapping = window.markdownEditorSelectionMapping;
      const anchorRange = getPreviewAnchorSourceRange(anchor);
      if (!mapping?.mapPreviewDomPointToSource || !anchorRange) return null;
      const source = documentModel?.sliceText?.(anchorRange.sourceStart, anchorRange.sourceEnd)
        ?? editor.virtualEditor?.sliceText?.(anchorRange.sourceStart, anchorRange.sourceEnd)
        ?? editor.value.slice(anchorRange.sourceStart, anchorRange.sourceEnd);
      return mapping.mapPreviewDomPointToSource(
        anchor,
        source,
        anchorRange.sourceStart,
        node,
        offset,
        affinity
      );
    }

    function getPreviewSelectionContext() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return null;
      if (!preview.contains(selection.anchorNode) || !preview.contains(selection.focusNode)) return null;
      const range = selection.getRangeAt(0);
      const selectionRect = getRangeViewportRect(range);
      const viewportRatio = getRectViewportRatio(preview, selectionRect);
      const startAnchor = closestPreviewSourceAnchor(range.startContainer);
      const endAnchor = closestPreviewSourceAnchor(range.endContainer);
      if (!startAnchor || !endAnchor) return null;
      const startIndex = Number(startAnchor.dataset.sourceStartIndex);
      const endIndex = Number(endAnchor.dataset.sourceEndIndex);
      const textLength = documentModel?.getTextLength?.() ?? editor.value.length;
      const sourceStartIndex = Number.isFinite(startIndex) ? startIndex : 0;
      const sourceEndIndex = Number.isFinite(endIndex) ? endIndex : textLength;
      const exactStart = mapPreviewPointToExactSource(
        startAnchor,
        range.startContainer,
        range.startOffset,
        'start'
      );
      const exactEnd = mapPreviewPointToExactSource(
        endAnchor,
        range.endContainer,
        range.endOffset,
        'end'
      );
      return {
        text: selection.toString(),
        range,
        startAnchor,
        endAnchor,
        sourceStartIndex,
        sourceEndIndex,
        exactStart: Number.isFinite(exactStart?.position) ? exactStart.position : null,
        exactEnd: Number.isFinite(exactEnd?.position) ? exactEnd.position : null,
        exactStartAtomic: Boolean(exactStart?.atomic),
        exactEndAtomic: Boolean(exactEnd?.atomic),
        mappingCoverage: Math.min(
          Number.isFinite(exactStart?.projectionCoverage) ? exactStart.projectionCoverage : 0,
          Number.isFinite(exactEnd?.projectionCoverage) ? exactEnd.projectionCoverage : 0
        ),
        preferredStart: Number.isFinite(exactStart?.position)
          ? exactStart.position
          : estimateSourcePosition(startAnchor, range.startContainer, range.startOffset, sourceStartIndex),
        preferredEnd: Number.isFinite(exactEnd?.position)
          ? exactEnd.position
          : estimateSourcePosition(endAnchor, range.endContainer, range.endOffset, sourceEndIndex),
        viewportRatio
      };
    }

    function buildNormalizedSourceMap(source, startOffset = 0, stripMarkdown = false) {
      const chars = [];
      const map = [];
      let skipLinkTarget = false;
      for (let i = 0; i < source.length; i++) {
        const char = source[i];
        const previous = source[i - 1] || '';
        const next = source[i + 1] || '';
        if (skipLinkTarget) {
          if (char === ')') skipLinkTarget = false;
          continue;
        }
        if (stripMarkdown) {
          if (char === ']' && next === '(') {
            i += 1;
            skipLinkTarget = true;
            continue;
          }
          if ('*_~`[]'.includes(char)) continue;
          const linePrefix = i === 0 || previous === '\n';
          if (linePrefix && (char === '#' || char === '>' || char === '-')) continue;
          if (char === '\\' && next) {
            i += 1;
            chars.push(next);
            map.push(startOffset + i);
            continue;
          }
        }
        if (/\s/.test(char)) {
          if (!chars.length || chars[chars.length - 1] === ' ') continue;
          chars.push(' ');
        } else {
          chars.push(char);
        }
        map.push(startOffset + i);
      }
      while (chars[0] === ' ') {
        chars.shift();
        map.shift();
      }
      while (chars[chars.length - 1] === ' ') {
        chars.pop();
        map.pop();
      }
      return { text: chars.join(''), map };
    }

    function findRangeInNormalizedProjection(projection, needle, preferredStart = null) {
      const normalizedNeedle = normalizeSearchText(needle);
      if (!normalizedNeedle) return null;
      let index = projection.text.indexOf(normalizedNeedle);
      let best = null;
      while (index >= 0) {
        if (Number.isFinite(projection.map[index])) {
          const start = projection.map[index];
          const endMap = projection.map[Math.min(projection.map.length - 1, index + normalizedNeedle.length - 1)];
          const candidate = {
            start,
            end: Math.min(documentModel?.getTextLength?.() ?? editor.value.length, endMap + 1)
          };
          const score = Number.isFinite(preferredStart) ? Math.abs(candidate.start - preferredStart) : 0;
          if (!best || score < best.score) best = { ...candidate, score };
          if (!Number.isFinite(preferredStart)) break;
        }
        index = projection.text.indexOf(normalizedNeedle, index + 1);
      }
      return best;
    }

    function findNearestRawRange(text, candidate, baseOffset, preferredStart) {
      let index = text.indexOf(candidate);
      let best = null;
      while (index >= 0) {
        const start = baseOffset + index;
        const score = Number.isFinite(preferredStart) ? Math.abs(start - preferredStart) : 0;
        if (!best || score < best.score) best = { start, end: start + candidate.length, score };
        if (!Number.isFinite(preferredStart)) break;
        index = text.indexOf(candidate, index + 1);
      }
      return best;
    }

    function findMarkdownRangeForPreviewSelection(context) {
      const textLength = documentModel?.getTextLength?.() ?? editor.value.length;
      if (Number.isFinite(context?.exactStart) && Number.isFinite(context?.exactEnd)) {
        const start = Math.max(0, Math.min(textLength, Math.min(context.exactStart, context.exactEnd)));
        const end = Math.max(start, Math.min(textLength, Math.max(context.exactStart, context.exactEnd)));
        if (end > start && Number(context.mappingCoverage) >= 0.96) {
          return { start, end, score: 0, exact: true };
        }
      }
      const raw = context?.text || '';
      const regionStart = Math.max(0, Math.min(context?.sourceStartIndex ?? 0, textLength));
      const regionEnd = Math.max(regionStart, Math.min(context?.sourceEndIndex ?? textLength, textLength));
      const region = documentModel?.sliceText?.(regionStart, regionEnd) ?? editor.value.slice(regionStart, regionEnd);
      const candidates = Array.from(new Set([raw, raw.trim()])).filter(Boolean);
      const preferredStart = Math.max(regionStart, Math.min(regionEnd, Number(context?.preferredStart) || regionStart));

      let bestRaw = null;
      for (const candidate of candidates) {
        const found = findNearestRawRange(region, candidate, regionStart, preferredStart);
        if (found && (!bestRaw || found.score < bestRaw.score)) bestRaw = found;
      }
      if (bestRaw) return bestRaw;

      const normalized = findRangeInNormalizedProjection(
        buildNormalizedSourceMap(region, regionStart, false),
        raw,
        preferredStart
      );
      if (normalized) return normalized;
      const markdownPlain = findRangeInNormalizedProjection(
        buildNormalizedSourceMap(region, regionStart, true),
        raw,
        preferredStart
      );
      if (markdownPlain) return markdownPlain;

      // 块级范围无法映射时只搜索相邻 64 KB，而不是复制整篇超大文档。
      // 这既控制了最坏性能，也避免重复短语跳到距离当前预览很远的位置。
      const fallbackPadding = 64 * 1024;
      const fallbackStart = Math.max(0, regionStart - fallbackPadding);
      const fallbackEnd = Math.min(textLength, regionEnd + fallbackPadding);
      const nearby = documentModel?.sliceText?.(fallbackStart, fallbackEnd)
        ?? editor.virtualEditor?.sliceText?.(fallbackStart, fallbackEnd)
        ?? editor.value.slice(fallbackStart, fallbackEnd);
      let best = null;
      candidates.forEach(candidate => {
        const found = findNearestRawRange(nearby, candidate, fallbackStart, preferredStart);
        if (found && (!best || found.score < best.score)) best = found;
      });
      return best;
    }

    function syncPreviewSelectionToEditor(reason = 'preview-selection') {
      const context = getPreviewSelectionContext();
      if (!context) return { status: 'no-selection', selectionLength: 0, matchedAnchors: 0 };
      const range = findMarkdownRangeForPreviewSelection(context);
      if (!range) {
        return {
          status: 'mapping-failed',
          selectionLength: context.text.length,
          matchedAnchors: Number(Boolean(context.startAnchor)) + Number(Boolean(context.endAnchor))
        };
      }
      selectionSyncLock = true;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(range.start, range.end);
      const targetIndex = range.start + Math.floor((range.end - range.start) / 2);
      const targetViewportRatio = clampSelectionViewportRatio(context.viewportRatio, editor.clientHeight);
      const scrollBehavior = /pointerup|keyup|selectionchange/.test(reason) ? 'smooth' : 'auto';
      scrollEditorToIndex(targetIndex, scrollBehavior, targetViewportRatio);
      const startLine = documentModel?.getLineNumberAtPosition?.(range.start)
        ?? getLineNumberAtIndex(editor.value, range.start);
      const endLine = documentModel?.getLineNumberAtPosition?.(Math.max(range.start, range.end - 1))
        ?? getLineNumberAtIndex(editor.value, Math.max(range.start, range.end - 1));
      const highlightResult = highlightPreviewLines(startLine, endLine, false, context.text, {
        sourceStartIndex: range.start,
        sourceEndIndex: range.end,
        viewportRatio: context.viewportRatio,
        behavior: 'auto'
      });
      updateActiveOutlineByLine(startLine);
      setTimeout(() => { selectionSyncLock = false; }, 96);
      return {
        status: 'mapped',
        selectionLength: context.text.length,
        matchedAnchors: highlightResult?.matchedAnchors || 0,
        sourceStart: range.start,
        sourceEnd: range.end,
        exactMapping: Boolean(range.exact),
        mappingMode: range.exact ? 'dom-source' : 'text-search',
        mappingCoverage: Number.isFinite(context.mappingCoverage) ? Number(context.mappingCoverage.toFixed(3)) : null,
        sourceViewportRatio: context.viewportRatio,
        targetViewportRatio
      };
    }

    Object.assign(window.markdownEditorScrollSync, {
      markProgrammaticScroll,
      markManualScroll,
      suspend: suspendAutomaticScrollSync,
      cancel: cancelScrollSyncAnimation,
      syncNow: side => scrollController.syncNow(side),
      getState: () => scrollController.getState()
    });

    scrollController.configure({
      syncFromEditor: () => window.syncFromEditorScroll?.(),
      syncFromPreview: () => window.syncFromPreviewScroll?.()
    });

    const selectionController = window.markdownEditorSelectionController;
    if (!selectionController) throw new Error('Selection controller is not initialized');
    selectionController.configure({
      syncEditorToPreview: ({ shouldScroll, reason }) => syncEditorSelectionToPreview(shouldScroll, reason),
      syncPreviewToEditor: ({ reason }) => syncPreviewSelectionToEditor(reason),
      clearPreview: clearPreviewSelectionHighlights
    }).start();

    Object.assign(window, {
      syncEditorSelectionToPreview,
      syncPreviewSelectionToEditor
    });

    let selectionLayoutTimer = 0;
    function scheduleSelectionLayoutRefresh(reason = 'selection-layout-change') {
      clearTimeout(selectionLayoutTimer);
      selectionLayoutTimer = setTimeout(() => {
        selectionLayoutTimer = 0;
        const controller = window.markdownEditorSelectionController;
        if (!controller) return;
        const previewSelection = window.getSelection?.();
        const previewSelectionActive = Boolean(
          previewSelection
          && !previewSelection.isCollapsed
          && preview.contains(previewSelection.anchorNode)
          && preview.contains(previewSelection.focusNode)
        );
        if (previewSelectionActive) {
          controller.schedulePreview(reason, { force: true, frames: 2 });
          return;
        }
        if ((editor.selectionStart || 0) !== (editor.selectionEnd || 0)) {
          controller.scheduleEditor(true, reason, { force: true, frames: 2 });
        }
      }, isResizing ? 220 : SELECTION_LAYOUT_SETTLE_MS);
    }

    if (typeof ResizeObserver !== 'undefined') {
      let lastEditorWidth = Math.round(editor.clientWidth);
      let lastEditorHeight = Math.round(editor.clientHeight);
      const editorResizeObserver = new ResizeObserver(entries => {
        const width = Math.round(entries[0]?.contentRect?.width || editor.clientWidth);
        const height = Math.round(entries[0]?.contentRect?.height || editor.clientHeight);
        const geometryChanged = Math.abs(width - lastEditorWidth) >= 1 || Math.abs(height - lastEditorHeight) >= 1;
        if (!geometryChanged) return;
        lastEditorWidth = width;
        lastEditorHeight = height;
        // 连续拖动分栏时只标记失效，停稳后在空闲帧重建一次。
        scheduleEditorMetricsRebuild(isResizing ? 180 : 90);
        scheduleSelectionLayoutRefresh('editor-geometry-change');
      });
      editorResizeObserver.observe(editor);
      let lastPreviewWidth = Math.round(preview.clientWidth);
      let lastPreviewHeight = Math.round(preview.clientHeight);
      const previewResizeObserver = new ResizeObserver(entries => {
        const width = Math.round(entries[0]?.contentRect?.width || preview.clientWidth);
        const height = Math.round(entries[0]?.contentRect?.height || preview.clientHeight);
        const geometryChanged = Math.abs(width - lastPreviewWidth) >= 1 || Math.abs(height - lastPreviewHeight) >= 1;
        if (!geometryChanged) return;
        lastPreviewWidth = width;
        lastPreviewHeight = height;
        invalidatePreviewAnchorMetrics();
        scrollController.notifyGeometryChanged('preview');
        scheduleSelectionLayoutRefresh('preview-geometry-change');
      });
      previewResizeObserver.observe(preview);
    }

    let windowResizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(windowResizeTimer);
      windowResizeTimer = setTimeout(() => {
        windowResizeTimer = 0;
        scheduleEditorMetricsRebuild(0);
        invalidatePreviewAnchorMetrics();
        scrollController.notifyGeometryChanged();
        scheduleSelectionLayoutRefresh('window-geometry-change');
      }, 90);
    });

    // 初始化：恢复内容、文件名、主题
